import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTmdbClient, netflixCountries } from '../src/lib/tmdb.server.ts';
import { filterNetflixPage } from '../src/lib/netflix.server.ts';
import { LookupError } from '../src/lib/lookup-error.ts';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const netflix = { provider_id: 8, provider_name: 'Netflix' };
const dark = { id: 'tt5753856', title: 'Dark', year: '2017–2020' };
const matter = { id: 'tt19231492', title: 'Dark Matter', year: '2024–' };

test('Netflix in any country counts, including ad-supported subscription variants', () => {
  assert.deepEqual(netflixCountries({
    US: { flatrate: [{ provider_id: 350, provider_name: 'Apple TV+' }] },
    JP: { flatrate: [netflix] },
    DE: { flatrate: [{ provider_id: 1796, provider_name: 'Netflix Standard with Ads' }] },
    CA: { flatrate: [{ provider_name: 'Netflix Kids' }] },
    GB: { buy: [netflix], rent: [netflix] },
    invalid: { flatrate: [netflix] },
  }), ['CA', 'DE', 'JP']);
});

test('does not count Netflix mentions, other services, rentals or purchases', () => {
  assert.deepEqual(netflixCountries({ US: { flatrate: [{ provider_name: 'Not Netflix' }], rent: [netflix] }, GB: { buy: [netflix] } }), []);
});

test('matches the exact IMDb ID to a TV series and coalesces cached lookups', async () => {
  let calls = 0;
  const client = createTmdbClient({ key: () => 'server-only-key', fetcher: async raw => {
    calls++;
    const url = new URL(String(raw));
    assert.equal(url.searchParams.get('api_key'), 'server-only-key');
    if (url.pathname.includes('/find/')) {
      assert.equal(url.pathname, '/3/find/tt5753856');
      assert.equal(url.searchParams.get('external_source'), 'imdb_id');
      return json({ tv_results: [{ id: 70523 }], movie_results: [{ id: 1 }] });
    }
    assert.equal(url.pathname, '/3/tv/70523/watch/providers');
    return json({ results: { JP: { flatrate: [netflix] } } });
  } });
  const results = await Promise.all([client.availability(dark.id), client.availability(dark.id)]);
  assert.deepEqual(results[0], { verified: true, countries: ['JP'], tmdbId: 70523 });
  await client.availability(dark.id);
  assert.equal(calls, 2);
});

test('supports a private read-access token without adding it to the URL', async () => {
  const client = createTmdbClient({ key: () => 'eyJtest-token', fetcher: async (url, options) => {
    assert.equal(new URL(String(url)).searchParams.has('api_key'), false);
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer eyJtest-token');
    return json({ tv_results: [] });
  } });
  assert.deepEqual(await client.availability(dark.id), { verified: false, countries: [] });
});

test('missing keys and invalid IMDb IDs are rejected before making a request', async () => {
  let fetched = false;
  const client = createTmdbClient({ key: () => undefined, fetcher: async () => { fetched = true; return json({}); } });
  await assert.rejects(client.availability(dark.id), /TMDB_API_KEY/);
  await assert.rejects(client.availability('wrong'), /invalid/);
  assert.equal(fetched, false);
});

test('unmapped shows and empty availability data are unknown, not confirmed Netflix', async () => {
  const noTV = createTmdbClient({ key: () => 'test', fetcher: async () => json({ tv_results: [], movie_results: [{ id: 1 }] }) });
  assert.equal((await noTV.availability(dark.id)).verified, false);
  const empty = createTmdbClient({ key: () => 'test', fetcher: async url => json(String(url).includes('/find/') ? { tv_results: [{ id: 70523 }] } : { results: {} }) });
  assert.deepEqual(await empty.availability(dark.id), { verified: false, countries: [], tmdbId: 70523 });
});

test('invalid key, rate-limit, network and malformed responses are safe errors', async () => {
  for (const status of [401, 403, 429, 500]) {
    const client = createTmdbClient({ key: () => 'secret', fetcher: async () => json({}, status) });
    await assert.rejects(client.availability(dark.id), error => error instanceof LookupError && !error.message.includes('secret'));
  }
  const malformed = createTmdbClient({ key: () => 'secret', fetcher: async () => json({}) });
  await assert.rejects(malformed.availability(dark.id), /Couldn’t match/);
  const network = createTmdbClient({ key: () => 'secret', fetcher: async () => { throw Error('secret'); } });
  await assert.rejects(network.availability(dark.id), /Couldn’t check/);
});

test('bounds upstream concurrency and refreshes expired cached availability', async () => {
  let time = 0;
  let active = 0;
  let peak = 0;
  let calls = 0;
  const client = createTmdbClient({ key: () => 'test', now: () => time, fetcher: async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    return json({ tv_results: [] });
  } });
  await Promise.all(Array.from({ length: 10 }, (_, i) => client.availability(`tt${1000000 + i}`)));
  assert.equal(peak, 4);
  await client.availability('tt1000000');
  assert.equal(calls, 10);
  time = 3_600_001;
  await client.availability('tt1000000');
  assert.equal(calls, 11);
});

