# Crawler Service

Hybrid web crawler that indexes static HTML and JS-rendered (SPA) pages into Elasticsearch. Uses Playwright as fallback when SPA detection triggers.

## Architecture

```
Seeds/Sitemaps → crawl:queue (Redis List) → Crawler Workers (HTTP fetch)
                                                    ↓
                                         SPA detected? → playwright:queue (Redis List) → Playwright Workers
                                                    ↓
                                         Extractor (Cheerio) → ES index (crawled_pages)
                                                    ↓
                                         Links enqueued back to crawl:queue
```

Two Redis-backed queues feed into two worker pools. Elasticsearch is the durable store. Search API reads same index.

### Startup (`src/index.ts`)

1. `--fresh` flag clears all Redis queues
2. `ensureIndex()` creates ES index `crawled_pages` with custom analyzers/mappings
3. `loadSeeds()` reads `seeds/seeds.txt`, enqueues URLs, discovers sitemaps per domain
4. `startAllWorkers()` launches all worker types
5. `SIGINT`/`SIGTERM` triggers graceful shutdown (drain queues, close browser, quit Redis)

### Worker Types

#### 1. Crawler Workers (`src/workers/crawler.ts`)

**Count:** `CRAWLER_WORKERS` (default 5)

Blocking `BLPOP` on `crawl:queue` with 5s timeout. Per-job pipeline:

1. Normalize URL + safety check (no private IPs, HTTP(S) only)
2. Robots.txt check (1h cache per domain)
3. Global token bucket rate limit + distributed domain rate limit (Redis lock)
4. Dedup via Lua atomic check-and-set on `indexed:urls` sorted set
5. Domain concurrency cap — max 2 concurrent requests per domain (Redis INCR with 30s TTL)
6. Fetch via HTTP — if SPA detected or HTTP fails, enqueue to `playwright:queue`
7. Extract content + links via Cheerio
8. Index to ES (upsert by URL as `_id`)
9. Enqueue discovered links to `crawl:queue` (same-domain prioritized)

Logs aggregate stats every 30s. Respects memory backpressure — pauses when RSS > 1.5GB.

#### 2. Playwright Workers (`src/workers/playwright.ts`)

**Count:** Dynamic (0 to `PLAYWRIGHT_WORKERS`, default 2)

`BRPOPLPUSH` from `playwright:queue` to per-worker processing list. Renders SPAs and returns full HTML. Circuit breaker: 5 consecutive launch failures blocks all requests for 30s.

#### 3. Playwright Manager (`src/workers/playwright-manager.ts`)

Polls every 5s. Scales Playwright workers: 1 per 20 queue items. Idle 60s → scale down. Caps queue at 5,000.

#### 4. Reindex Worker (`src/workers/reindex.ts`)

Runs initial cycle on start, repeats every `reindexAfterHours` (default 24h). Queries ES for pages with `lastIndexed` older than threshold, pushes to `reindex:queue`. Content-hash optimization: if hash unchanged, calls `touchPage()` (timestamp-only update) instead of full `indexPage()`.

#### 5. Retry Processor (`src/workers/retry-processor.ts`)

Polls `retry:queue` every 30s. Finds scheduled retry jobs (`ZRANGEBYSCORE ... LIMIT 0 1`), converts to `CrawlJob { source: 'retry' }`, pushes to `crawl:queue`. Atomic ZRANGEBYSCORE + ZREM.

### Retry & Dead Link Handling

| Condition | Action |
|---|---|
| 404/410/503 | Remove from `indexed:urls` permanently |
| Error, non-retry job | Push to `retry:queue` with first delay (5min) |
| Error, retry job with attempts left | Escalating delays: 5min → 10min → 20min |
| Exhausted retries | Silently dropped |

### Redis Data Model

| Key | Type | Purpose |
|---|---|---|
| `crawl:queue` | List | Main crawl job queue (max 50K) |
| `playwright:queue` | List | SPA pages needing headless browser |
| `reindex:queue` | Sorted Set | URLs to reindex (score = timestamp) |
| `retry:queue` | Sorted Set | Failed fetch retries (score = retry time) |
| `indexed:urls` | Sorted Set | URL → lastIndexed timestamp (dedup, max 5M) |
| `domain:last:<domain>` | String | Last request timestamp (TTL 10s) |
| `domain:last:lock:<domain>` | String | Distributed lock for rate limiting (TTL 5s, NX) |
| `domain:active:<domain>` | String | Active concurrent requests (TTL 30s, cap 2) |
| `sitemaps:discovered` | Set | Domains with sitemap discovery completed |
| `seed:loaded:seeds.txt` | String | Hash of seeds file (skip reload if unchanged) |
| `processing:playwright:<id>` | List | Playwright in-flight jobs per worker |

