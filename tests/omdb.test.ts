import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOmdbClient } from '../src/lib/omdb.server.ts';

const response = (data: unknown) => new Response(JSON.stringify(data));

test('missing API key gives an honest configuration error', async () => {
  const client = createOmdbClient({ key: () => undefined });
  await assert.rejects(client.search('Dark'), /site owner needs to add an OMDb API key/);
});

test('validates query, pagination and title IDs before fetching', async () => {
  const client = createOmdbClient({ key: () => 'test', fetcher: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(client.search('x'), /between 2 and 100/);
  await assert.rejects(client.search('Dark', 101), /between 2 and 100/);
  await assert.rejects(client.search('Dark', 1.5), /between 2 and 100/);
  await assert.rejects(client.rating('bad'), /invalid/);
});

test('returns multiple matching series and caches and coalesces requests', async () => {
  let calls = 0;
  const client = createOmdbClient({ key: () => 'test', fetcher: async url => {
    calls++;
    assert.equal(new URL(String(url)).searchParams.has('type'), false);
    return response({ Response: 'True', totalResults: '2', Search: [
      { Title: 'Dark', Year: '2017–2020', imdbID: 'tt5753856' },
      { Title: 'Dark Matter', Year: '2024–', imdbID: 'tt19231492' },
    ] });
  } });
  const [a, b] = await Promise.all([client.search('Dark'), client.search('Dark')]);
  assert.deepEqual(a, b);
  assert.equal(a.shows.length, 2);
  assert.equal(a.total, 2);
  await client.search('Dark');
  assert.equal(calls, 1);
});

test('rating preserves a real score and missing ratings are null', async () => {
  const client = createOmdbClient({ key: () => 'test', fetcher: async url => response({
    Response: 'True', imdbRating: String(url).includes('tt5753856') ? '8.7' : 'N/A', imdbVotes: '450,000',
  }) });
  assert.deepEqual(await client.rating('tt5753856'), { score: '8.7', votes: '450,000' });
  assert.equal((await client.rating('tt19231492')).score, null);
});

test('no-match results and quota errors with HTTP 200 are handled', async () => {
  const empty = createOmdbClient({ key: () => 'test', fetcher: async () => response({ Response: 'False', Error: 'Movie not found!' }) });
  assert.deepEqual(await empty.search('unknown'), { shows: [], total: 0 });
  const limited = createOmdbClient({ key: () => 'test', fetcher: async () => response({ Response: 'False', Error: 'Request limit reached!' }) });
  await assert.rejects(limited.search('Dark'), /daily limit/);
});

test('network and malformed responses produce safe errors', async () => {
  const network = createOmdbClient({ key: () => 'test', fetcher: async () => { throw new Error('secret URL'); } });
  await assert.rejects(network.search('Dark'), /Couldn’t reach/);
  const malformed = createOmdbClient({ key: () => 'test', fetcher: async () => response(null) });
  await assert.rejects(malformed.search('Dark'), /Couldn’t reach/);
});

test('an invalid key returned with HTTP 401 shows a configuration error', async () => {
  const client = createOmdbClient({ key: () => 'test', fetcher: async () => new Response(
    JSON.stringify({ Response: 'False', Error: 'Invalid API key!' }), { status: 401 },
  ) });
  await assert.rejects(client.search('Dark'), /check the OMDb API key/);
});

test('request concurrency is limited and expired cache is refreshed', async () => {
  let clock = 0;
  let active = 0;
  let peak = 0;
  let calls = 0;
  const client = createOmdbClient({ key: () => 'test', now: () => clock, fetcher: async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return response({ Response: 'True', imdbRating: '8.0' });
  } });
  await Promise.all(Array.from({ length: 10 }, (_, i) => client.rating(`tt${1000000 + i}`)));
  assert.equal(peak, 4);
  await client.rating('tt1000000');
  assert.equal(calls, 10);
  clock = 86_400_001;
  await client.rating('tt1000000');
  assert.equal(calls, 11);
});

test('visitor throttling resets after its window', () => {
  let clock = 0;
  const client = createOmdbClient({ key: () => 'test', now: () => clock });
  for (let i = 0; i < 80; i++) client.throttle('visitor');
  assert.throws(() => client.throttle('visitor'), /too fast/);
  clock = 60_001;
  assert.doesNotThrow(() => client.throttle('visitor'));
});

test('fallback search includes movies as well as series', async () => {
  const client = createOmdbClient({ key: () => 'test', fetcher: async () => response({ Response: 'True', totalResults: '2', Search: [
    { Title: 'New Netflix Movie', Year: '2026', imdbID: 'tt1234567', Type: 'movie' },
    { Title: 'New Netflix Series', Year: '2026', imdbID: 'tt7654321', Type: 'series' },
  ] }) });
  assert.deepEqual((await client.search('Netflix')).shows.map(show => show.mediaType), ['movie', 'series']);
});

test('a recent title absent from OMDb reports an unavailable score, not a fabricated rating', async () => {
  const client = createOmdbClient({ key: () => 'test', fetcher: async () => response({ Response: 'False', Error: 'Movie not found!' }) });
  assert.deepEqual(await client.rating('tt1234567'), { score: null, votes: null, unavailable: true });
});
