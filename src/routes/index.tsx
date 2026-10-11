import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Search, Star, X, LoaderCircle, AlertCircle, ArrowRight } from 'lucide-react';
import type { ApiResult, Rating, SearchData, Show } from '@/lib/shows';
import { imdbIdFor, titleHref } from '@/lib/shows';

export const Route = createFileRoute('/')({ component: Home });
type ScoredShow = Show & { rating?: Rating; failed?: boolean };

async function lookup<T>(params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/lookup?${new URLSearchParams(params)}`, { signal });
  if (!response.ok) throw new Error('Couldn’t connect. Please try again.');
  const result: ApiResult<T> = await response.json();
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

function Home() {
  const [query, setQuery] = useState('');
  const [shows, setShows] = useState<ScoredShow[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(-1);
  const [netflixOnly, setNetflixOnly] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [unknownByPage, setUnknownByPage] = useState<Record<number, number>>({});
  const [unknownTitlesByPage, setUnknownTitlesByPage] = useState<Record<number, string[]>>({});
  const input = useRef<HTMLInputElement>(null);
  const anchors = useRef<(HTMLAnchorElement | null)[]>([]);
  const clean = query.trim();
  const unknown = Object.values(unknownByPage).reduce((sum, count) => sum + count, 0);
  const unknownTitles = [...new Set(Object.values(unknownTitlesByPage).flat())];

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setActive(-1);
    if (page === 1) { setShows([]); setSearched(false); setNextPage(null); setUnknownByPage({}); setUnknownTitlesByPage({}); }
    if (clean.length < 2) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await lookup<SearchData>({ q: clean, page: String(page), ...(netflixOnly ? { netflix: '1' } : {}) }, controller.signal);
        if (controller.signal.aborted) return;
        setShows(previous => page === 1 ? data.shows : [...previous, ...data.shows.filter(show => !previous.some(item => item.id === show.id))]);
        setNextPage(data.nextPage !== undefined ? data.nextPage : page < 100 && page * 10 < data.total ? page + 1 : null);
        setUnknownByPage(previous => ({ ...previous, [page]: data.unknown ?? 0 }));
        setUnknownTitlesByPage(previous => ({ ...previous, [page]: data.unknownTitles ?? [] }));
        setSearched(true);
        // Three workers fill in scores progressively, without ten simultaneous browser requests.
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(3, data.shows.length) }, async () => {
          while (cursor < data.shows.length && !controller.signal.aborted) {
            const show = data.shows[cursor++];
            const imdbId = imdbIdFor(show);
            if (!imdbId) continue;
            try {
              const rating = await lookup<Rating>({ id: imdbId }, controller.signal);
              if (!controller.signal.aborted) setShows(previous => previous.map(item => item.id === show.id ? { ...item, rating } : item));
            } catch {
              if (!controller.signal.aborted) setShows(previous => previous.map(item => item.id === show.id ? { ...item, failed: true } : item));
            }
          }
        }));
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Couldn’t connect. Please try again.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [clean, page, retry, netflixOnly]);

  function change(value: string) { setQuery(value); setPage(1); setActive(-1); }

  return (
    <div className="app-shell">
      <header className="masthead"><a className="wordmark" href="/" aria-label="ShowScore home"><span className="brand-mark"><Star size={17} fill="currentColor" /></span>ShowScore<span className="wordmark-dot">.</span></a><span className="header-note">Less scrolling. Better watching.</span></header>
      <main>
        <section className="lookup-section" aria-labelledby="headline">
          <p className="eyebrow">THE QUICK RATING CHECK</p>
          <h1 id="headline">A title.<br /><span>An IMDb rating.</span></h1>
          <p className="intro">Know the score before you press play.</p>
          <div className="search-area">
            <label className="sr-only" htmlFor="show-search">Search for a movie or TV show</label>
            <div className="search-box">
              <Search size={22} aria-hidden="true" />
              <input ref={input} id="show-search" type="search" placeholder="What are you watching?" autoComplete="off" maxLength={100}
                value={query} onChange={event => change(event.target.value)} aria-describedby="search-help"
                onKeyDown={event => {
                  if (event.key === 'Escape') { change(''); return; }
                  if (shows.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault();
                    const next = event.key === 'ArrowDown' ? Math.min(active + 1, shows.length - 1) : Math.max(active - 1, 0);
                    setActive(next); anchors.current[next]?.focus();
                  }
                }} />
              {query ? <button className="clear-button" aria-label="Clear search" onClick={() => { change(''); input.current?.focus(); }}><X size={19} /></button> : <kbd aria-hidden="true">Type to search</kbd>}
            </div>
            <div className="search-options">
              <p id="search-help" className="search-help">{netflixOnly ? 'On Netflix in any country.' : 'Movies & TV shows. No guessing.'}</p>
              <label className="netflix-toggle"><input type="checkbox" checked={netflixOnly} onChange={event => { setNetflixOnly(event.target.checked); setPage(1); }} /><span className="toggle-track" aria-hidden="true" /><span>Netflix only</span></label>
            </div>
            {!query && <div className="suggestions"><span>Try</span>{['Stranger Things', 'Dark', 'The Crown'].map(title => <button key={title} onClick={() => { change(title); input.current?.focus(); }}>{title}<ArrowUpRight size={13} /></button>)}</div>}
          </div>
          <div className="results-region" aria-busy={loading}>
            <p className="sr-only" role="status">{error ? error : loading ? netflixOnly ? 'Checking Netflix availability and loading ratings.' : 'Searching and loading ratings.' : searched ? `${shows.length} matching titles.` : ''}</p>
            {error && <div className="message error-message"><AlertCircle size={22} aria-hidden="true" /><div><h2>Couldn’t get the score</h2><p>{error}</p><button className="text-button" onClick={() => setRetry(value => value + 1)}>Try again <ArrowRight size={14} /></button></div></div>}
            {loading && !shows.length && !error && <div className="message"><LoaderCircle className="spinner" size={20} aria-hidden="true" /><p>{netflixOnly ? 'Checking Netflix around the world…' : 'Finding your show…'}</p></div>}
            {searched && !loading && !shows.length && !error && <div className="message"><Search size={22} aria-hidden="true" /><div><h2>{netflixOnly ? 'No confirmed Netflix matches yet' : 'No matching titles'}</h2><p>{netflixOnly ? nextPage ? 'There are more titles to check. Try more matches below.' : 'Try another name, or turn off Netflix only to see all titles.' : 'Try another name or check the spelling.'}</p></div></div>}
            {!!shows.length && <>
              <div className="results-heading"><span>{shows.length} {netflixOnly ? 'Netflix ' : ''}{shows.length === 1 ? 'match' : 'matches'}{nextPage !== null ? ' so far' : ''}</span><span>IMDb rating</span></div>
              <ul className="results-list" aria-label="Matching TV shows">
                {shows.map((show, index) => <li key={show.id}>
                  <a ref={node => { anchors.current[index] = node; }} href={titleHref(show)} target="_blank" rel="noopener noreferrer" className={active === index ? 'result-link active' : 'result-link'}
                    aria-label={`${show.title}, ${show.year}, ${show.mediaType === 'movie' ? 'movie' : 'TV series'}, ${show.rating?.score ? `IMDb ${show.rating.score} out of 10` : !imdbIdFor(show) ? 'IMDb link pending' : show.failed || show.rating?.unavailable ? 'rating unavailable' : show.rating ? 'no score yet' : 'rating loading'}. Open ${imdbIdFor(show) ? 'IMDb' : 'TMDB'} in a new tab.`}
                    onFocus={() => setActive(index)} onBlur={() => setActive(-1)}
                    onKeyDown={event => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const next = event.key === 'ArrowDown' ? Math.min(index + 1, shows.length - 1) : index - 1;
                        if (next < 0) input.current?.focus(); else anchors.current[next]?.focus();
                      }
                      if (event.key === 'Escape') input.current?.focus();
                    }}>
                    <span className="show-info"><span className="show-title">{show.title}</span><span className="show-meta">{show.year} <span>·</span> {show.mediaType === 'movie' ? 'Movie' : 'TV series'}{show.netflixCountries && <> <span>·</span> Netflix in {show.netflixCountries.length} {show.netflixCountries.length === 1 ? 'country' : 'countries'}</>}</span></span>
                    <span className="rating-info">{show.rating?.score ? <><Star size={15} fill="currentColor" aria-hidden="true" /><strong>{show.rating.score}</strong><span className="out-of">/10</span></> : !imdbIdFor(show) ? <span className="rating-status">IMDb link pending</span> : show.failed || show.rating?.unavailable ? <span className="rating-status">Unavailable</span> : show.rating ? <span className="rating-status">No score yet</span> : <LoaderCircle size={18} className="spinner" aria-label="Loading rating" />}<ArrowUpRight size={16} className="result-arrow" aria-hidden="true" /></span>
                  </a>
                </li>)}
              </ul>
              {shows.some(show => show.failed) && <p className="partial-note">Some scores couldn’t load. You can still check them on IMDb.</p>}
              {shows.some(show => !imdbIdFor(show) || show.rating?.unavailable) && <p className="partial-note">New titles can appear before their IMDb links or scores reach our providers. Open a title to check its source.</p>}
            </>}
            {netflixOnly && unknown > 0 && <div className="partial-note">Availability couldn’t be verified for {unknown} {unknown === 1 ? 'title' : 'titles'}{unknownTitles.length ? `, including ${unknownTitles.slice(0, 3).join(', ')}` : ''}. Unverified titles are excluded. New releases may not have streaming data yet.<br /><button className="text-button" onClick={() => { setNetflixOnly(false); setPage(1); }}>Show all matches <ArrowRight size={14} /></button></div>}
            {!error && searched && nextPage !== null && <button className="more-button" disabled={loading} onClick={() => setPage(nextPage)}>{loading ? netflixOnly ? 'Checking availability…' : 'Loading ratings…' : 'More matches'}<ArrowRight size={16} /></button>}
            {netflixOnly && searched && <p className="partial-note">Available in at least one country covered by the data—not necessarily yours. Availability can change.</p>}
          </div>
        </section>
      </main>
      <footer><span>Just the score. Nothing more.</span><div className="footer-info"><span>Ratings via OMDb <span className="footer-dot">·</span> Not affiliated with Netflix or IMDb.</span><details className="data-credits"><summary>Data credits</summary><div className="credits-content"><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer"><img src="/tmdb-logo.svg" alt="TMDB" width="56" height="40" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Streaming availability provided by <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer">JustWatch</a> via TMDB.</p></div></details></div></footer>
    </div>
  );
}
