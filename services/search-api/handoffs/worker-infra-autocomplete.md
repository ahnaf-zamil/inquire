# Worker: Search API Infra + Autocomplete Fallback

## Scope

Search API only (`services/search-api/`). Four features, implement in order:

1. Rate limiting (`@fastify/rate-limit`)
2. Redis query caching (30-60s TTL)
3. Deep pagination via `search_after`
4. Autocomplete fallback to `match_bool_prefix` on `all_text`

---

## Workflow

### Setup

```bash
# 1. Create worktree from clean master
git worktree add ../search-api-worktree master
cd ../search-api-worktree

# 2. Copy env files from original repo
cp ../search-engine/.env .env 2>/dev/null || true
cp ../search-engine/services/search-api/.env services/search-api/.env 2>/dev/null || true

# 3. Install dependencies
cd services/search-api && bun install && cd ../..

# 4. Verify current state works
bun run --cwd services/search-api tsc --noEmit
# Start ES + Redis via docker-compose, start API, curl /search to confirm baseline
```

### Development loop

```bash
cd services/search-api
bun run dev  # changes hot-reload
```

### Verification (run before commit)

```bash
# Type check
bun run --cwd services/search-api tsc --noEmit

# No-regression smoke tests:
#   curl "http://localhost:3001/search?q=hello"           -- status 200, has results
#   curl "http://localhost:3001/search"                    -- status 400
#   curl "http://localhost:3001/autocomplete?q=hel"        -- status 200, has suggestions
#   curl "http://localhost:3001/health"                    -- status 200
```

---

## Feature 1: Rate Limiting

### Dependencies

```bash
bun add @fastify/rate-limit
```

### Implementation

**File:** `services/search-api/src/index.ts`

Register after CORS, before routes:

```ts
import rateLimit from '@fastify/rate-limit'

await fastify.register(rateLimit, {
  max: 100,            // requests per window
  timeWindow: '1 minute',
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Retry in ${context.after}`,
  }),
})
```

**Config (optional):** Use `process.env.RATE_LIMIT_MAX` (default 100) and `process.env.RATE_LIMIT_WINDOW` (default '1 minute') for env overrides.

### Verify

```bash
for i in $(seq 1 110); do curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/search?q=hello" & done
wait
# Confirm: first 100 return 200, last 10 return 429
```

---

## Feature 2: Redis Query Caching

### New file: `services/search-api/src/lib/cache.ts`

```ts
import Redis from 'ioredis'

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  keyPrefix: 'search:cache:',
})

const DEFAULT_TTL = parseInt(process.env.SEARCH_CACHE_TTL || '30') // seconds

export async function getCached(key: string): Promise<string | null> {
  return redis.get(key)
}

export async function setCache(key: string, value: string, ttl = DEFAULT_TTL): Promise<void> {
  await redis.setex(key, ttl, value)
}

