import { LookupError } from './lookup-error.ts';
import type { NetflixAvailability, SearchData, Show } from './shows.ts';

export async function filterNetflixPage(data: SearchData, page: number, availability: (id: string) => Promise<NetflixAvailability>): Promise<SearchData> {
  const results = await Promise.all(data.shows.map(async (show): Promise<{ show: Show; result: NetflixAvailability; error?: unknown }> => {
    try {
      const result = await availability(show.id);
      return { show, result };
    } catch (error) {
      // Bad configuration must be visible, never disguised as zero matches.
      if (error instanceof LookupError && error.code === 'tmdb_not_configured') throw error;
      return { show, result: { verified: false, countries: [] }, error };
    }
  }));
  if (results.length && results.every(result => 'error' in result)) {
    throw new LookupError('tmdb_network', 'Couldn’t check Netflix availability. Please try again, or turn off Netflix only.');
  }
  const shows: Show[] = results.flatMap(({ show, result }) => result.countries.length
    ? [{ ...show, netflixCountries: result.countries, tmdbId: result.tmdbId }] : []);
  return {
    shows,
    // This is the number of title candidates, not a fabricated global Netflix count.
    total: data.total,
    nextPage: page < 100 && page * 10 < data.total ? page + 1 : null,
    unknown: results.filter(({ result }) => !result.verified).length,
  };
}
