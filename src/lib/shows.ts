export type Show = { id: string; title: string; year: string; netflixCountries?: string[]; tmdbId?: number };
export type Rating = { score: string | null; votes: string | null };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
export type SearchData = { shows: Show[]; total: number; nextPage?: number | null; unknown?: number };
export type NetflixAvailability = { verified: boolean; countries: string[]; tmdbId?: number };
