import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratingFor } from '../src/lib/shows.ts';

const title = { id: 'tt1234567', title: 'A new title', year: '2026', tmdbRating: { score: '7.8', votes: '123' } };

test('IMDb takes precedence over the separate TMDb fallback', () => {
  assert.deepEqual(ratingFor({ ...title, rating: { score: '8.1', votes: '10,352' } }), { source: 'IMDb', score: '8.1', votes: '10,352' });
});

test('missing OMDb score uses an explicitly labeled TMDb score and its own vote count', () => {
  assert.deepEqual(ratingFor({ ...title, rating: { score: null, votes: '99' } }), { source: 'TMDb', score: '7.8', votes: '123' });
});

test('fallback works while IMDb loads, when OMDb fails, and without an IMDb link', () => {
  for (const show of [title, { ...title, failed: true }, { ...title, rating: { score: null, votes: null, unavailable: true } }, { ...title, id: 'tmdb-movie-2', imdbId: null }]) {
    assert.equal(ratingFor(show)?.source, 'TMDb');
  }
});

test('missing scores from both sources stay unavailable, never fabricated', () => {
  assert.equal(ratingFor({ id: 'tt1234567', title: 'Unrated', year: '2026' }), null);
  assert.equal(ratingFor({ ...title, tmdbRating: { score: null, votes: null }, rating: { score: null, votes: null } }), null);
});