export function cacheKey(q: string, page: number, limit: number, filters: Record<string, string | undefined>): string {
  const parts = [`q=${encodeURIComponent(q)}`, `p=${page}`, `l=${limit}`]
  for (const [k, v] of Object.entries(filters)) {
    if (v) parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.sort().join('|')
}
```

### Dependencies

```bash
bun add ioredis
bun add -D @types/ioredis
```

### Modified file: `services/search-api/src/routes/search.ts`

Wrap the ES search call:

```ts
import { getCached, setCache, cacheKey } from '../lib/cache'

// After building must/filter/from/size, before try block:
const cKey = cacheKey(q, page, limit, { domain, language, contentType, sort, order })
const cached = await getCached(cKey)
if (cached) {
  return JSON.parse(cached)
}

// Inside try block, after building result:
await setCache(cKey, JSON.stringify(result))
```

**Important:** Only cache successful responses (200). Do not cache error responses. Cache key must include ALL query params including filters, sort, order. TTL 30s default, configurable via `SEARCH_CACHE_TTL`.

### Verify

```bash
# First request (cache miss)
time curl -s "http://localhost:3001/search?q=hello" > /dev/null

# Second request (cache hit) — should be ~1ms
time curl -s "http://localhost:3001/search?q=hello" > /dev/null

# Different query — should be miss
time curl -s "http://localhost:3001/search?q=world" > /dev/null
```

---

## Feature 3: Deep Pagination via `search_after`

### Problem

ES default `max_result_window` is 10,000. Page 1001+ (with limit=10) throws an error. `search_after` is cursor-based pagination that works for any depth.

### Modified file: `services/search-api/src/routes/search.ts`

**Changes:**

1. Accept optional `cursor` parameter in `SearchQuery` (string)

2. When `cursor` is provided, use `search_after` instead of `from`:
   - Parse cursor as `[sort_value_0, sort_value_1, ...]` (JSON array of sort values)
   - Remove `from` and pass `search_after` to ES query
   - Always sort by `_score` + `_id` (tiebreaker) — even when sorting by date, include both for stable cursor

3. Return `nextCursor` in the response (the last hit's sort values, JSON-stringified)

**Updated sort option:**

```ts
// Always include _id as tiebreaker for stable pagination
const sortOption = sort === 'date'
  ? [{ lastIndexed: order === 'asc' ? 'asc' : 'desc' }, { _id: 'asc' }]
  : [{ _score: 'desc' }, { _id: 'asc' }]
```

**Updated response:**

```ts
interface SearchResult {
  results: SearchResultHit[]
  total: number
  page: number      // set to 1 when cursor used
  totalPages: number // set to 0 when cursor used
  nextCursor: string | null
}
```

**When `cursor` query param present:**

```ts
const searchAfter = cursor ? JSON.parse(cursor) : undefined

// ES query:
search({
  ...,
  from: cursor ? undefined : from,
  search_after: searchAfter,
  sort: sortOption,
  size: limit + 1, // fetch one extra to know if more pages exist
})

// After response:
const hits = response.hits.hits
const hasMore = hits.length > limit
const results = hasMore ? hits.slice(0, limit) : hits
const nextCursor = hasMore ? JSON.stringify(hits[limit - 1].sort) : null
```

**Backward compatibility:** `page`/`from` still works for first ~100 pages. Only use `cursor` for deep pagination. The frontend can detect this: if `totalPages` is 0, use `cursor` instead of `page`.

### Verify

```bash
# Normal pagination still works
curl "http://localhost:3001/search?q=hello&page=1&limit=5"

# Deep pagination via cursor (after getting a cursor from a response)
curl "http://localhost:3001/search?q=hello&cursor=%5B...%5D&limit=5"
```

---

## Feature 4: Autocomplete Fallback

### Problem

Current autocomplete (`match_phrase_prefix` on `title_autocomplete`) requires the query to match an edge-ngram indexed title. Short queries (1-2 chars) or obscure terms with no title match return empty. Google returns suggestions anyway by matching body content.

### Modified file: `services/search-api/src/routes/autocomplete.ts`

**Strategy:**

1. Primary query: `match_phrase_prefix` on `title_autocomplete` (existing logic)
2. If results < `limit`: run fallback query
3. Fallback: `match_bool_prefix` on `all_text` — returns documents where any term in query matches the beginning of any word in body content (not just titles)
4. Deduplicate: filter out URLs already in primary results
5. Return up to `limit` total suggestions

**Implementation:**

```ts
// After primary search, if fewer than limit results:
if (suggestions.length < limit) {
  const fallbackResponse = await esClient.search({
    index: ES_INDEX,
    query: {
      match_bool_prefix: {
        all_text: {
          query: q,
          minimum_should_match: '50%',
        },
      },
    },
    size: limit - suggestions.length,
    _source: ['url', 'title'],
  })

  const existingUrls = new Set(suggestions.map(s => s.url))
  for (const hit of fallbackResponse.hits.hits) {
    const source = hit._source as CrawledPage
    if (!existingUrls.has(source.url)) {
      suggestions.push({ text: source.title, url: source.url })
    }
  }
}
```

**Optimization:** Skip fallback for queries ≥5 chars if primary already returned ≥3 results (heuristic: long queries are usually specific enough to match titles).

### Verify

```bash
# Primary match
curl "http://localhost:3001/autocomplete?q=mikoyan&limit=3"

# Fallback trigger (query short or obscure)
curl "http://localhost:3001/autocomplete?q=m&limit=3"

# Both should return suggestions (though fallback may be empty if nothing indexed)
```

---

## Environment Variables to Add

Add to existing `.env` (create if missing):

```env
# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute

# Redis Caching
REDIS_HOST=localhost
REDIS_PORT=6379
SEARCH_CACHE_TTL=30
```

---

## Files Changed Summary

| File | Action |
|------|--------|
| `services/search-api/package.json` | MODIFY — add `@fastify/rate-limit`, `ioredis`, `@types/ioredis` |
| `services/search-api/src/index.ts` | MODIFY — register rate-limit plugin |
| `services/search-api/src/lib/cache.ts` | NEW — Redis cache client |
| `services/search-api/src/routes/search.ts` | MODIFY — cache wrap + search_after |
| `services/search-api/src/routes/autocomplete.ts` | MODIFY — fallback to all_text |
| `services/search-api/src/lib/types.ts` | MODIFY — add `cursor` to SearchQuery, `nextCursor` to SearchResult |
| `.env` (or services/search-api/.env) | MODIFY — add new env vars |

---

## No-Regression Checklist

Before committing, verify:

- [ ] `bun run tsc --noEmit` passes (services/search-api/)
- [ ] `curl /search?q=hello` returns 200 with results (same format as before)
- [ ] `curl /search` returns 400 (no crash)
- [ ] `curl /autocomplete?q=hel` returns 200 with suggestions
- [ ] `curl /health` returns 200
- [ ] Rate limit: 100 req/min, 101st returns 429
- [ ] Cache: second identical query is ~1ms
- [ ] Deep pagination: cursor-based pagination returns correct results
- [ ] Autocomplete fallback: short query returns suggestions from body content