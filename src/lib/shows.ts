export type Show = { id: string; title: string; year: string; mediaType?: 'movie' | 'series'; imdbId?: string | null; netflixCountries?: string[]; tmdbId?: number; tmdbRating?: Rating };
export type Rating = { score: string | null; votes: string | null; unavailable?: boolean };
export type ScoredShow = Show & { rating?: Rating; failed?: boolean };
export type DisplayedRating = { source: 'IMDb' | 'TMDb'; score: string; votes: string | null };
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

// IMDb always wins; a TMDb score is a separately labeled fallback, never an IMDb score.
export function ratingFor(show: ScoredShow): DisplayedRating | null {
  if (show.rating?.score) return { source: 'IMDb', score: show.rating.score, votes: show.rating.votes };
  if (show.tmdbRating?.score) return { source: 'TMDb', score: show.tmdbRating.score, votes: show.tmdbRating.votes };
  return null;
}
