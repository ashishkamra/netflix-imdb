import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Search, Star, X, LoaderCircle, AlertCircle, ArrowRight } from 'lucide-react';
import type { ApiResult, Rating, SearchData, Show } from '@/lib/shows';

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
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const anchors = useRef<(HTMLAnchorElement | null)[]>([]);
  const clean = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setActive(-1);
    if (page === 1) { setShows([]); setTotal(0); setSearched(false); }
    if (clean.length < 2) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await lookup<SearchData>({ q: clean, page: String(page) }, controller.signal);
        if (controller.signal.aborted) return;
        setShows(previous => page === 1 ? data.shows : [...previous, ...data.shows.filter(show => !previous.some(item => item.id === show.id))]);
        setTotal(data.total);
        setSearched(true);
        // Three workers fill in scores progressively, without ten simultaneous browser requests.
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(3, data.shows.length) }, async () => {
          while (cursor < data.shows.length && !controller.signal.aborted) {
            const show = data.shows[cursor++];
            try {
              const rating = await lookup<Rating>({ id: show.id }, controller.signal);
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
  }, [clean, page, retry]);

  function change(value: string) { setQuery(value); setPage(1); setActive(-1); }

  return (
    <div className="app-shell">
      <header className="masthead"><a className="wordmark" href="/" aria-label="ShowScore home"><span className="brand-mark"><Star size={17} fill="currentColor" /></span>ShowScore<span className="wordmark-dot">.</span></a><span className="header-note">Less scrolling. Better watching.</span></header>
      <main>
        <section className="lookup-section" aria-labelledby="headline">
          <p className="eyebrow">THE QUICK RATING CHECK</p>
          <h1 id="headline">A show name.<br /><span>An IMDb rating.</span></h1>
          <p className="intro">Know the score before you press play.</p>
          <div className="search-area">
            <label className="sr-only" htmlFor="show-search">Search for a TV show</label>
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
            <p id="search-help" className="search-help">TV shows only. All matches, no guessing.</p>
            {!query && <div className="suggestions"><span>Try</span>{['Stranger Things', 'Dark', 'The Crown'].map(title => <button key={title} onClick={() => { change(title); input.current?.focus(); }}>{title}<ArrowUpRight size={13} /></button>)}</div>}
          </div>
          <div className="results-region" aria-busy={loading}>
            <p className="sr-only" role="status">{error ? error : loading ? 'Searching and loading ratings.' : searched ? `${total} matching shows.` : ''}</p>
            {error && <div className="message error-message"><AlertCircle size={22} aria-hidden="true" /><div><h2>Couldn’t get the score</h2><p>{error}</p><button className="text-button" onClick={() => setRetry(value => value + 1)}>Try again <ArrowRight size={14} /></button></div></div>}
            {loading && !shows.length && !error && <div className="message"><LoaderCircle className="spinner" size={20} aria-hidden="true" /><p>Finding your show…</p></div>}
            {searched && !loading && !shows.length && !error && <div className="message"><Search size={22} aria-hidden="true" /><div><h2>No matching shows</h2><p>Try another name or check the spelling.</p></div></div>}
            {!!shows.length && <>
              <div className="results-heading"><span>{total} {total === 1 ? 'match' : 'matches'}</span><span>IMDb rating</span></div>
              <ul className="results-list" aria-label="Matching TV shows">
                {shows.map((show, index) => <li key={show.id}>
                  <a ref={node => { anchors.current[index] = node; }} href={`https://www.imdb.com/title/${show.id}/`} target="_blank" rel="noopener noreferrer" className={active === index ? 'result-link active' : 'result-link'}
                    aria-label={`${show.title}, ${show.year}, ${show.rating?.score ? `IMDb ${show.rating.score} out of 10` : show.failed ? 'rating unavailable' : show.rating ? 'not rated' : 'rating loading'}. Open IMDb in a new tab.`}
                    onFocus={() => setActive(index)} onBlur={() => setActive(-1)}
                    onKeyDown={event => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault();
                        const next = event.key === 'ArrowDown' ? Math.min(index + 1, shows.length - 1) : index - 1;
                        if (next < 0) input.current?.focus(); else anchors.current[next]?.focus();
                      }
                      if (event.key === 'Escape') input.current?.focus();
                    }}>
                    <span className="show-info"><span className="show-title">{show.title}</span><span className="show-meta">{show.year} <span>·</span> TV series</span></span>
                    <span className="rating-info">{show.rating?.score ? <><Star size={15} fill="currentColor" aria-hidden="true" /><strong>{show.rating.score}</strong><span className="out-of">/10</span></> : show.failed ? <span className="rating-status">Unavailable</span> : show.rating ? <span className="rating-status">Not rated</span> : <LoaderCircle size={18} className="spinner" aria-label="Loading rating" />}<ArrowUpRight size={16} className="result-arrow" aria-hidden="true" /></span>
                  </a>
                </li>)}
              </ul>
              {shows.some(show => show.failed) && <p className="partial-note">Some scores couldn’t load. You can still check them on IMDb.</p>}
              {!error && shows.length < total && page < 100 && <button className="more-button" disabled={loading} onClick={() => setPage(value => value + 1)}>{loading ? 'Loading ratings…' : 'More matches'}<ArrowRight size={16} /></button>}
            </>}
          </div>
        </section>
      </main>
      <footer><span>Just the score. Nothing more.</span><span>Ratings via OMDb <span className="footer-dot">·</span> Not affiliated with Netflix or IMDb.</span></footer>
    </div>
  );
}
