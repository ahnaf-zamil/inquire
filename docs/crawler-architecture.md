# Crawler Service Architecture

A robust, single-instance web crawler capable of indexing both static HTML and JavaScript-rendered pages. Designed for high performance with smart content extraction and strict resource guardrails.

## Overview

The crawler service is a TypeScript/Node.js application that:

- Crawls web pages starting from seed URLs
- Extracts structured content (headers, paragraphs, metadata) using smart content detection
- Supports both static HTML and JavaScript-rendered pages (via Playwright)
- Stores indexed content in Elasticsearch
- Uses Redis for queue management and atomic deduplication
- Automatically reindexes pages every 24 hours
- Features retry logic with exponential backoff for transient failures

## Key Constraints

| Constraint | Value | Purpose |
|------------|-------|---------|
| Max Indexed Pages | 5,000,000 | Hard cap to prevent unbounded growth |
| Max Crawl Queue | 50,000 | Backpressure to avoid memory issues |
| Max Playwright Queue | 5,000 | Backpressure for JS pages |
| Max Crawl Depth | 5 levels | Prevents infinite crawl chains |
| Reindex Cycle | 24 hours | Keeps content fresh |
| Domain Rate Limit | 200ms (configurable) | Respectful crawling |
| Global Rate Limit | 10 RPS | Prevents overwhelming targets |
| Memory Limit | 1.5GB soft limit | Prevents system resource exhaustion |
| Idle Shutdown | 60 seconds | Auto-stop browser when queue empty |

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CRAWLER SERVICE                           │
│                                                                  │
│  ┌────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │ Seed Loader│───▶│ Crawler Workers │───▶│ Playwright Pool │  │
│  │  (.txt)    │    │   (15 workers)  │    │   (5 workers)   │  │
│  └────────────┘    └─────────────────┘    └─────────────────┘  │
│                            │                        │           │
│                            └──────────┬─────────────┘           │
│                                       ▼                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      REDIS                                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │crawl:queue  │  │reindex:queue│  │processing:{id}  │  │   │
│  │  │(max 10K)    │  │(sorted set) │  │(per-worker)     │  │   │
│  │  │List         │  │ZSET         │  │List             │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │   │
│  │  │indexed:urls │  │domain:last  │  │global:rate      │  │   │
│  │  │(5M cap)     │  │(rate limit) │  │(token bucket)   │  │   │
│  │  │ZSET         │  │Hash         │  │ZSET             │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    ELASTICSEARCH                          │   │
│  │  Index: pages (structured content + metadata)             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────┐
│  REINDEX CRON JOB   │  (Separate process, runs every 24h)
│  - Queries ES for   │
│    pages > 24h old  │
│  - Adds to          │
│    reindex:queue    │
└─────────────────────┘
```

## Components

### 1. Worker Pools

| Worker Type | Default | Configurable | Purpose |
|-------------|---------|--------------|---------|
| Crawler Workers | 15 | Yes (CRAWLER_WORKERS) | Fetch static HTML, extract content, queue links |
| Playwright Workers | 2 | Yes (PLAYWRIGHT_WORKERS) | Handle JavaScript-rendered pages |
| Reindex Worker | 1 | No | Process pages needing reindexing |

### 2. Playwright Singleton

One shared Chromium browser across all Playwright workers:
- Multiple workers share a single browser instance
- Each worker gets a dedicated tab for parallel processing
- Tabs are opened/fetched/closed per request
- Auto-shutdown after 60s of idle queue

### 2. Queue System (Redis)

| Queue | Type | Max Size | Purpose |
|-------|------|----------|---------|
| `crawl:queue` | List | 50,000 | URLs awaiting crawl |
| `playwright:queue` | List | 5,000 | JavaScript-rendered pages |
| `reindex:queue` | ZSet | Unlimited | URLs scheduled for reindex |
| `processing:{id}` | List | Dynamic | In-flight URLs per worker |
| `indexed:urls` | ZSet | 5,000,000 | All indexed URLs (atomic dedup via Lua) |
| `domain:last:{domain}` | String | Dynamic | Last request time per domain (10s TTL) |
| `domain:last:lock:{domain}` | String | Dynamic | Distributed lock for rate limiting |
| `seed:loaded:{hash}` | String | N/A | Seed file hash (prevents re-seeding) |

### 3. Data Flow

#### URL Intake Logic

```
1. Normalize URL (lowercase, www-strip, port removal, etc.)
2. Check indexed:urls
   ├─ EXISTS AND < 24h old → SKIP (already fresh)
   ├─ EXISTS AND > 24h old → Queue for reindex, SKIP crawl
   └─ NEW → Continue
