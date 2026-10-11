export type Show = { id: string; title: string; year: string; mediaType?: 'movie' | 'series'; imdbId?: string | null; netflixCountries?: string[]; tmdbId?: number };
export type Rating = { score: string | null; votes: string | null; unavailable?: boolean };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
export type SearchData = { shows: Show[]; total: number; nextPage?: number | null; unknown?: number; unknownTitles?: string[] };
export type NetflixAvailability = { verified: boolean; countries: string[]; tmdbId?: number };

export function imdbIdFor(show: Show): string | null {
  return show.imdbId !== undefined ? show.imdbId : /^tt\d{7,10}$/.test(show.id) ? show.id : null;
}

export function titleHref(show: Show): string {
  const imdbId = imdbIdFor(show);
  return imdbId ? `https://www.imdb.com/title/${imdbId}/` : `https://www.themoviedb.org/${show.mediaType === 'movie' ? 'movie' : 'tv'}/${show.tmdbId}`;
}
