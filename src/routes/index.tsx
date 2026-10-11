import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Search, Star, X, LoaderCircle, AlertCircle, ArrowRight } from 'lucide-react';
import type { ApiResult, Rating, SearchData, ScoredShow } from '@/lib/shows';
import { imdbIdFor, ratingFor, titleHref } from '@/lib/shows';

export const Route = createFileRoute('/')({ component: Home });

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [netflixOnly, setNetflixOnly] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [unknownByPage, setUnknownByPage] = useState<Record<number, number>>({});
  const [unknownTitlesByPage, setUnknownTitlesByPage] = useState<Record<number, string[]>>({});
  const input = useRef<HTMLInputElement>(null);
  const resultButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const clean = query.trim();
  const unknown = Object.values(unknownByPage).reduce((sum, count) => sum + count, 0);
  const unknownTitles = [...new Set(Object.values(unknownTitlesByPage).flat())];

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setActive(-1);
    if (page === 1) { setShows([]); setSearched(false); setNextPage(null); setUnknownByPage({}); setUnknownTitlesByPage({}); setExpandedId(null); }
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
          <h1 id="headline">A title.<br /><span>A quick rating.</span></h1>
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
                    setActive(next); resultButtons.current[next]?.focus();
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
            {loading && !shows.length && !error && <div className="message"><LoaderCircle className="spinner" size={20} aria-hidden="true" /><p>{netflixOnly ? 'Checking Netflix around the world…' : 'Finding your title…'}</p></div>}
            {searched && !loading && !shows.length && !error && <div className="message"><Search size={22} aria-hidden="true" /><div><h2>{netflixOnly ? 'No confirmed Netflix matches yet' : 'No matching titles'}</h2><p>{netflixOnly ? nextPage ? 'There are more titles to check. Try more matches below.' : 'Try another name, or turn off Netflix only to see all titles.' : 'Try another name or check the spelling.'}</p></div></div>}
            {!!shows.length && <>
              <div className="results-heading"><span>{shows.length} {netflixOnly ? 'Netflix ' : ''}{shows.length === 1 ? 'match' : 'matches'}{nextPage !== null ? ' so far' : ''}</span><span>Rating /10</span></div>
              <ul className="results-list" aria-label="Matching movies and TV shows">
                {shows.map((show, index) => {
                  const rating = ratingFor(show);
                  const imdbPending = !!imdbIdFor(show) && !show.rating && !show.failed;
                  const expanded = expandedId === show.id;
                  const detailsId = `rating-details-${show.id}`;
                  const imdbStatus = imdbPending ? 'Checking IMDb via OMDb…' : show.failed ? 'IMDb score couldn’t load from OMDb.' : imdbIdFor(show) ? 'IMDb score unavailable from OMDb.' : 'No IMDb link available from the catalog.';
                  return <li key={show.id}>
                    <button type="button" ref={node => { resultButtons.current[index] = node; }} className={active === index ? 'result-link active' : 'result-link'}
                      aria-expanded={expanded} aria-controls={detailsId}
                      aria-label={`${show.title}, ${show.year}, ${show.mediaType === 'movie' ? 'movie' : 'TV series'}, ${rating ? `${rating.source} ${rating.score} out of 10` : imdbPending ? 'rating loading' : 'rating unavailable'}. ${expanded ? 'Hide' : 'Show'} rating details.`}
                      onClick={() => setExpandedId(expanded ? null : show.id)}
                      onFocus={() => setActive(index)} onBlur={() => setActive(-1)}
                      onKeyDown={event => {
                        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                          event.preventDefault();
                          const next = event.key === 'ArrowDown' ? Math.min(index + 1, shows.length - 1) : index - 1;
                          if (next < 0) input.current?.focus(); else resultButtons.current[next]?.focus();
                        }
                        if (event.key === 'Escape') { setExpandedId(null); input.current?.focus(); }
                      }}>
                      <span className="show-info"><span className="show-title">{show.title}</span><span className="show-meta">{show.year} <span>·</span> {show.mediaType === 'movie' ? 'Movie' : 'TV series'}{show.netflixCountries && <> <span>·</span> Netflix in {show.netflixCountries.length} {show.netflixCountries.length === 1 ? 'country' : 'countries'}</>}</span></span>
                      <span className="rating-info"><span className="rating-value">{rating ? <><span className="rating-source">{rating.source}</span><span className="rating-number"><Star size={15} fill="currentColor" aria-hidden="true" /><strong>{rating.score}</strong><span className="out-of">/10</span></span></> : imdbPending ? <LoaderCircle size={18} className="spinner" aria-label="Loading IMDb rating" /> : <span className="rating-status">Unavailable</span>}</span><ChevronDown size={16} className={expanded ? 'result-chevron expanded' : 'result-chevron'} aria-hidden="true" /></span>
                    </button>
                    <div id={detailsId} className="rating-details" hidden={!expanded}>
                      <p>{rating?.source === 'IMDb' ? 'IMDb user rating via OMDb.' : <>{imdbStatus} {rating?.source === 'TMDb' ? 'Showing a separate TMDb user rating—not an IMDb score.' : !imdbPending ? 'No TMDb rating available either.' : ''}</>}</p>
                      {rating?.votes && <p>{rating.votes} {rating.votes === '1' ? 'vote' : 'votes'} on {rating.source}.</p>}
                      <a className="source-link" href={titleHref(show)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${show.title} on ${imdbIdFor(show) ? 'IMDb' : 'TMDb'} in a new tab`}>Open {imdbIdFor(show) ? 'IMDb' : 'TMDb'} <ArrowUpRight size={14} aria-hidden="true" /></a>
                    </div>
                  </li>;
                })}
              </ul>
              <p className="partial-note">IMDb first. TMDb fallback, clearly labeled. Tap a title for rating details.</p>
              {shows.some(show => show.failed) && <p className="partial-note">Some IMDb scores couldn’t load. TMDb ratings are shown where available.</p>}
            </>}
            {netflixOnly && unknown > 0 && <div className="partial-note">Availability couldn’t be verified for {unknown} {unknown === 1 ? 'title' : 'titles'}{unknownTitles.length ? `, including ${unknownTitles.slice(0, 3).join(', ')}` : ''}. Unverified titles are excluded. New releases may not have streaming data yet.<br /><button className="text-button" onClick={() => { setNetflixOnly(false); setPage(1); }}>Show all matches <ArrowRight size={14} /></button></div>}
            {!error && searched && nextPage !== null && <button className="more-button" disabled={loading} onClick={() => setPage(nextPage)}>{loading ? netflixOnly ? 'Checking availability…' : 'Loading ratings…' : 'More matches'}<ArrowRight size={16} /></button>}
            {netflixOnly && searched && <p className="partial-note">Available in at least one country covered by the data—not necessarily yours. Availability can change.</p>}
          </div>
        </section>
      </main>
      <footer><span>Just the score. Nothing more.</span><div className="footer-info"><span>IMDb via OMDb <span className="footer-dot">·</span> TMDb fallback <span className="footer-dot">·</span> Not affiliated with Netflix or IMDb.</span><details className="data-credits"><summary>Data credits</summary><div className="credits-content"><a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer"><img src="/tmdb-logo.svg" alt="TMDB" width="56" height="40" /></a><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>Streaming availability provided by <a href="https://www.justwatch.com" target="_blank" rel="noopener noreferrer">JustWatch</a> via TMDB.</p></div></details></div></footer>
    </div>
  );
}
