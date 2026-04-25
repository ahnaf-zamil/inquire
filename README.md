# Search Engine V1

A self-hosted search engine with a robust web crawler capable of indexing both static HTML and JavaScript-rendered pages.

## Features

- **Hybrid Crawling**: Automatic detection and handling of JavaScript-rendered pages via Playwright
- **Structured Content Extraction**: Separates headers (h1-h6), paragraphs, and metadata for future ranking
- **Automatic Reindexing**: 24-hour reindex cycle keeps content fresh
- **Resource Guardrails**: Built-in limits to prevent system resource exhaustion
- **Cross-Domain Support**: Crawl multiple domains from single seed URLs
- **Scalable Architecture**: Worker pools for crawling and Playwright rendering

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SEARCH ENGINE                            │
│                                                              │
│  ┌─────────────────┐    ┌─────────────────┐                │
│  │  Crawler        │    │  API Server     │                │
│  │  Service        │    │  (Future)       │                │
│  │                 │    │                 │                │
│  │  - Static HTML  │    │  - Search       │                │
│  │  - Playwright   │    │  - Ranking      │                │
│  │  - Extraction   │    │  - Analytics    │                │
│  └────────┬────────┘    └─────────────────┘                │
│           │                                                 │
│           ▼                                                 │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                   DATA LAYER                           │ │
│  │  ┌─────────────┐         ┌─────────────┐             │ │
│  │  │  Redis      │         │  Elastic-   │             │ │
│  │  │  (Queues)   │         │  search     │             │ │
│  │  │             │         │  (Index)    │             │ │
│  │  └─────────────┘         └─────────────┘             │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Services

| Service | Status | Description |
|---------|--------|-------------|
| [Crawler](services/crawler/) | ✅ V1 | Web crawler with Playwright support |
| API Server | 🚧 Planned | Search query API |
| Frontend | 🚧 Planned | Search UI |

## Quick Start

### Prerequisites

- Node.js 20+ or Bun
- Docker & Docker Compose
- 2GB+ RAM available

### 1. Clone & Install

```bash
git clone https://github.com/ahnaf-zamil/search-engine
cd search-engine
npm install
```

### 2. Start Dependencies

```bash
docker-compose up -d
```

This starts:
- Elasticsearch (port 9200)
- Redis (port 6379)

### 3. Configure Crawler

```bash
cd services/crawler
cp .env.example .env
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
# Development (with watch)
npm run dev:crawler

# Production
cd services/crawler
npm run build
npm start
```

### 6. Verify

```bash
# Check indexed documents
curl http://localhost:9200/pages/_count

# Check queue status
redis-cli LLEN crawl:queue
redis-cli ZCARD indexed:urls
```

## Project Structure

```
search-engine/
├── services/
│   ├── crawler/           # Web crawler service
│   │   ├── src/
│   │   │   ├── workers/   # Worker pools
│   │   │   ├── queue/     # Redis operations
│   │   │   ├── fetcher/   # HTTP + Playwright
│   │   │   ├── extractor/ # Content extraction
│   │   │   ├── indexer/   # Elasticsearch
│   │   │   └── utils/     # Utilities
│   │   ├── seeds/         # Seed URLs
│   │   └── .env.example
│   └── api/               # API server (future)
├── docs/
│   └── crawler-architecture.md
├── docker-compose.yml
└── package.json
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ES_HOST` | `http://localhost:9200` | Elasticsearch URL |
| `ES_INDEX` | `crawled_pages` | Index name |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `CRAWLER_WORKERS` | `5` | Crawler worker count |
| `PLAYWRIGHT_WORKERS` | `2` | Playwright worker count |
| `DOMAIN_DELAY_MS` | `200` | Per-domain delay (ms) |
| `GLOBAL_RPS` | `10` | Global requests per second |
| `LOG_LEVEL` | `info` | Logging level |
| `PLAYWRIGHT_HEADLESS` | `true` | Run browser headless |

### Guardrails

| Limit | Value | Purpose |
|-------|-------|---------|
| Max Indexed Pages | 5,000,000 | Prevent unbounded growth |
| Max Queue Size | 50,000 | Backpressure |
| Max Crawl Depth | 5 levels | Prevent infinite chains |
| Reindex Cycle | 24 hours | Content freshness |
| Memory Limit | 1.5GB | System protection |

