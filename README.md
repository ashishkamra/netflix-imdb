# ShowScore

A minimal movie and TV-show lookup: type a name, see matching titles and their IMDb ratings, with a clearly labeled TMDb fallback.

**Live site:** [ShowScore on Vercel](https://netflix-imdb-chi.vercel.app/)

## Data setup

Get an API key from https://www.omdbapi.com/apikey.aspx and configure `OMDB_API_KEY` as a **server-side environment variable**. Do not prefix it with `VITE_`, put it in source code, or commit it. The app shows an honest unavailable state until a key is configured. Visitors do not need accounts or keys.

TMDB provides title discovery for movies and TV series, with exact matches prioritized and newer exact-name matches first. IMDb external IDs link candidates to OMDb, which provides the IMDb ratings. Titles are not removed when an IMDb ID or OMDb rating is missing. When TMDB is not configured locally, unfiltered search falls back to OMDb for both movies and series. Searches are debounced, detail requests have bounded concurrency, and a bounded in-memory cache reduces requests. The free OMDb allowance is currently advertised as 1,000 requests per day. Check the providers' current terms, data-use rights, and attribution requirements before public launch.

## Fast rating fallback

IMDb scores via OMDb always take precedence. TMDb's separate user rating, clearly labeled **TMDb**, is shown while IMDb loads and retained if OMDb has no score or the lookup fails. TMDb scores and vote counts come from the existing search response, with no extra rating requests. Zero-vote, missing, or invalid TMDb scores are treated as unavailable, not as zero. IMDb and TMDb scores are never blended or mislabeled.

Tapping a title expands lightweight rating details inside ShowScore; it does not navigate or make another API request. The expanded area includes the displayed rating's source and vote count, an explanation of any fallback, and an optional **Open IMDb** link. Titles without an IMDb ID have an optional **Open TMDb** link instead. If neither source supplies a rating, the row shows **Unavailable**.

## Development

Install dependencies with `npm install`, then use `npm run dev` (or `sh startup.sh`). Run `npm run typecheck`, `npm run test:lookup`, and `npm run build` for verification.

## Vercel

Import this directory as the project's root. Use the `npm run build` build command; Nitro generates Vercel Build Output in `.vercel/output`. Configure `OMDB_API_KEY` and `TMDB_API_KEY` as server-side environment variables for the appropriate Preview/Production environments and redeploy. Do not treat this as a static GitHub Pages site: the lookup endpoint needs a server.

The Vercel Hobby plan is intended for personal, non-commercial projects and has usage limits. Cache, coalescing, daily request caps, and throttling in this MVP are per server instance, not global across Vercel instances. For heavier public traffic, add shared quota tracking/caching and platform-level rate limiting before launch. No database or authentication is used.

## Netflix-only filter

Configure `TMDB_API_KEY` as a server-side environment variable (Production and Preview on Vercel). It accepts a TMDB v3 API key or API Read Access Token. Never use a `VITE_` prefix. All-show searches continue to work without this key.

“Netflix only” checks subscription providers for each movie or TV series across every country listed by TMDB/JustWatch. TMDB IDs are used directly, so new titles do not need an IMDb link to qualify. Netflix and its ad-supported variants count; rental/purchase listings do not. Only confirmed matches are included. Availability is cached for one hour, can change, and is not a guarantee that the title is available in your country. Titles with unverified availability are named with an explanation and a “Show all matches” action. Very recent releases may not have provider information yet.

Search results are checked one candidate page at a time. “More matches” remains available even when a page has no confirmed Netflix matches; the displayed Netflix count is the number found so far, not an invented global count. Data credits include the required TMDB logo, disclaimer, and JustWatch attribution.

This app is not affiliated with Netflix or IMDb. Missing scores are shown as “Unavailable”, never as zero.
