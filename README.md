# Inquire

Full-stack search engine: Redis-queued HTTP+Playwright crawler with per-domain rate limiting, Elasticsearch with custom analyzers, and a BM25 Fastify API with autocomplete.

## Services

| Service | Status | Description |
|---------|--------|-------------|
| [Crawler](services/crawler/) | ✅ V1 | Web crawler with HTTP + Playwright, content extraction, indexing |
| [Search API](services/search-api/) | ✅ V1 | BM25 search, synonym expansion, autocomplete, field boosting |
| [Frontend](apps/web/) | ✅ V1 | Next.js search UI with results, filters, pagination, autocomplete |

## Quick Start

### Prerequisites

- Node.js 20+ or Bun
- Docker & Docker Compose
- 2GB+ RAM available

### 1. Clone & Install

```bash
git clone https://github.com/ahnaf-zamil/inquire
cd inquire
bun install
```

### 2. Start Dependencies

```bash
docker-compose up -d
```

Starts Elasticsearch (9200) and Redis (6379).

### 3. Configure Crawler

```bash
cp services/crawler/.env.example services/crawler/.env
```

Edit `.env` with your settings (defaults work for local dev).

### 4. Add Seed URLs

Create `services/crawler/seeds/seeds.txt`:

```
https://example.com
https://example.org
```

### 5. Run Crawler

```bash
bun run dev:crawler
```

### 6. Start Search API

```bash
bun run dev:search
```

### 7. Start Frontend

```bash
bun run dev:web
```

Open `http://localhost:3000` and search.

### 8. Verify

```bash
# Check indexed documents
curl http://localhost:9200/pages/_count

# Search via API
curl "http://localhost:3001/search?q=hello+world"

# Check queue status
redis-cli LLEN crawl:queue
redis-cli ZCARD indexed:urls
```

## Project Structure

```
inquire/
├── apps/
│   └── web/                 # Next.js frontend (search UI)
├── services/
│   ├── crawler/             # Web crawler (HTTP + Playwright)
│   └── search-api/          # Fastify search API server
├── docker-compose.yml
└── package.json
```

## V1 Features

- ✅ **Crawler**: HTTP + Playwright hybrid crawling, SPA detection, content extraction (h1-h6, paragraphs, metadata), language detection, robots.txt compliance, sitemap discovery
- ✅ **Indexing**: Elasticsearch with custom analyzers (stemming, synonyms, edge-ngram autocomplete), content-hash dedup, 24h reindex cycle
- ✅ **Backpressure**: Memory pressure detection (1.5GB limit) with pause-on-pressure, per-domain concurrency cap (2), global token bucket rate limiting, distributed domain delay
- ✅ **Resilience**: Retry chain with exponential backoff (max 3), circuit breaker on Playwright, graceful shutdown, fresh start mode (`--fresh`)
- ✅ **Search API**: BM25 relevance + field boosting (title^10, ogTitle^5, metaDescription^3), phrase matching, typo tolerance (fuzziness AUTO), minimum_should_match, synonym expansion (30+ tech + 400+ English pairs), autocomplete (edge-ngram prefix)
- ✅ **Frontend**: Next.js App Router, animated search UI, results with highlighted snippets, domain/language/contentType filters, date/relevance sort, pagination

## Configuration

See `services/crawler/.env.example` for full crawler configuration.

### Key Environment Variables

| Variable | Default | Service | Description |
|----------|---------|---------|-------------|
| `ES_HOST` | `http://localhost:9200` | All | Elasticsearch URL |
| `ES_INDEX` | `crawled_pages` | All | Index name |
| `REDIS_HOST` | `localhost` | Crawler | Redis host |
| `REDIS_PORT` | `6379` | Crawler | Redis port |
| `PORT` | `3001` | Search API | HTTP server port |
| `CRAWLER_WORKERS` | `15` | Crawler | HTTP crawl concurrency |
| `PLAYWRIGHT_WORKERS` | `5` | Crawler | JS render concurrency |
| `DOMAIN_DELAY_MS` | `200` | Crawler | Per-domain rate limit |
| `GLOBAL_RPS` | `10` | Crawler | Global rate limit |
| `MAX_RETRIES` | `3` | Crawler | Fetch retry attempts |

### Guardrails

| Limit | Value | Purpose |
|-------|-------|---------|
| Max Indexed Pages | 5,000,000 | Prevent unbounded growth |
| Max Queue Size | 50,000 | Backpressure |
| Max Crawl Depth | 5 levels | Prevent infinite chains |
| Max Links/Page | 50 | Focus on quality links |
| Min Content Words | 50 | Skip boilerplate-only pages |
| Reindex Cycle | 24 hours | Content freshness |
| Memory Limit | 1.5GB | System protection |
| Domain Concurrency | 2 | Prevent hammering hosts |

## Available Scripts

### Root

```bash
bun run dev:crawler     # Start crawler (watch mode)
bun run dev:search      # Start search API (watch mode)
bun run dev:web         # Start frontend (Next.js dev)
bun run build:crawler   # Build crawler
bun run build:search    # Build search API
bun run build:web       # Build frontend
bun run load-seeds      # Manually load seed URLs
bun run reindex         # Trigger reindex cycle
```

### Crawler Service

```bash
bun run dev             # Dev with watch
bun run build           # Build TypeScript
bun run start           # Run production build
bun run load-seeds      # Load seeds/seeds.txt
bun run reindex         # One-shot reindex
bun run reset           # Interactive: delete ES index + Redis queues
bun run submit <url>    # Push URL to front of crawl queue
bun run stats           # Show crawler statistics
```

### Search API

```bash
bun run dev             # Dev mode
bun run build           # Build TypeScript
bun run start           # Run production build
```

### Frontend

```bash
bun run dev             # Next.js dev server
bun run build           # Production build
bun run start           # Start production server
bun run lint            # ESLint
```

## Performance

| Metric | Value |
|--------|-------|
| Worker Configuration | 15 crawler + 5 Playwright (default) |
| Avg Crawl Speed | 50-100 pages/minute (HTTP) |
| Rate Limits | 200ms domain delay, 10 RPS global |
| Content Reduction | ~95% (excludes boilerplate) |
| Memory Usage | ~800MB-1.2GB |

## Future Plans

- [ ] Rate limiting on search API (`@fastify/rate-limit`)
- [ ] Redis caching for popular queries (30-60s TTL)
- [ ] Deep pagination via `search_after` (beyond 10K results)
- [ ] Autocomplete fallback to `match_bool_prefix` on `all_text` (short/obscure queries)

## Troubleshooting

### Elasticsearch / Redis Connection Failed

```bash
docker-compose ps
docker-compose restart elasticsearch  # or redis
```

### Memory Issues

Reduce worker counts in `.env`:

```env
CRAWLER_WORKERS=10
PLAYWRIGHT_WORKERS=3
```

### Playwright Installation

```bash
cd services/crawler
npx playwright install
npx playwright install-deps
```

## License

MIT License — see [LICENSE](LICENSE) for details.