### Fetch Pipeline (`src/fetcher/`)

**Tier 1 — HTTP** (`fetcher/http.ts`):
- Native `fetch()` with Chrome 120 browser-like headers
- 30s timeout via `AbortController`
- Content-type validation: rejects non-HTML responses
- SPA detection (3 tiers):
  - HTTP headers: `x-js-render`, `x-spa`, `x-nextjs-cached`
  - Framework markers: `__next_data__`, `data-reactroot`, `ng-app`, `data-vue`, `data-svelte`, root IDs (`app`, `mount`, `root`, `__next`), custom element shells
  - Statistical: ≥30 script tags, text/HTML ratio < 0.05, noscript JS-required fallback
- Anti-bot detection: Cloudflare, DataDome, Incapsula, PerimeterX, generic bot blocks, small response heuristic
- 429 handling with `Retry-After` header respect

**Tier 2 — Playwright** (`fetcher/playwright-client.ts`):
- Lazy singleton headless Chromium
- Page semaphore: `PLAYWRIGHT_CONCURRENT_PAGES` (default 2)
- Navigation: `goto` with `waitUntil: 'load'` → 3s buffer → `networkidle` (5s, non-fatal)

**Escalation:** HTTP success with strong SPA signal → upgrade to Playwright. HTTP failure → Playwright fallback.

**Robots.txt** (`fetcher/robots.ts`):
- Per-domain, 1h cache, `User-agent: *` only
- `Disallow`, `Allow` (takes precedence), `Crawl-Delay` parsed
- Path matching: exact match if rule ends with `$`, prefix `startsWith` otherwise

**Sitemap Discovery** (`fetcher/sitemap.ts`):
- 7 common paths (`/sitemap.xml`, `sitemap-index.xml`, etc.) + robots.txt `Sitemap:` directives
- Recursive index parsing: max depth 3, max 5K URLs/domain, 3 concurrent fetches
- Regex-based XML parsing, handles gzip, once per domain

### Content Extraction (`src/extractor/`)

Parser: Cheerio (jQuery-like, no DOM overhead).

**Content** (`extractor/content.ts`):
- Smart container: `<article>` → `<main>` → `[role="main"]` → `#content` → `.content` → Wikipedia-specific → fallback (body minus nav/footer/header/aside)
- Boilerplate filter: 50+ patterns (Wikipedia UI, cookie banners, edit links, nav labels, video modals)
- Min paragraph length: 30 chars

**Links** (`extractor/links.ts`):
- All `<a href>` resolved against base URL
- Tracking param stripping: `utm_source`, `utm_medium`, `utm_campaign`, `click_id`, `scm`, redirect paths, `x5secdata`
- Same-domain prioritized (breadth-first), max 50 per page, per-page dedup via Set

**Metadata** (`extractor/metadata.ts`): `meta description`, `meta keywords`, `og:title`, `og:description`, `og:image`

**Language Detection:** `franc-min` on first 500 chars of full text

**Content Hash:** SHA-256 of concatenated full text (reindex optimization)

### Indexing (`src/indexer/`)

**ES Index:** Created on startup with custom analyzers:
- `search_analyzer`: standard tokenizer + lowercase + english stemmer + stop + `my_synonym_graph` + `word_delimiter_graph`
- `autocomplete`: edge_ngram (2-10, letter+digit) + lowercase
- 30+ synonym pairs: `js/javascript`, `react/reactjs`, `ts/typescript`, `css/styles`, `api/apis/endpoint/endpoints`, etc.

**Mapping:** Title, headers, paragraphs, fullText all `copy_to: 'all_text'` for blanket search. `all_text.highlight` sub-field uses `standard` analyzer for verbatim snippets. `title_autocomplete` field for autocomplete queries.

**Operations** (`indexer/operations.ts`):
- `indexPage(document)` — upsert by URL as `_id` (`doc_as_upsert`)
- `getPage(url)` — fetch existing doc (used for content-unchanged check)
- `touchPage(url)` — update only timestamps (content unchanged)
- `deletePage(url)` — remove from index
- `getPagesOlderThan(hours, size)` — reindex candidates via ES range query
- `getTotalPages()` — ES count API

### Utilities (`src/utils/`)

