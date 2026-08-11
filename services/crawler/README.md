# Crawler Service

Hybrid web crawler that indexes both static HTML and JavaScript-rendered pages into Elasticsearch. Uses Playwright for SPA content extraction.

## How It Works

### Entry Point (`src/index.ts`)

1. **`--fresh` flag** — clears all Redis queues if passed
2. **`ensureIndex()`** — creates ES index with custom analyzers/mappings if missing
3. **`loadSeeds()`** — reads `seeds/seeds.txt`, enqueues URLs, discovers sitemaps per domain
4. **`startAllWorkers()`** — launches 6 worker types
5. Registers `SIGINT`/`SIGTERM` for graceful shutdown

### Worker Types

#### 1. Crawler Workers (`src/workers/crawler.ts`)

**Count:** Configurable via `CRAWLER_WORKERS` (default 15)

Blocking `BLPOP` on `crawl:queue` with 5s timeout. Per-job pipeline:

1. Normalize URL + safety check (no private IPs, HTTP only)
2. Robots.txt check (1h cache per domain)
3. Global token bucket rate limit + domain rate limit (distributed lock)
4. Dedup via Lua atomic check-and-set on `indexed:urls` sorted set
5. Domain concurrency cap — max 2 concurrent requests per domain (Redis INCR)
6. Fetch via `fetchUrl()` — HTTP first, Playwright fallback if SPA detected
7. If JS-rendered → push to `playwright:queue`
8. Extract content + links from HTML
9. Index to ES (upsert by URL)
10. Discover sitemaps once per domain
11. Enqueue discovered links to `crawl:queue`

Logs aggregate stats every 30s (queue depths, indexed count).
Respects memory backpressure — pauses when RSS exceeds 1.5GB.

#### 2. Playwright Workers (`src/workers/playwright.ts`)

**Count:** Dynamic (0 to `PLAYWRIGHT_WORKERS`, scaled by Playwright Manager)

`BRPOPLPUSH` from `playwright:queue` to per-worker processing list.
Used for JS-rendered (SPA) pages only.

#### 3. Playwright Manager (`src/workers/playwright-manager.ts`)

Runs `setInterval` every 5s. Checks `playwright:queue` depth; scales workers up (one per 20 items) and down (after 60s idle). Caps queue at 5,000 items.

#### 4. Reindex Worker (`src/workers/reindex.ts`)

Runs initial cycle on start, repeats every `reindexAfterHours` (default 24h). Queries ES for stale pages (`lastIndexed` older than threshold) and pushes to `reindex:queue`. Content-unchanged optimization skips re-indexing.

#### 5. Retry Processor (`src/workers/retry-processor.ts`)

Polls every 30s. Finds scheduled retry jobs (`zrangebyscore retry:queue`), converts to `CrawlJob` with `source: 'retry'`, pushes to `crawl:queue`.

#### 6. Retry + Error Handling (in `crawler.ts` — `handleFetchError`)

- 404/410/503 → remove from indexed set permanently
- Non-retry jobs → push to `retry:queue` with first delay (5min)
- Retry jobs with remaining attempts → push with escalating delays (5min → 10min → 20min)
- Exhausted retries → dropped silently

### Redis Data Model

| Key | Type | Purpose |
|---|---|---|
| `crawl:queue` | List | Main crawl job queue (max 50K) |
| `playwright:queue` | List | SPA pages needing headless browser |
| `reindex:queue` | Sorted Set | URLs to reindex (score = timestamp) |
| `retry:queue` | Sorted Set | Failed fetch retries (score = scheduled retry time) |
| `indexed:urls` | Sorted Set | URL → lastIndexed timestamp (dedup) |
| `domain:last:<domain>` | String | Last request timestamp per domain (TTL 10s) |
| `domain:last:lock:<domain>` | String | Distributed lock for domain rate limiting (TTL 5s) |
| `domain:active:<domain>` | String | Active concurrent requests per domain (TTL 30s, cap 2) |
| `sitemaps:discovered` | Set | Domains that had sitemap discovery run |
| `seed:loaded:seeds.txt` | String | Hash of seeds file content (skip reload if unchanged) |
| `processing:playwright:<id>` | List | Playwright in-flight jobs per worker |

### Fetch Pipeline (`src/fetcher/`)

**Tier 1 — HTTP** (`fetcher/http.ts`):
- Native `fetch()` with browser-like headers
- 30s timeout via `AbortController`
- SPA detection (3 tiers): HTTP headers → framework markers (`__next_data__`, `data-reactroot`, `ng-app`, etc.) → statistical heuristics (≥30 scripts, text/HTML ratio < 0.05)
- Anti-bot detection: 401/403/503, Cloudflare, DataDome, Incapsula, PerimeterX
- 429 handling with `Retry-After` respect

**Tier 2 — Playwright** (`fetcher/playwright-client.ts`):
- Lazy singleton Chromium instance, headless
- Circuit breaker on launch failure (5 failures, 30s reset)
- Page semaphore (`PLAYWRIGHT_CONCURRENT_PAGES`, default 2)
- `goto` with `waitUntil: 'load'` + 3s buffer + `networkidle` (5s, non-fatal)

