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
  window.fetch = async (raw, options) => {
    const url = new URL(String(raw), location.origin);
    if (url.pathname !== '/api/lookup') return original(raw, options);
    const query = url.searchParams.get('q');
    let data;
    if (query === 'Dark') {
      if (window.__slowDark) await new Promise(resolve => setTimeout(resolve, 1400));
      data = url.searchParams.get('page') === '2'
        ? { shows: [{ id: 'tt1234567', title: 'Dark — unrated test title', year: '2026' }], total: 3 }
        : { shows: [{ id: 'tt5753856', title: 'Dark', year: '2017–2020' }, { id: 'tt19231492', title: 'Dark Matter', year: '2024–' }], total: 3 };
    } else if (query === 'Crown') data = { shows: [{ id: 'tt4786824', title: 'The Crown', year: '2016–2023' }], total: 1 };
    else if (query === 'Nothing') data = { shows: [], total: 0 };
    else if (query === 'Failure') return Response.json({ ok: false, code: 'quota', message: 'Daily lookup limit reached. Please try again tomorrow.' });
    else if (url.searchParams.has('id')) {
      if (window.__failRating) return Response.json({ ok: false, code: 'network', message: 'Test-only service error' });
      const id = url.searchParams.get('id');
      data = { score: id === 'tt1234567' ? null : id === 'tt19231492' ? '7.1' : '8.7', votes: '450,000' };
    } else data = { shows: [], total: 0 };
    return Response.json({ ok: true, data });
  };
})()`;

const commands = [
  ['open', url], ['wait', '1000'],
  ['fill', '#show-search', 'Dark'], ['wait', '800'],
  assert("if (!document.querySelector('.results-list') && !document.querySelector('.error-message')) throw Error('Live response or configuration state missing')"),
  ['click', "button[aria-label='Clear search']"],
  assert("if (document.querySelector('#show-search').value !== '') throw Error('Clear failed')"),
  ['click', '.suggestions button:first-of-type'], ['wait', '700'],
  assert("if (document.querySelector('#show-search').value !== 'Stranger Things') throw Error('Example failed')"),
  ['press', 'Escape'],
  ['eval', fixture],
  ['fill', '#show-search', 'Dark'], ['wait', '800'],
  assert("if (document.querySelectorAll('.results-list li').length !== 2 || !document.querySelector('.results-list').innerText.includes('8.7')) throw Error('Multiple matches or scores missing')"),
  ['press', 'ArrowDown'],
  assert("if (document.activeElement.getAttribute('href') !== 'https://www.imdb.com/title/tt5753856/') throw Error('First keyboard match failed')"),
  ['press', 'ArrowDown'],
  assert("if (document.activeElement.getAttribute('href') !== 'https://www.imdb.com/title/tt19231492/') throw Error('Second keyboard match failed')"),
  ['screenshot', `${screenshots}/results-desktop.png`],
  ['set', 'viewport', '390', '844'],
  ['screenshot', `${screenshots}/results-mobile.png`],
  assert("if (document.documentElement.scrollWidth > innerWidth) throw Error('Mobile overflow')"),
  ['click', '.more-button'], ['wait', '800'],
  assert("if (document.querySelectorAll('.results-list li').length !== 3 || !document.body.innerText.includes('Not rated')) throw Error('Pagination or missing rating failed')"),
  ['fill', '#show-search', 'Nothing'], ['wait', '700'],
  assert("if (!document.body.innerText.includes('No matching shows')) throw Error('Empty state missing')"),
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
  assert("if (!document.body.innerText.includes('Some scores couldn’t load')) throw Error('Partial failure state missing')"),
  ['errors'], ['close'],
];

const run = spawnSync(resolve('node_modules/.bin/agent-browser'), ['--session', `showscore-test-${new URL(url).port}`, 'batch', '--bail'], {
  input: JSON.stringify(commands), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'],
});
process.exit(run.status ?? 1);
