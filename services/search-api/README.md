# Search API

Fastify-based search API for crawled pages. Provides relevance-ranked search, autocomplete, and synonym expansion backed by Elasticsearch.

## How It Works

### Entry Point (`src/index.ts`)

1. Loads synonym preprocessor (`data/core-synonyms.txt`)
2. Registers Fastify routes on port 3001 (configurable via `PORT`)
3. CORS enabled (wide open — `origin: true`)

### Endpoints

#### `GET /search`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Search query |
| `page` | number | 1 | Page number (1-based) |
| `limit` | number | 10 | Results per page |
| `domain` | string | — | Filter by domain |
| `language` | string | — | Filter by language code |
| `contentType` | string | — | Filter: `static` or `javascript` |
| `sort` | string | `relevance` | `relevance` or `date` |
| `order` | string | `desc` | Sort order: `asc` or `desc` |

**Ranking Algorithm:**

Uses ES `bool` query with:

1. **`multi_match`** across fields with boosting:
   - `title^10` — match in title worth 10x body
   - `ogTitle^5` — Open Graph title at 5x
   - `metaDescription^3` — meta description at 3x
   - `all_text` — baseline (body content)
2. **`fuzziness: 'AUTO'`** with `prefix_length: 2` — typo tolerance
3. **`minimum_should_match: '2<75%'`** — multi-word queries require 75% term match
4. **Phrase matching** — quoted queries also search exact phrase in `title` (boost 5) and `all_text` (boost 3)
5. **Sort:** `_score` descending (relevance) or `lastIndexed` (date)

**No `function_score` wrapper** — pure BM25 + field boosts. No page size pollution.

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
  "totalPages": 5
}
```

Description fallback chain: highlights → `metaDescription` → `ogDescription` → `fullText.substring(0, 200)`.

#### `GET /autocomplete`

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `q` | string | **required** | Prefix to autocomplete |
| `limit` | number | 5 | Max suggestions |

Uses ES `match_phrase_prefix` on `title_autocomplete` field (edge-ngram, 2-10 chars) with `max_expansions: 50`.

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

### Preprocessing (`src/preprocessor/`)

**Synonyms** (`preprocessor/synonyms.ts`):
- Loads `data/core-synonyms.txt` once (lazy singleton)
- Bidirectional mapping: each term maps to all other terms on same line
- 30+ tech pairs: `js↔javascript`, `react↔reactjs`, `ts↔typescript`
- 400+ general English pairs: `happy↔joyful↔glad`, `big↔large↔huge`

**Query Builder** (`preprocessor/index.ts`):
- `preprocessQuery(q)` — runs synonym lookup
- `buildExpandedQuery(original, expanded)` — returns original unchanged (ES `search_analyzer` handles synonyms at query time via synonym_graph filter)

### Index Mapping Expected

The API expects the ES index created by the crawler service with:
- `search_analyzer`: standard + lowercase + stemmer + stop + synonym_graph + word_delimiter
- `all_text` with `all_text.highlight` sub-field (standard analyzer for verbatim snippets)
- `title_autocomplete` with edge-ngram analyzer (2-10 chars)
- Fields: `title`, `domain`, `contentType`, `wordCount`, `lastIndexed`, `language`, `metaDescription`, `ogTitle`, `ogDescription`, `content.fullText`

### Utils (`src/utils/`)

ES highlight builder: wraps matched terms in `<em>` tags from pre-tagged ES response. Used by frontend to render bold matches.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `ES_HOST` | `http://localhost:9200` | Elasticsearch URL |
| `ES_INDEX` | `crawled_pages` | Index name |

## Scripts

```bash
bun run dev      # Dev mode (ts-node, watch)
bun run build    # Build to dist/
bun run start    # Run production build
```

From root: `bun run dev:search`