**Escalation:** HTTP failure → Playwright fallback. HTTP success with strong SPA signal → upgrade to Playwright.

**Robots.txt** (`fetcher/robots.ts`):
- Fetched per-domain, 1h cache TTL
- `Disallow`, `Allow`, `Crawl-Delay` parsing with path matching

**Sitemap Discovery** (`fetcher/sitemap.ts`):
- 7 common paths + robots.txt `Sitemap:` directives
- Recursive index parsing (max depth 3, max 5K URLs/domain, 3 concurrent)

### Content Extraction (`src/extractor/`)

**Parser:** Cheerio (jQuery-like, no DOM overhead)

**Content** (`extractor/content.ts`):
- Smart container detection: `<article>` → `<main>` → `[role="main"]` → `#content` → `.content` → fallback
- Boilerplate filter: Wikipedia UI text, video modals, cookie banners, navigation labels, edit links
- Min paragraph length: 30 chars

**Links** (`extractor/links.ts`):
- All `<a href>`, resolved against base URL
- Tracking param stripping (`utm_source`, `click_id`, etc.)
- Same-domain prioritized (breadth-first ordering)
- Max 50 links per page

**Metadata** (`extractor/metadata.ts`): `meta description`, `meta keywords`, `og:title`, `og:description`, `og:image`

**Language Detection:** `franc-min` on first 500 chars

**Content Hash:** SHA-256 of full text (reindex optimization)

### Indexing (`src/indexer/`)

**ES Index:** Created on startup with custom analyzers:
- `search_analyzer`: standard tokenizer + lowercase + english stemmer + stop + `my_synonym_graph` + `word_delimiter_graph`
- `autocomplete`: edge_ngram (2-10, letter+digit) + lowercase
- 30+ synonym pairs: `js/javascript`, `react/reactjs`, `ts/typescript`, `css/styles`, etc.

**Mapping:** Title, headers, paragraphs, fullText all `copy_to: 'all_text'` for blanket search. `all_text.highlight` sub-field uses `standard` analyzer for verbatim snippets.

**Operations** (`indexer/operations.ts`):
- `indexPage(document)` — upsert by URL as `_id`
- `getPage(url)` — fetch existing doc (content-unchanged check)
- `touchPage(url)` — update only timestamps (content unchanged)
- `deletePage(url)` — remove from index
- `getPagesOlderThan(hours, size)` — reindex candidates
- `getTotalPages()` — doc count

### Utilities (`src/utils/`)

| File | Purpose |
|---|---|
| `url.ts` | `normalizeUrl`, `getDomain`, `isValidUrl`, `isSafeUrl`, `resolveUrl` |
| `hash.ts` | `computeContentHash` (SHA-256), `computeShortHash` |
| `logger.ts` | Winston logger with optional 10MB rotation |
| `retry.ts` | `withRetry` exponential backoff, rate-limit-aware |
| `memory.ts` | RSS monitoring, backpressure flag at 1.5GB |
| `circuit-breaker.ts` | Per-service CLOSED/OPEN/HALF_OPEN |

## Configuration

See `.env.example` for all options. Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `CRAWLER_WORKERS` | 15 | HTTP fetch concurrency |
| `PLAYWRIGHT_WORKERS` | 5 | Max JS render workers |
| `DOMAIN_DELAY_MS` | 200 | Min delay between same-domain requests |
| `GLOBAL_RPS` | 10 | Global rate limit |
| `MAX_RETRIES` | 3 | Max fetch retry attempts |
| `RETRY_DELAYS` | `300000,600000,1200000` | Escalating delays (ms) |

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `bun run dev` | Dev with ts-node watch |
| `build` | `bun run build` | TypeScript build |
| `start` | `bun run start` | Run production build |
| `load-seeds` | `bun run load-seeds` | Enqueue seed URLs + discover sitemaps |
| `reindex` | `bun run reindex` | One-shot: push stale pages to reindex queue |
| `reset` | `bun run reset` | Interactive: delete ES index + clear Redis |
| `submit <url>` | `bun run submit <url>` | Push priority URL to front of queue |
| `stats` | `bun run stats` | Show all crawler statistics |
| `stats:indexed` | `bun run stats:indexed` | Indexed page count |
| `stats:queues` | `bun run stats:queues` | Queue depths |
| `stats:domains` | `bun run stats:domains` | Top crawled domains |
| `stats:recent` | `bun run stats:recent` | Recently indexed pages |
| `stats:speed` | `bun run stats:speed` | Crawl speed metrics |
| `stats:content-type` | `bun run stats:content-type` | Static vs JS distribution |
| `stats:size` | `bun run stats:size` | Page size distribution |

## Key Types

```typescript
CrawlJob          { url, depth, source: 'seed'|'link'|'reindex'|'retry', enqueuedAt, attempt?, maxAttempts? }
RetryJob          { url, domain, attempt, maxAttempts?, enqueuedAt }
PageDocument      { url, domain, title, content: { h1-h6, paragraphs, fullText }, metaDescription, metaKeywords, og*, depth, contentType, wordCount, language, firstIndexed, lastIndexed, updatedAt, contentHash }
ExtractedContent  { title, content, metadata, wordCount, contentHash, language }
FetchResult       { html, contentType: 'static'|'javascript' }
```