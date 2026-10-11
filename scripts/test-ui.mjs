// Browser-only fixtures: never included in the app or served as live ratings.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8080/';
const screenshots = resolve('screenshots');
mkdirSync(screenshots, { recursive: true });
const assert = code => ['eval', `(() => { ${code} })()`];
const fixture = `(() => {
  const original = window.fetch.bind(window);
  window.__lookupCalls = [];
  window.fetch = async (raw, options) => {
    const url = new URL(String(raw), location.origin);
    if (url.pathname !== '/api/lookup') return original(raw, options);
    window.__lookupCalls.push(url.search);
    const query = url.searchParams.get('q');
    let data;
    if (query === 'Dark') {
      if (window.__slowDark) await new Promise(resolve => setTimeout(resolve, 1400));
      data = url.searchParams.get('page') === '2'
        ? { shows: [{ id: 'tt1234567', title: 'Dark — unrated test title', year: '2026' }], total: 3, nextPage: null }
        : { shows: [{ id: 'tt5753856', title: 'Dark', year: '2017–2020', tmdbRating: { score: '8.4', votes: '6,000' } }, { id: 'tt19231492', title: 'Dark Matter', year: '2024–', tmdbRating: { score: '7.9', votes: '150' } }], total: 3, nextPage: 2 };
    } else if (query === 'Crown') data = { shows: [{ id: 'tt4786824', title: 'The Crown', year: '2016–2023' }], total: 1 };
    else if (query === 'Latest') data = { shows: [
      { id: 'tmdb-movie-2', title: 'Latest Movie', year: '2026', mediaType: 'movie', imdbId: null, tmdbId: 2, tmdbRating: { score: '7.8', votes: '123' } },
      { id: 'tt1234567', title: 'Latest Series', year: '2026', mediaType: 'series', tmdbRating: { score: '6.9', votes: '200' } },
      { id: 'tmdb-movie-3', title: 'Unrated Movie', year: '2026', mediaType: 'movie', imdbId: null, tmdbId: 3, tmdbRating: { score: null, votes: null } },
    ], total: 3 };
    else if (query === 'Nothing') data = { shows: [], total: 0 };
    else if (query === 'Failure') return Response.json({ ok: false, code: 'quota', message: 'Daily lookup limit reached. Please try again tomorrow.' });
    else if (url.searchParams.has('id')) {
      if (window.__slowRating) await new Promise(resolve => setTimeout(resolve, 1400));
      if (window.__failRating) return Response.json({ ok: false, code: 'network', message: 'Test-only service error' });
      const id = url.searchParams.get('id');
      data = { score: id === 'tt1234567' ? null : id === 'tt19231492' ? '7.1' : '8.7', votes: '450,000' };
    } else data = { shows: [], total: 0 };
    if (url.searchParams.get('netflix') === '1' && query) {
      if (query === 'Missing') return Response.json({ ok: false, code: 'tmdb_not_configured', message: 'The site owner needs to check TMDB_API_KEY.' });
      if (query === 'Later') data = url.searchParams.get('page') === '2'
        ? { shows: [{ id: 'tt5753856', title: 'Dark', year: '2017–2020', netflixCountries: ['JP'] }], total: 11, nextPage: null }
        : { shows: [], total: 11, nextPage: 2, unknown: 1 };
      else data = { ...data, shows: data.shows.filter(show => show.id === 'tt5753856').map(show => ({ ...show, netflixCountries: ['DE', 'JP'], tmdbId: 70523 })), nextPage: null };
    }
    return Response.json({ ok: true, data });
  };
})()`;