3. Check depth > 5 → DROP
4. Check queue size >= 10K → DROP
5. Check indexed count >= 5M → STOP accepting new URLs
6. Enqueue to crawl:queue
```

#### Crawler Worker Flow

```
1. Pop URL from crawl:queue
2. Check global rate limit (token bucket)
3. Check domain rate limit (wait if needed)
4. Atomic check-and-mark URL in Redis (prevents duplicates)
5. Fetch with HTTP (undici) with retry logic
6. Smart content extraction (targets main content, excludes boilerplate)
7. Check content quality:
   ├─ Word count >= 50 → Process as static
   └─ Word count < 50 → Queue to Playwright
8. Index to Elasticsearch with retry logic
9. Extract outbound links (max 50)
10. Queue new links to crawl:queue
```

#### Playwright Worker Flow

```
1. Pop URL from playwright:queue
2. Launch browser (singleton, shared across workers)
3. Navigate to URL (wait for networkidle)
4. Extract content (same structure as crawler)
5. Index to Elasticsearch
6. Extract and queue links
7. Cleanup processing queue entry
```

## Elasticsearch Schema

Index name: `pages`

### Mappings

| Field | Type | Purpose |
|-------|------|---------|
| `url` | keyword | Unique identifier |
| `domain` | keyword | For filtering by domain |
| `title` | text | Page title |
| `content.h1-h6` | text | Header tags (for future ranking) |
| `content.paragraphs` | text | Body content |
| `content.fullText` | text | Combined text for search |
| `metaDescription` | text | Meta description tag |
| `metaKeywords` | keyword | Meta keywords |
| `ogTitle`, `ogDescription`, `ogImage` | text/keyword | Open Graph metadata |
| `depth` | integer | Distance from seed URL (0-5) |
| `contentType` | keyword | "static" or "javascript" |
| `wordCount` | integer | Total words |
| `language` | keyword | ISO 639-1 code |
| `firstIndexed` | date | Initial index timestamp |
| `lastIndexed` | date | Last reindex timestamp |
| `updatedAt` | date | Document update time |
| `contentHash` | keyword | SHA256 of content (change detection) |

## Configuration

Environment variables (see `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ES_HOST` | `http://localhost:9200` | Elasticsearch URL |
| `ES_INDEX` | `crawled_pages` | Index name |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `CRAWLER_WORKERS` | `5` | Number of crawler workers |
| `PLAYWRIGHT_WORKERS` | `2` | Number of Playwright workers |
| `DOMAIN_DELAY_MS` | `200` | Delay between same-domain requests (ms) |
| `GLOBAL_RPS` | `10` | Global requests per second |
| `LOG_LEVEL` | `info` | Logging level |
| `PLAYWRIGHT_HEADLESS` | `true` | Run browser in headless mode |

## URL Normalization

All URLs are normalized to prevent duplicate indexing:

- **Lowercase**: `HTTP://Example.com` → `http://example.com`
- **WWW stripping**: `www.example.com` → `example.com`
- **Trailing slash**: `/page/` → `/page`
- **Query sorting**: `?b=1&a=2` → `?a=1&b=2`
- **Default port removal**: `:80` / `:443` → removed
- **Fragment removal**: `#section` → removed

## URL Filtering

Automatically filters garbage/tracking URLs:

- **Tracking parameters**: `utm_*`, `scm=`, `x5secdata`, `_____tmd_____*`, `ref=*`
- **Fragment removal**: `#section` → removed
- **Query normalization**: Sorted for consistency
- **Default port removal**: `:80`, `:443` removed