| File | Purpose |
|---|---|
| `url.ts` | `normalizeUrl`, `getDomain`, `isValidUrl`, `isSafeUrl` (blocks private IPs), `resolveUrl` |
| `hash.ts` | `computeContentHash` (SHA-256) |
| `logger.ts` | Winston console + optional file rotation (10MB) |
| `retry.ts` | `withRetry` exponential backoff, rate-limit-aware (429/503/504 double base) |
| `memory.ts` | RSS monitoring, backpressure flag at 1.5GB, clears at 80% threshold |

## Configuration

See `.env.example` for all options. Key settings:

| Variable | Default | Description |
|---|---|---|
| `CRAWLER_WORKERS` | 5 | HTTP fetch concurrency |
| `PLAYWRIGHT_WORKERS` | 2 | Max JS render workers |
| `PLAYWRIGHT_CONCURRENT_PAGES` | 2 | Concurrent Playwright pages |
| `DOMAIN_DELAY_MS` | 200 | Min delay between same-domain requests |
| `GLOBAL_RPS` | 10 | Global requests per second |
| `MAX_RETRIES` | 3 | Max fetch retry attempts |
| `RETRY_DELAYS` | `300000,600000,1200000` | Escalating delays (ms) |
| `HTTP_FETCH_TIMEOUT` | 30000 | HTTP fetch timeout (ms) |
| `PLAYWRIGHT_TIMEOUT` | 30000 | Playwright navigation timeout |
| `WORKER_TIMEOUT` | 120000 | Max job processing time |
| `maxLinksPerPage` | 50 | Max links extracted per page |
| `minContentWords` | 50 | Min words to index (`wordCount`) |
| `maxDepth` | 5 | Max crawl depth from seed |
| `reindexAfterHours` | 24 | Hours before page eligible for reindex |
| `reindexBatchSize` | 10000 | Pages per reindex cycle |
| `sitemapMaxUrlsPerDomain` | 5000 | Max sitemap URLs per domain |
| `robotsCacheTtl` | 3600000 | robots.txt cache TTL (1h) |
| `memoryLimitBytes` | 1.5GB | RSS backpressure threshold |
| `circuitFailureThreshold` | 5 | Playwright failures before circuit opens |
| `circuitResetTimeout` | 30000 | Circuit reset time (ms) |
| `ES_INDEX` | crawled_pages | Index name |
| `ES_HOST` | http://localhost:9200 | ES endpoint |

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `bun run dev` | Dev mode via Bun |
| `build` | `bun run build` | TypeScript compilation |
| `start` | `bun run start` | Run production build |
| `load-seeds` | `bun run load-seeds` | Enqueue seed URLs + discover sitemaps |
| `reindex` | `bun run reindex` | One-shot: push stale pages to reindex queue |
| `reset` | `bun run reset` | Interactive: delete ES index + clear all Redis keys |
| `submit <url>` | `bun run submit <url>` | Push priority URL to front of crawl queue |
| `stats` | `bun run stats` | All statistics (indexed count, queue depths, top domains, recent, speed, content-type, size) |
| `stats:indexed` | `bun run stats:indexed` | Indexed page count only |
| `stats:queues` | `bun run stats:queues` | Queue depths only |
| `stats:domains` | `bun run stats:domains` | Top crawled domains |
| `stats:recent` | `bun run stats:recent` | Recently indexed pages |
| `stats:speed` | `bun run stats:speed` | Crawl speed metrics |
| `stats:content-type` | `bun run stats:content-type` | Static vs JS distribution |
| `stats:size` | `bun run stats:size` | Page size distribution |
| `reindex-mapping` | `bun run src/scripts/reindex-mapping.ts` | Interactive: reindex into temp index with updated mapping, swap via alias |

## Key Types

```typescript
CrawlJob          { url, depth, source: 'seed'|'link'|'reindex'|'retry', enqueuedAt, attempt?, maxAttempts? }
RetryJob          { url, domain, attempt, maxAttempts?, enqueuedAt }
IndexedUrl        { url, lastIndexed, firstIndexed }
PageDocument      { url, domain, title, content: { h1-h6, paragraphs, fullText }, metaDescription, metaKeywords, ogTitle, ogDescription, ogImage, depth, contentType: 'static'|'javascript', wordCount, language, firstIndexed, lastIndexed, updatedAt, contentHash, title_autocomplete? }
ExtractedContent  { title, content, metadata, wordCount, contentHash, language }
CrawlStats        { totalCrawled, totalIndexed, totalFailed, totalSkipped, queueLength, reindexQueueLength, indexedUrlCount }
```

## Integration

Crawler writes `PageDocument` objects to ES index `crawled_pages`. The Search API (`services/search-api/`) reads from the same index. No direct inter-service communication. The `all_text` field (aggregating title, headers, paragraphs, fullText, meta fields via `copy_to`) is the primary search target.