## Performance

### Benchmarks

| Metric | Value |
|--------|-------|
| Worker Configuration | 15 crawler + 2 Playwright (default) |
| Avg Crawl Speed | 50-100 pages/minute (HTTP) |
| Rate Limits | 200ms domain delay, 10 RPS global |
| Smart Extraction | 95% content reduction (excludes boilerplate) |
| Memory Usage | ~800MB-1.2GB |
| Features | URL filtering, Anti-bot detection, 429 handling, Distributed rate limiting |

### Optimizations

- **Smart content extraction** - Targets main content, excludes navigation/footers
- **Atomic deduplication** - Lua script prevents race conditions
- **Retry logic** - Exponential backoff for transient failures
- **Token bucket rate limiting** - Efficient global rate control

## Available Scripts

```bash
# Root
npm run dev:crawler        # Run crawler in dev mode

# Crawler service
npm run dev                # Development with watch
npm run build              # Build TypeScript
npm run start              # Run production build
npm run load-seeds         # Manually load seeds
npm run reindex            # Trigger reindex cycle
```

## Monitoring

### Logs

```bash
# View crawler logs
tail -f services/crawler/crawler.log

# Docker logs
docker-compose logs -f elasticsearch
docker-compose logs -f redis
```

### Redis

```bash
# Queue lengths
redis-cli LLEN crawl:queue
redis-cli ZCARD reindex:queue
redis-cli ZCARD indexed:urls

# Domain rate limits
redis-cli KEYS "domain:last:*"
```

### Elasticsearch

```bash
# Document count
curl http://localhost:9200/pages/_count

# Recent documents
curl http://localhost:9200/pages/_search?size=5

# Index stats
curl http://localhost:9200/pages/_stats
```

## Development

### Adding New Services

1. Create service folder in `services/`
2. Add to root `package.json` workspaces
3. Add to `docker-compose.yml` if needed
4. Document in this README

### Testing

```bash
# Run tests (when available)
npm test

# Type check
npx tsc --noEmit
```

## Roadmap

### V1 (Current)
- ✅ Crawler service with Playwright support
- ✅ Smart content extraction (excludes boilerplate)
- ✅ Automatic reindexing (24h cycle)
- ✅ Resource guardrails (memory, rate limits)
- ✅ Retry logic with exponential backoff
- ✅ Atomic URL deduplication
- ✅ High-performance configuration (15+5 workers)

### V2 (Planned)
- [ ] Robots.txt compliance
- [ ] Domain allowlist/blocklist
- [ ] Search API server
- [ ] Basic ranking algorithm
- [ ] Content change detection (skip unchanged hashes)
- [ ] Health check endpoints

### V3 (Future)
- [ ] Web UI for search
- [ ] Analytics dashboard
- [ ] Distributed crawling
- [ ] Advanced ranking (PageRank, etc.)
- [ ] API authentication
- [ ] Sitemap.xml support

## Troubleshooting

### Elasticsearch Connection Failed

```bash
# Check if ES is running
docker-compose ps

# Restart ES
docker-compose restart elasticsearch

# Check logs
docker-compose logs elasticsearch
```

### Redis Connection Failed

```bash
# Check if Redis is running
docker-compose ps

# Restart Redis
docker-compose restart redis
```

### Memory Issues

Reduce worker counts in `.env`:

```env
CRAWLER_WORKERS=10
PLAYWRIGHT_WORKERS=3
```

### Slow Crawling

If crawling seems slow, check rate limit settings:

```env
# For faster crawling (less respectful)
DOMAIN_DELAY_MS=50
GLOBAL_RPS=150

# For slower, more respectful crawling
DOMAIN_DELAY_MS=500
GLOBAL_RPS=20
```

### Playwright Installation

```bash
cd services/crawler
npx playwright install
npx playwright install-deps
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Elasticsearch](https://www.elastic.co/elasticsearch/) - Search and analytics engine
- [Redis](https://redis.io/) - In-memory data store
- [Playwright](https://playwright.dev/) - Browser automation
- [Cheerio](https://cheerio.js.org/) - HTML parsing