## Anti-Bot Detection

Detects and handles anti-bot protection:

- **Cloudflare**: 403 with `cf-ray` header
- **DataDome**: Custom headers / cookies
- **Incapsula**: 403 with `incap_*` header
- **PerimeterX**: 403 with `px-*` header
- **403/401 responses**: Throws error (triggers retry)
- **429 responses**: Throws error with proper status code (triggers retry with backoff)

## Rate Limiting Implementation

### Global Rate Limit (Token Bucket)
- In-memory token bucket algorithm
- Shared across all workers
- Default: 10 tokens per second
- Refills continuously based on elapsed time

### Per-Domain Rate Limit (Distributed Lock)
- Redis-based with distributed lock (SETNX)
- 200ms default delay between requests to same domain
- 10-second TTL on domain keys
- Auto-retries up to 10 times if lock contention

## Smart Content Extraction

The crawler uses intelligent content extraction to avoid boilerplate:

### Priority Selectors (in order)
1. `<article>` - Semantic HTML5 article tag
2. `<main>` - Main content area
3. `[role="main"]` - ARIA main landmark
4. `#content`, `.content` - Common content IDs/classes
5. `.mw-parser-output`, `#mw-content-text` - Wikipedia-specific
6. `.post-content`, `.article-content` - Blog/article patterns
7. `#bodyContent` - Wikipedia body content

### Boilerplate Filtering
Automatically excludes:
- Navigation menus and sidebars
- Footer content
- Header elements
- Advertisement sections
- Wikipedia navigation boxes
- Edit links and toolboxes
- Search forms
- Login/account links
- Cookie notices

### Result
- **Before**: 40,000-60,000 words per Wikipedia page (mostly boilerplate)
- **After**: 50-2,500 words (actual content only)
- **Speed improvement**: 2.5x faster crawling

## Thin Content Detection

Pages with thin content trigger Playwright fallback:

- Word count < 50, OR
- Text/HTML ratio < 0.1

This handles JavaScript-rendered pages that appear empty with simple HTTP fetch.

## Reindexing

A separate cron job runs every 24 hours:

1. Queries Elasticsearch for pages with `lastIndexed < now - 24h`
2. Queues URLs to `reindex:queue`
3. Reindex worker processes queue using shared indexing functions
4. Updates `lastIndexed` timestamp

## Guardrails

### Memory Protection

- Soft limit: 1.5GB
- Checked every 60 seconds
- Logs warning if exceeded
- Triggers backpressure when approaching limit

### Rate Limiting

**Global Rate Limit (Token Bucket)**
- Default: 10 requests per second
- Implemented with in-memory token bucket
- Prevents overwhelming target servers

**Per-Domain Rate Limit**
- Default: 200ms between requests to same domain
- Tracked in Redis with 10-second TTL
- Prevents hammering individual sites

### Queue Backpressure

- Crawl queue capped at 50,000 URLs
- Drops new URLs when at capacity
- Prevents unbounded memory growth

### Hard Cap

- Maximum 5 million indexed URLs
- Stops accepting new unique URLs at cap
- Reindexing continues normally

### Retry Logic

- **HTTP fetch**: 3 retries with exponential backoff (1s, 2s, 4s)
- **Elasticsearch indexing**: 3 retries with exponential backoff (2s, 4s, 6s)
- **Retryable errors**: Timeouts, connection refused, network errors

## Project Structure

