# Search API

Fastify-based search API for crawled pages. Provides relevance-ranked search, autocomplete, and synonym expansion backed by Elasticsearch. Caches results in Redis.

## Architecture

```
Web Frontend → GET /search?q=...  → Fastify (port 3001) → Redis cache (30s TTL) → Elasticsearch index (crawled_pages)
             → GET /autocomplete?q=... → Fastify → Elasticsearch (edge-ngram on title_autocomplete)
             → GET /health → { status: "ok" }
```

Single Fastify server. No preprocessor layer — synonym expansion happens at ES query time via the `my_synonym_graph` filter defined in the crawler's index mapping.

### Entry Point (`src/index.ts`)

1. `config()` from dotenv
2. Creates Fastify instance with pino logger
3. Registers `@fastify/cors` — `{ origin: true }` (wide open)
4. Registers `@fastify/rate-limit` — 100 req/min default, custom 429 JSON
5. `GET /health` — `{ status: "ok" }`
6. Registers `searchRoutes` + `autocompleteRoutes`
7. Listens on `0.0.0.0:${PORT}` (default 3001)

### Endpoints

#### `GET /search`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Search query |
| `page` | number | 1 | Page number (1-based) |
| `limit` | number | 10 | Results per page |
| `domain` | string | — | Filter by domain (`term` query) |
| `language` | string | — | Filter by language code |
| `contentType` | string | — | Filter: `static` or `javascript` |
| `sort` | string | `relevance` | `relevance` or `date` |
| `order` | string | `desc` | Sort order: `asc` or `desc` |
| `cursor` | string | — | Opaque `search_after` token for deep pagination |

**Query Logic:**

- **Full-text:** `bool.must` with `multi_match` across boosted fields:
  - `title^10`, `ogTitle^5`, `metaDescription^3`, `all_text` (baseline)
  - `fuzziness: 'AUTO'`, `prefix_length: 2` (typo tolerance)
  - `analyzer: 'search_analyzer'` (synonym_graph expands at query time)
  - `minimum_should_match: '2<75%'` — multi-word: 75% must match
- **Phrase queries:** If `q` contains `"..."`, adds `match_phrase` on `title` (boost 5) and `all_text` (boost 3)
- **Filters:** `domain`, `language`, `contentType` → `term` in `bool.filter` (no scoring impact)
- **Ranking:** Pure BM25 `_score` desc; `sort=date` → `lastIndexed` asc/desc. Both tiebreak with `_id` asc.
- **Pagination:** Offset `from = (page-1) * limit`. With `cursor`: `search_after` on last hit's sort values, requests `limit + 1` to detect `hasMore`, returns `nextCursor`.
- **Highlighting:** `all_text.highlight` sub-field (standard analyzer), `fragment_size: 150`, 3 fragments, `<em>` tags

**Response:**

```json
{
  "results": [
    {
      "url": "https://example.com/page",
      "title": "Page Title",
      "domain": "example.com",
      "description": "...snippet with <em>matches</em> highlighted...",
      "highlights": ["...<em>match</em> in context..."],
      "contentType": "static",
      "wordCount": 1200,
      "lastIndexed": "2026-08-12T10:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "totalPages": 5,
  "nextCursor": null
}
```

Description fallback chain: highlighted fragments → `metaDescription` → `ogDescription` → `''`.

#### `GET /autocomplete`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Prefix to autocomplete |
| `limit` | number | 5 | Max suggestions |

**Logic:**
1. Primary: `match_phrase_prefix` on `title_autocomplete` (edge-ngram 2-10 chars), `max_expansions: 50`
2. Fallback: if results sparse (`q.length >= 5` → `< 3`, else `< limit`), runs `match_bool_prefix` on `all_text` with `minimum_should_match: '50%'`, dedupes by URL

**Response:**

```json
{
  "suggestions": [
    { "text": "Mikoyan-Gurevich MiG-21", "url": "https://..." },
    { "text": "Mikoyan Aircraft History", "url": "https://..." }
  ]
}
```

#### `GET /health`

Returns `{ "status": "ok" }`.

### Caching (`src/lib/cache.ts`)

- Redis via ioredis, key prefix `search:cache:`, TTL `SEARCH_CACHE_TTL` (default 30s)
- Cache key: sorted pipe-delimited string of `q`, `page`, `limit`, and filter params
- Cursor requests bypass cache entirely
- No error handling on Redis — unavailability causes 500 on search

### Elasticsearch Connection (`src/lib/elastic.ts`)

- Singleton `Client` with `HttpConnection`, no retry config
- Reads `ES_HOST` (default `http://localhost:9200`) and `ES_INDEX` (default `crawled_pages`)
- Index mapping and analyzers defined by crawler service (`services/crawler/src/indexer/index.ts`)
- Synonym expansion handled by `my_synonym_graph` filter at query time (33+ tech pairs in ES mapping)

### Middleware

| Middleware | Config | Notes |
|---|---|---|
| CORS (`@fastify/cors`) | `{ origin: true }` | Reflects any origin |
| Rate limit (`@fastify/rate-limit`) | 100 req/min, in-memory | Custom 429 JSON with retry-after |
| Logging | Fastify pino (enabled) | `console.error` fallback in route handlers |

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP server port |
| `ES_HOST` | `http://localhost:9200` | Elasticsearch URL |
| `ES_INDEX` | `crawled_pages` | Index name (shared with crawler) |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `SEARCH_CACHE_TTL` | `30` | Cache TTL in seconds |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate limit window |

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `bun run dev` | Dev mode via Bun |
| `build` | `bun run build` | TypeScript compilation to `dist/` |
| `start` | `bun run start` | Run production build |

From root: `bun run dev:search` / `bun run build:search`

## Types (`src/lib/types.ts`)

```typescript
SearchQuery         { q, page?, limit?, domain?, language?, contentType?, sort?, order?, cursor? }
SearchResultHit     { url, title, domain, description, highlights[], contentType, wordCount, lastIndexed }
SearchResult        { results[], total, page, totalPages, nextCursor }
AutocompleteQuery   { q, limit? }
Suggestion          { text, url }
CrawledPage         { url, title, domain, metaDescription?, ogDescription?, contentType, wordCount, lastIndexed, all_text?, [key: string]: unknown }
```

## Integration

Shares ES index `crawled_pages` with the crawler service. Crawler writes `PageDocument` objects, search-api reads them. No direct inter-service communication. The `all_text` field (aggregating title, headers, paragraphs, fullText, meta fields via `copy_to`) is the primary search target. Synonym expansion relies on the `my_synonym_graph` filter defined in the crawler's index mapping (`crawler/src/indexer/index.ts`).