test('filter keeps confirmed worldwide matches and preserves candidate pagination', async () => {
  const data = await filterNetflixPage({ shows: [dark, matter], total: 22 }, 1, async id => ({ verified: true, countries: id === dark.id ? ['JP'] : [], tmdbId: 70523 }));
  assert.deepEqual(data.shows, [{ ...dark, netflixCountries: ['JP'], tmdbId: 70523 }]);
  assert.equal(data.total, 22);
  assert.equal(data.nextPage, 2);
  assert.equal(data.unknown, 0);
});

test('an empty filtered page still exposes more pages', async () => {
  const data = await filterNetflixPage({ shows: [dark], total: 22 }, 1, async () => ({ verified: true, countries: [] }));
  assert.equal(data.shows.length, 0);
  assert.equal(data.nextPage, 2);
  const last = await filterNetflixPage({ shows: [dark], total: 22 }, 3, async () => ({ verified: true, countries: [] }));
  assert.equal(last.nextPage, null);
});

test('partial failures exclude unverified shows and report them, complete outages surface', async () => {
  const data = await filterNetflixPage({ shows: [dark, matter], total: 2 }, 1, async id => {
    if (id === matter.id) throw Error('network');
    return { verified: true, countries: ['JP'] };
  });
  assert.equal(data.shows.length, 1);
  assert.equal(data.unknown, 1);
  await assert.rejects(filterNetflixPage({ shows: [dark], total: 1 }, 1, async () => { throw Error('network'); }), /Couldn’t check/);
});

test('bad configuration is never disguised as zero Netflix matches', async () => {
  await assert.rejects(filterNetflixPage({ shows: [dark], total: 1 }, 1, async () => { throw new LookupError('tmdb_not_configured', 'Check TMDB_API_KEY'); }), /TMDB_API_KEY/);
});

test('fresh TMDB discovery includes movies and TV, excludes people, and keeps missing IMDb links', async () => {
  const client = createTmdbClient({ key: () => 'test', fetcher: async raw => {
    const url = new URL(String(raw));
    if (url.pathname === '/3/search/multi') {
      assert.equal(url.searchParams.get('query'), 'Latest Title');
      assert.equal(url.searchParams.get('include_adult'), 'false');
      return json({ total_results: 3, total_pages: 2, results: [
        { id: 1, media_type: 'tv', name: 'Latest Title', first_air_date: '2020-01-01' },
        { id: 2, media_type: 'movie', title: 'Latest Title', release_date: '2026-10-09' },
        { id: 3, media_type: 'person', name: 'Latest Title' },
      ] });
    }
    if (url.pathname === '/3/movie/2/external_ids') return json({ imdb_id: null });
    return json({ imdb_id: 'tt1234567' });
  } });
  const data = await client.search('Latest Title');
  assert.equal(data.shows.length, 2);
  assert.equal(data.shows[0].mediaType, 'movie');
  assert.equal(data.shows[0].year, '2026');
  assert.equal(data.shows[0].imdbId, null);
  assert.equal(data.shows[0].id, 'tmdb-movie-2');
  assert.equal(data.shows[1].imdbId, 'tt1234567');
  assert.equal(data.nextPage, 2);
});

test('movie availability uses its TMDB ID directly even before its IMDb ID exists', async () => {
  const client = createTmdbClient({ key: () => 'test', fetcher: async raw => {
    assert.equal(new URL(String(raw)).pathname, '/3/movie/2/watch/providers');
    return json({ results: { IN: { flatrate: [netflix] } } });
  } });
  assert.deepEqual(await client.availability('tmdb-movie-2', { id: 'tmdb-movie-2', title: 'Latest', year: '2026', mediaType: 'movie', imdbId: null, tmdbId: 2 }), { verified: true, countries: ['IN'], tmdbId: 2 });
});

test('fresh discovery keeps titles when external-ID lookup fails and validates pagination', async () => {
  const client = createTmdbClient({ key: () => 'test', fetcher: async raw => {
    if (String(raw).includes('/search/multi')) return json({ total_results: 1, total_pages: 1, results: [{ id: 2, media_type: 'movie', title: 'Latest', release_date: '2026-10-09' }] });
    throw Error('External-ID service unavailable');
  } });
  assert.equal((await client.search('Latest')).shows[0].imdbId, null);
  await assert.rejects(client.search('x'), /between 2 and 100/);
  await assert.rejects(client.search('Latest', 501), /between 2 and 100/);
});

test('filter preserves TMDB pagination and identifies titles with unverified availability', async () => {
  const result = await filterNetflixPage({ shows: [dark], total: 25, nextPage: 2 }, 1, async () => ({ verified: false, countries: [] }));
  assert.equal(result.nextPage, 2);
  assert.deepEqual(result.unknownTitles, ['Dark']);
});