```
services/crawler/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config.ts                # Configuration with validation
│   ├── types.ts                 # TypeScript interfaces
│   │
│   ├── queue/                   # Redis operations
│   │   ├── crawl.ts             # Crawl queue operations
│   │   ├── reindex.ts           # Reindex queue operations
│   │   ├── processing.ts        # Per-worker processing queues
│   │   ├── visited.ts           # Indexed URLs tracking (atomic)
│   │   └── rate-limit.ts        # Domain + global rate limiting
│   │
│   ├── workers/                 # Worker pools
│   │   ├── crawler.ts           # HTTP crawler workers (15x)
│   │   ├── playwright.ts        # Playwright workers (5x)
│   │   └── reindex.ts           # Reindex worker
│   │
│   ├── fetcher/                 # Content fetching
│   │   ├── http.ts              # HTTP fetch with timeout
│   │   └── playwright-client.ts # Playwright fetch wrapper
│   │
│   ├── extractor/               # Content extraction
│   │   ├── content.ts           # Smart content extraction
│   │   ├── links.ts             # Link extraction (O(1) dedup)
│   │   └── metadata.ts          # SEO metadata extraction
│   │
│   ├── indexer/                 # Elasticsearch
│   │   ├── index.ts             # ES client + schema
│   │   └── operations.ts        # Index/upsert operations
│   │
│   ├── utils/                   # Utilities
│   │   ├── url.ts               # URL normalization, validation
│   │   ├── hash.ts              # Content hashing
│   │   ├── memory.ts            # Memory monitoring
│   │   ├── logger.ts            # Structured logging
│   │   └── retry.ts             # Retry with backoff
│   │
│   └── scripts/                 # CLI scripts
│       ├── load-seeds.ts        # Seed file loader
│       └── reindex-cron.ts      # Reindex trigger
│
├── seeds/
│   └── seeds.txt                # Seed URLs
│
├── .env.example                 # Environment template
├── package.json
└── tsconfig.json
```

## Usage

### Development

```bash
# Install dependencies
cd services/crawler
npm install

# Start dependencies (Docker)
docker-compose up -d elasticsearch redis

# Run crawler
npm run dev
```

### Production

```bash
# Build
npm run build

# Start
npm start
```

### Seed URLs

Add URLs to `seeds/seeds.txt` (one per line):

```
https://example.com
https://example.org/page
```

Seeds load once at startup using file hash detection (allows reseeding if file changes).

### Manual Reindex

```bash
npm run reindex
```

## Monitoring

### Logs

Structured logging with Winston:

```json
{
  "level": "info",
  "message": "Indexed page",
  "url": "https://example.com",
  "wordCount": 1234,
  "linksCount": 50,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Redis Keys

Monitor queue lengths:

```bash
redis-cli LLEN crawl:queue
redis-cli ZCARD indexed:urls
redis-cli ZCARD reindex:queue
```

### Elasticsearch

Check indexed documents:

```bash
curl http://localhost:9200/pages/_count
curl http://localhost:9200/pages/_search?size=5
```

## Performance

### Benchmarks (Wikipedia crawling)

| Metric | Value |
|--------|-------|
| Workers | 15 crawler + 2 Playwright (default) |
| Avg pages/minute | 50-100 (HTTP) |
| Avg word count (after smart extraction) | 50-2,500 |
| Rate limit | 200ms domain delay, 10 RPS global |
| Memory usage | ~800MB-1.2GB |

### Optimization Techniques

1. **Smart content extraction** - 95% reduction in processed content
2. **Atomic deduplication** - Lua script prevents race conditions
3. **Retry logic** - Handles transient failures gracefully
4. **Token bucket rate limiting** - Efficient global rate control
5. **Playwright singleton** - Single browser, multiple tabs
6. **Dynamic worker scaling** - Auto-scales Playwright workers based on queue depth
7. **Idle shutdown** - Auto-stops browser after 60s idle

## Limitations (V1)

- ❌ No robots.txt respect
- ❌ No distributed crawling (single instance)
- ❌ No priority scoring
- ❌ No proxy rotation
- ❌ No health check endpoints (planned)
- ❌ No Prometheus metrics (planned)
- ❌ No dead-letter queue (failures logged only)

## Future Enhancements

- [ ] Health check endpoints for K8s
- [ ] Prometheus metrics
- [ ] Robots.txt compliance
- [ ] Domain allowlist/blocklist
- [ ] Content change detection (skip unchanged hashes)
- [ ] Bulk indexing for performance
- [ ] Dead-letter queue for failed URLs
- [ ] Sitemap.xml support
- [ ] Canonical URL handling

## License

MIT
