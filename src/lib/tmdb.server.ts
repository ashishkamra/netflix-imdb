import { LookupError } from './lookup-error.ts';
import type { NetflixAvailability, Rating, SearchData, Show } from './shows.ts';

const TTL = 60 * 60 * 1000;
type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function searchRating(entry: JsonObject): Rating {
  const score = entry.vote_average;
  const votes = entry.vote_count;
  // TMDb uses zero when there are no votes. Missing/malformed data is not a rating.
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0 || score > 10 || !Number.isSafeInteger(votes) || Number(votes) <= 0) {
    return { score: null, votes: null };
  }
  return { score: score.toFixed(1), votes: Number(votes).toLocaleString('en-US') };
}

// Subscription listings only; do not count rentals or purchases as Netflix availability.
export function netflixCountries(results: JsonObject): string[] {
  return Object.entries(results).flatMap(([country, listing]) => {
    if (!/^[A-Z]{2}$/.test(country) || !object(listing) || !Array.isArray(listing.flatrate)) return [];
    const available = listing.flatrate.some(provider => object(provider) && (
      [8, 175, 1796].includes(Number(provider.provider_id)) ||
      (typeof provider.provider_name === 'string' && /^Netflix(?:\s|$)/i.test(provider.provider_name))
    ));
    return available ? [country] : [];
  }).sort();
}

export function createTmdbClient(options: { key: () => string | undefined; fetcher?: typeof fetch; now?: () => number }) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { until: number; data: JsonObject }>();
  const pending = new Map<string, Promise<JsonObject>>();
  let active = 0;
  const waiting: (() => void)[] = [];

  function assertConfigured() {
    if (!options.key()?.trim()) throw new LookupError('tmdb_not_configured', 'The title catalog isn’t connected yet. The site owner needs to add a TMDB_API_KEY.');
  }

  async function request(path: string, params: Record<string, string> = {}, ttl = TTL): Promise<JsonObject> {
    assertConfigured();
    const cacheKey = path + new URLSearchParams(params).toString();
    const hit = cache.get(cacheKey);
    if (hit && hit.until > now()) return hit.data;
    const existing = pending.get(cacheKey);
    if (existing) return existing;
    const task = (async () => {
      if (active >= 4) {
        if (waiting.length >= 40) throw new LookupError('tmdb_busy', 'Availability checks are busy. Please try again shortly.');
        await new Promise<void>(resolve => waiting.push(resolve));
      } else active += 1;
      try {
        const key = options.key()!.trim();
        const url = new URL(`https://api.themoviedb.org/3${path}`);
        const headers: Record<string, string> = { accept: 'application/json' };
        // Accept either a v3 API key or an API Read Access Token, kept server-side.
        if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
        else url.searchParams.set('api_key', key);
        for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
        const response = await fetcher(url, { headers, signal: AbortSignal.timeout(8000) });
        if (response.status === 401 || response.status === 403) throw new LookupError('tmdb_not_configured', 'TMDB rejected the catalog key. The site owner needs to check TMDB_API_KEY.');
        if (response.status === 429) throw new LookupError('tmdb_busy', 'Availability checks are temporarily rate-limited. Please try again shortly.');
        if (!response.ok) throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or search all shows.');
        const data: unknown = await response.json();
        if (!object(data) || data.success === false) throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or search all shows.');
        for (const [id, entry] of cache) if (entry.until < now()) cache.delete(id);
        if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, { until: now() + ttl, data });
        return data;
      } catch (error) {
        if (error instanceof LookupError) throw error;
        throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or search all shows.');
      } finally {
        const next = waiting.shift();
        if (next) next(); else active -= 1;
      }
    })();
    pending.set(cacheKey, task);
    try { return await task; } finally { pending.delete(cacheKey); }
  }

  return {
    assertConfigured,
    async search(query: string, page = 1): Promise<SearchData> {
      const trimmed = query.trim();
      if (trimmed.length < 2 || trimmed.length > 100 || !Number.isInteger(page) || page < 1 || page > 500) {
        throw new LookupError('invalid', 'Enter a title between 2 and 100 characters.');
      }
      const data = await request('/search/multi', { query: trimmed, page: String(page), include_adult: 'false' }, 300_000);
      if (!Array.isArray(data.results)) throw new LookupError('tmdb_network', 'Couldn’t search the title catalog. Please try again.');
      const candidates = data.results.filter(item => object(item) && (item.media_type === 'movie' || item.media_type === 'tv') && Number.isSafeInteger(item.id) && Number(item.id) > 0).slice(0, 20);
      const shows = await Promise.all(candidates.map(async (item): Promise<Show> => {
        const entry = item as JsonObject;
        const movie = entry.media_type === 'movie';
        const type = movie ? 'movie' : 'tv';
        const tmdbId = Number(entry.id);
        const title = movie ? entry.title : entry.name;
        const date = movie ? entry.release_date : entry.first_air_date;
        let imdbId: string | null = null;
        try {
          const external = await request(`/${type}/${tmdbId}/external_ids`);
          if (typeof external.imdb_id === 'string' && /^tt\d{7,10}$/.test(external.imdb_id)) imdbId = external.imdb_id;
        } catch {
          // A fresh title or missing ID must not disappear just because its IMDb link is unavailable.
        }
        return { id: imdbId ?? `tmdb-${type}-${tmdbId}`, imdbId, tmdbId, title: typeof title === 'string' ? title : 'Untitled', year: typeof date === 'string' ? date.slice(0, 4) : '', mediaType: movie ? 'movie' : 'series', tmdbRating: searchRating(entry) };
      }));
      const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const needle = normalize(trimmed);
      const rank = (show: Show) => normalize(show.title) === needle ? 0 : normalize(show.title).startsWith(needle) ? 1 : 2;
      shows.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? Number(b.year || 0) - Number(a.year || 0) : 0));
      return { shows, total: Number(data.total_results) || shows.length, nextPage: page < 500 && page < Number(data.total_pages) ? page + 1 : null };
    },
    async availability(imdbId: string, show?: Show): Promise<NetflixAvailability> {
      const type = show?.mediaType === 'movie' ? 'movie' : 'tv';
      let tmdbId = show?.tmdbId;
      if (!Number.isSafeInteger(tmdbId) || Number(tmdbId) <= 0) {
        if (!/^tt\d{7,10}$/.test(imdbId)) throw new LookupError('invalid', 'That title ID is invalid.');
        const found = await request(`/find/${imdbId}`, { external_source: 'imdb_id' });
        const matches = type === 'movie' ? found.movie_results : found.tv_results;
        if (!Array.isArray(matches)) throw new LookupError('tmdb_network', 'Couldn’t match this title to availability data.');
        const match = matches.find(item => object(item) && Number.isSafeInteger(item.id) && Number(item.id) > 0);
        if (!object(match)) return { verified: false, countries: [] };
        tmdbId = Number(match.id);
      }
      const providers = await request(`/${type}/${tmdbId}/watch/providers`);
      if (!object(providers.results)) throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or search all shows.');
      return { verified: Object.keys(providers.results).length > 0, countries: netflixCountries(providers.results), tmdbId };
    },
  };
}

export const tmdb = createTmdbClient({ key: () => process.env.TMDB_API_KEY });
