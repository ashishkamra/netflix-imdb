import { LookupError } from './lookup-error.ts';
import type { NetflixAvailability } from './shows.ts';

const TTL = 60 * 60 * 1000;
type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
    if (!options.key()?.trim()) throw new LookupError('tmdb_not_configured', 'Netflix filtering isn’t connected yet. The site owner needs to add a TMDB_API_KEY. You can still search all shows.');
  }

  async function request(path: string, params: Record<string, string> = {}): Promise<JsonObject> {
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
        if (response.status === 401 || response.status === 403) throw new LookupError('tmdb_not_configured', 'TMDB rejected the availability key. The site owner needs to check TMDB_API_KEY. You can still search all shows.');
        if (response.status === 429) throw new LookupError('tmdb_busy', 'Availability checks are temporarily rate-limited. Please try again shortly.');
        if (!response.ok) throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or search all shows.');
        const data: unknown = await response.json();
        if (!object(data) || data.success === false) throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or search all shows.');
        for (const [id, entry] of cache) if (entry.until < now()) cache.delete(id);
        if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
        cache.set(cacheKey, { until: now() + TTL, data });
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
    async availability(imdbId: string): Promise<NetflixAvailability> {
      if (!/^tt\d{7,10}$/.test(imdbId)) throw new LookupError('invalid', 'That show ID is invalid.');
      const found = await request(`/find/${imdbId}`, { external_source: 'imdb_id' });
      if (!Array.isArray(found.tv_results)) throw new LookupError('tmdb_network', 'Couldn’t match this TV show to availability data.');
      const series = found.tv_results.find(item => object(item) && Number.isSafeInteger(item.id) && Number(item.id) > 0);
      if (!object(series)) return { verified: false, countries: [] };
      const tmdbId = Number(series.id);
      const providers = await request(`/tv/${tmdbId}/watch/providers`);
      if (!object(providers.results)) throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or search all shows.');
      return { verified: Object.keys(providers.results).length > 0, countries: netflixCountries(providers.results), tmdbId };
    },
  };
}

export const tmdb = createTmdbClient({ key: () => process.env.TMDB_API_KEY });