const commands = [
  ['open', url], ['set', 'viewport', '1280', '800'], ['wait', '1000'],
  ['fill', '#show-search', 'Dark'], ['wait', '800'],
  assert("if (!document.querySelector('.results-list') && !document.querySelector('.error-message')) throw Error('Live response or configuration state missing')"),
  ['click', "button[aria-label='Clear search']"],
  ['wait', '200'],
  assert("if (document.querySelector('#show-search').value !== '') throw Error('Clear failed')"),
  ['click', '.suggestions button:first-of-type'], ['wait', '700'],
  assert("if (document.querySelector('#show-search').value !== 'Stranger Things') throw Error('Example failed')"),
  ['press', 'Escape'],
  ['eval', fixture],
  ['fill', '#show-search', 'Dark'], ['wait', '800'],
  assert("if (document.querySelectorAll('.results-list li').length !== 2 || !document.querySelector('.results-list').innerText.includes('8.7')) throw Error('Multiple matches or scores missing')"),
  ['press', 'ArrowDown'],
  assert("if (!document.activeElement.matches('.result-link') || !document.activeElement.innerText.includes('Dark') || !document.activeElement.innerText.includes('IMDb') || !document.activeElement.innerText.includes('8.7')) throw Error('First keyboard match or IMDb priority failed')"),
  ['press', 'ArrowDown'],
  assert("if (!document.activeElement.matches('button.result-link') || !document.activeElement.innerText.includes('Dark Matter')) throw Error('Second keyboard match failed')"),
  ['press', 'Enter'],
  assert("if (document.activeElement.getAttribute('aria-expanded') !== 'true' || !document.querySelector('.rating-details:not([hidden])').innerText.includes('IMDb user rating via OMDb') || !document.querySelector('.rating-details:not([hidden]) a').href.includes('imdb.com/title/tt19231492/')) throw Error('Keyboard title tap did not open in-app details with optional IMDb link')"),
  ['press', 'Escape'],
  assert("if (document.activeElement.id !== 'show-search' || document.querySelector('.rating-details:not([hidden])')) throw Error('Escape did not close details and return to search')"),
  ['screenshot', `${screenshots}/results-desktop.png`],
  ['set', 'viewport', '390', '844'],
  ['screenshot', `${screenshots}/results-mobile.png`],
  assert("if (document.documentElement.scrollWidth > innerWidth) throw Error('Mobile overflow')"),
  ['click', '.more-button'], ['wait', '800'],
  assert("if (document.querySelectorAll('.results-list li').length !== 3 || !document.querySelector('.results-list li:last-child').innerText.includes('Unavailable')) throw Error('Pagination or missing rating failed')"),
  ['fill', '#show-search', 'Nothing'], ['wait', '700'],
  assert("if (!document.body.innerText.includes('No matching titles')) throw Error('Empty state missing')"),
  ['fill', '#show-search', 'Failure'], ['wait', '700'],
  assert("if (!document.body.innerText.includes('Daily lookup limit reached')) throw Error('Quota error missing')"),
  ['click', '.text-button'], ['wait', '700'],
  assert("if (!document.body.innerText.includes('Daily lookup limit reached')) throw Error('Retry error missing')"),
  ['eval', 'window.__slowDark = true'],
  ['fill', '#show-search', 'Dark'], ['wait', '400'],
  ['fill', '#show-search', 'Crown'], ['wait', '1800'],
  assert("if (!document.querySelector('.results-list').innerText.includes('The Crown') || document.querySelector('.results-list').innerText.includes('Dark')) throw Error('Stale response replaced current search')"),
  ['eval', 'window.__slowDark = false; window.__failRating = true'],
  ['fill', '#show-search', 'Dark'], ['wait', '700'],
  assert("if (!document.body.innerText.includes('Some IMDb scores couldn’t load') || !document.querySelector('.result-link').innerText.includes('TMDb') || !document.querySelector('.result-link').innerText.includes('8.4')) throw Error('Partial failure fallback missing')"),
  ['eval', 'window.__failRating = false'],
  ['click', '.netflix-toggle'], ['wait', '800'],
  assert("if (document.querySelectorAll('.results-list li').length !== 1 || !document.body.innerText.includes('Netflix in 2 countries')) throw Error('Netflix filter failed')"),
  ['screenshot', `${screenshots}/netflix-mobile.png`],
  ['set', 'viewport', '1280', '800'],
  ['screenshot', `${screenshots}/netflix-desktop.png`],
  ['fill', '#show-search', 'Later'], ['wait', '700'],
  assert("if (!document.body.innerText.includes('No confirmed Netflix matches yet') || !document.querySelector('.more-button') || !document.body.innerText.includes('Unverified titles are excluded')) throw Error('Empty filtered page hid pagination or unknown status')"),
  ['click', '.more-button'], ['wait', '700'],
  assert("if (!document.querySelector('.results-list')?.innerText.includes('Dark')) throw Error('Later Netflix matches missing')"),
  ['fill', '#show-search', 'Missing'], ['wait', '700'],
  assert("if (!document.body.innerText.includes('TMDB_API_KEY')) throw Error('Netflix configuration error hidden')"),
  ['click', '.netflix-toggle'], ['fill', '#show-search', 'Dark'], ['wait', '700'],
  assert("if (document.querySelectorAll('.results-list li').length !== 2) throw Error('Turning off Netflix filter failed')"),
  ['fill', '#show-search', 'Latest'], ['wait', '700'],
  assert("if (document.querySelectorAll('.result-link').length !== 3 || !document.querySelector('.result-link').innerText.includes('TMDb') || !document.querySelector('.result-link').innerText.includes('7.8') || !document.querySelectorAll('.result-link')[1].innerText.includes('6.9') || !document.querySelectorAll('.result-link')[2].innerText.includes('Unavailable')) throw Error('Fallback or neither-source state missing')"),
  assert("if (window.__lookupCalls.some(search => search.includes('id=tmdb-'))) throw Error('Missing IMDb ID triggered a bogus score request'); window.__callsBeforeTap = window.__lookupCalls.length; window.__urlBeforeTap = location.href"),
  ['click', '.result-link'],
  assert("if (location.href !== window.__urlBeforeTap || document.querySelector('.result-link').getAttribute('aria-expanded') !== 'true' || !document.querySelector('.rating-details:not([hidden])').innerText.includes('not an IMDb score') || !document.querySelector('.rating-details:not([hidden])').innerText.includes('123 votes on TMDb') || !document.querySelector('.rating-details:not([hidden]) a').href.includes('themoviedb.org/movie/2') || window.__lookupCalls.length !== window.__callsBeforeTap) throw Error('Title tap left the app or failed lightweight details')"),
  ['screenshot', `${screenshots}/fallback-desktop.png`],
  ['set', 'viewport', '390', '844'],
  ['screenshot', `${screenshots}/fallback-mobile.png`],
  assert("if (document.documentElement.scrollWidth > innerWidth) throw Error('Fallback mobile overflow')"),
  ['click', '.results-list li:nth-child(2) .result-link'],
  assert("if (document.querySelectorAll('.rating-details:not([hidden])').length !== 1 || !document.querySelector('.rating-details:not([hidden]) a').href.includes('imdb.com/title/tt1234567/')) throw Error('Optional IMDb link or single expanded detail failed')"),
  ['click', '.results-list li:nth-child(2) .result-link'],
  assert("if (document.querySelector('.rating-details:not([hidden])')) throw Error('Second title tap did not collapse details')"),
  ['eval', 'window.__slowRating = true'],
  ['fill', '#show-search', 'Dark'], ['wait', '700'],
  assert("if (!document.querySelector('.result-link').innerText.includes('TMDb') || !document.querySelector('.result-link').innerText.includes('8.4')) throw Error('TMDb fallback was delayed by IMDb lookup')"),
  ['wait', '1400'],
  assert("if (!document.querySelector('.result-link').innerText.includes('IMDb') || !document.querySelector('.result-link').innerText.includes('8.7')) throw Error('IMDb did not replace provisional TMDb fallback')"),
  ['eval', 'window.__slowRating = false'],
  ['focus', '.data-credits summary'], ['press', 'Enter'], ['wait', '200'],
  assert("if (!document.querySelector('.data-credits').open || !document.querySelector('.credits-content img').naturalWidth) throw Error('Data credits or logo missing')"),
  ['errors'], ['close'],
];

const run = spawnSync(resolve('node_modules/.bin/agent-browser'), ['--session', `showscore-test-${new URL(url).port}`, 'batch', '--bail'], {
  input: JSON.stringify(commands), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'],
});
process.exit(run.status ?? 1);
