export type Show = { id: string; title: string; year: string };
export type Rating = { score: string | null; votes: string | null };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };
export type SearchData = { shows: Show[]; total: number };
