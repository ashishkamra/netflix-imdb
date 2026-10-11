import type { Rating, SearchData } from './shows.ts';
import { LookupError } from './lookup-error.ts';
import { tmdb } from './tmdb.server.ts';
import { filterNetflixPage } from './netflix.server.ts';
export { LookupError } from './lookup-error.ts';

export function createOmdbClient(options: { key: () => string | undefined; fetcher?: typeof fetch; now?: () => number }) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; value: Record<string, unknown> }>();
  const pending = new Map<string, Promise<Record<string, unknown>>>();
  const visitors = new Map<string, { until: number; count: number }>();
  let active = 0;
  const queue: (() => void)[] = [];
  let day = '';
  let requests = 0;

  function throttle(visitor: string) {
    const time = now();
    for (const [id, bucket] of visitors) if (bucket.until < time) visitors.delete(id);
    if (visitors.size >= 2000 && !visitors.has(visitor)) {
      throw new LookupError('busy', 'Too many searches right now. Please try again in a minute.');
    }
    const bucket = visitors.get(visitor) ?? { until: time + 60_000, count: 0 };
    bucket.count += 1;
    visitors.set(visitor, bucket);
    if (bucket.count > 80) throw new LookupError('rate_limit', 'A little too fast. Please try again in a minute.');
  }

  async function request(params: Record<string, string>, ttl: number) {
    const apiKey = options.key();
    if (!apiKey) throw new LookupError('not_configured', 'Live ratings aren’t connected yet. The site owner needs to add an OMDb API key.');
    const cacheKey = new URLSearchParams(params).toString();
    const hit = cache.get(cacheKey);
    if (hit && hit.expires > now()) return hit.value;
    const existing = pending.get(cacheKey);
    if (existing) return existing;
    const job = (async () => {
      if (active >= 4) {
        if (queue.length >= 40) throw new LookupError('busy', 'Too many searches right now. Please try again shortly.');
        await new Promise<void>(resolve => queue.push(resolve));
      } else active += 1;
      try {
        const today = new Date(now()).toISOString().slice(0, 10);
        if (today !== day) { day = today; requests = 0; }
        if (requests >= 900) throw new LookupError('quota', 'Today’s lookup limit has been reached. Please try again tomorrow.');
        requests += 1;
        const url = new URL('https://www.omdbapi.com/');
        url.search = new URLSearchParams({ ...params, apikey: apiKey }).toString();
        const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid response');
        const value = data as Record<string, unknown>;
        if (value.Response !== 'True') {
          const message = typeof value.Error === 'string' ? value.Error : '';
          if (/not found/i.test(message)) return { Response: 'True', Search: [], totalResults: '0' };
          if (/limit/i.test(message)) throw new LookupError('quota', 'The rating service’s daily limit has been reached. Please try again tomorrow.');
          if (/key/i.test(message)) throw new LookupError('not_configured', 'Live ratings aren’t connected. The site owner needs to check the OMDb API key.');
          throw new LookupError('upstream', 'The rating service couldn’t complete that search. Try a more specific show name.');
        }
        if (!response.ok) throw new LookupError('upstream', 'The rating service is unavailable. Please try again shortly.');
        for (const [key, entry] of cache) if (entry.expires < now()) cache.delete(key);
        if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, { value, expires: now() + ttl });
        return value;
      } catch (error) {
        if (error instanceof LookupError) throw error;
        throw new LookupError('network', 'Couldn’t reach the rating service. Please try again.');
      } finally {
        const next = queue.shift();
        if (next) next();
        else active -= 1;
      }
    })();
    pending.set(cacheKey, job);
    try { return await job; } finally { pending.delete(cacheKey); }
  }

  return {
    throttle,
    async search(query: string, page = 1): Promise<SearchData> {
      const trimmed = query.trim();
      if (trimmed.length < 2 || trimmed.length > 100 || !Number.isInteger(page) || page < 1 || page > 100) {
        throw new LookupError('invalid', 'Enter a show name between 2 and 100 characters.');
      }
      const data = await request({ s: trimmed, type: 'series', page: String(page) }, 300_000);
      const matches = Array.isArray(data.Search) ? data.Search : [];
      const shows = matches.slice(0, 10).flatMap((item: Record<string, unknown>) =>
        item && typeof item.Title === 'string' && typeof item.imdbID === 'string' && /^tt\d{7,10}$/.test(item.imdbID)
          ? [{ id: item.imdbID, title: item.Title, year: typeof item.Year === 'string' ? item.Year : '' }] : []);
      return { shows, total: Number(data.totalResults) || 0 };
    },
    async rating(id: string): Promise<Rating> {
      if (!/^tt\d{7,10}$/.test(id)) throw new LookupError('invalid', 'That show ID is invalid.');
      const data = await request({ i: id, plot: 'short' }, 86_400_000);
      return {
        score: typeof data.imdbRating === 'string' && /^\d(?:\.\d)?$|^10(?:\.0)?$/.test(data.imdbRating) ? data.imdbRating : null,
        votes: typeof data.imdbVotes === 'string' && /^[\d,]+$/.test(data.imdbVotes) ? data.imdbVotes : null,
      };
    },
  };
}

export const omdb = createOmdbClient({ key: () => process.env.OMDB_API_KEY });

export async function handleLookup(request: Request) {
  try {
    // Deployment proxies set this header. Throttling/cache are best-effort per instance.
    omdb.throttle(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local');
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const netflixOnly = url.searchParams.get('netflix') === '1' && !id;
    if (netflixOnly) tmdb.assertConfigured();
    const page = Number(url.searchParams.get('page') ?? '1');
    const data = id
      ? await omdb.rating(id)
      : await omdb.search(url.searchParams.get('q') ?? '', page);
    const filtered = netflixOnly
      ? await filterNetflixPage(data as SearchData, page, tmdb.availability)
      : data;
    return Response.json({ ok: true, data: filtered }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const known = error instanceof LookupError;
    return Response.json({ ok: false, code: known ? error.code : 'unexpected', message: known ? error.message : 'Something went wrong. Please try again.' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
