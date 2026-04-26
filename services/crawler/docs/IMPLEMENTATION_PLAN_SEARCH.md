# Search Engine Implementation Plan

## Overview
Build a Google/Bing-class search engine with robust full-text search, autocomplete, and fast query performance.

---

## Phase 1: Enhanced Elasticsearch Schema

### 1.1 Update Index Mappings (`src/indexer/index.ts`)

```typescript
// New schema with all_text, analyzers, language detection
mappings: {
  properties: {
    // Identifiers
    url: { type: 'keyword' },
    domain: { type: 'keyword' },

    // Main searchable text (unified field)
    all_text: {
      type: 'text',
      analyzer: 'standard',
      search_analyzer: 'search_analyzer'
    },

    // Title with boost
    title: {
      type: 'text',
      analyzer: 'search_analyzer',
      copy_to: 'all_text'
    },

    // Content structured
    content: {
      properties: {
        h1: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
        h2: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
        h3: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
        h4: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
        h5: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
        h6: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
        paragraphs: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
        fullText: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' }
      }
    },

    // Metadata
    metaDescription: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
    metaKeywords: { type: 'keyword' },
    ogTitle: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
    ogDescription: { type: 'text', analyzer: 'search_analyzer', copy_to: 'all_text' },
    ogImage: { type: 'keyword' },

    // Autocomplete field (edge n-gram)
    title_autocomplete: {
      type: 'text',
      analyzer: 'autocomplete'
    },

    // Filters
    contentType: { type: 'keyword' },
    language: { type: 'keyword' },
    depth: { type: 'integer' },
    wordCount: { type: 'integer' },

    // Time-based
    firstIndexed: { type: 'date' },
    lastIndexed: { type: 'date' },
    updatedAt: { type: 'date' },

    // Deduplication
    contentHash: { type: 'keyword' }
  }
}
```

### 1.2 Add Custom Analyzers

```typescript
settings: {
  analysis: {
    analyzer: {
      search_analyzer: {
        type: 'custom',
        tokenizer: 'standard',
        filter: ['lowercase', 'stemmer', 'stop']
      },
      autocomplete: {
        type: 'custom',
        tokenizer: 'edge_ngram_tokenizer',
        filter: ['lowercase']
      }
    },
    tokenizer: {
      edge_ngram_tokenizer: {
        type: 'edge_ngram',
        min_gram: 2,
        max_gram: 10,
        token_chars: ['letter', 'digit']
      }
    },
    filter: {
      stemmer: {
        type: 'stemmer',
        language: 'english'
      }
    }
  }
}
```

### 1.3 Add Language Detection

**New dependency:** `franc-min`

**Modify `src/extractor/index.ts`:**
```typescript
import { franc } from 'franc-min';

function detectLanguage(text: string): string {
  const lang = franc(text, { minLength: 10 });
  return lang || 'und';
}
```

**Modify `src/extractor/content.ts`:**
- Extract first 500 chars of content for language detection
- Return language in extracted content object

---

## Phase 2: Rebuild Index

### 2.1 Steps
1. Run `npm run reset` to delete old index
2. Update schema in `src/indexer/index.ts`
3. Restart crawler to re-crawl all seeds
4. New schema will auto-create on restart

---

## Phase 3: Search API Service

### 3.1 Create New Service
- New directory: `services/search-api/`
- Use Express.js or Fastify for HTTP server
- Use Bun as runtime

### 3.2 Project Structure
```
services/search-api/
├── src/
│   ├── index.ts          # Entry point
│   ├── routes/
│   │   └── search.ts     # Search routes
│   ├── routes/
│   │   └── autocomplete.ts
│   ├── services/
│   │   └── search.ts     # ES query logic
│   ├── middleware/
│   │   └── error.ts
│   └── types.ts
├── package.json
├── tsconfig.json
└── .env
```

### 3.3 API Endpoints

#### GET /search
```typescript
// Query params
q: string              // Search query (required)
page?: number          // Page number (default: 1)
limit?: number         // Results per page (default: 10)
domain?: string        // Filter by domain
language?: string     // Filter by language
contentType?: string  // Filter by static/javascript
sort?: 'relevance' | 'date' | 'wordCount'
order?: 'asc' | 'desc'

// Response
{
  results: [
    {
      url: string,
      title: string,
      domain: string,
      description: string,
      contentType: string,
      wordCount: number,
      lastIndexed: string
    }
  ],
  total: number,
  page: number,
  totalPages: number
}
```

#### GET /autocomplete
```typescript
// Query params
q: string              // Prefix query (required)
limit?: number        // Max suggestions (default: 5)

// Response
{
  suggestions: [
    { text: string, url: string }
  ]
}
```

### 3.4 Search Query Logic

```typescript
// Basic search with relevance
async function search(query: string, filters: SearchFilters): Promise<SearchResult> {
  const must = [
    { multi_match: {
      query,
      fields: ['title^10', 'all_text', 'metaDescription^3'],
      fuzziness: 'AUTO',
      prefix_length: 2
    }}
  ];

  const filter = [];
  if (filters.domain) filter.push({ term: { domain: filters.domain } });
  if (filters.language) filter.push({ term: { language: filters.language } });
  if (filters.contentType) filter.push({ term: { contentType: filters.contentType } });

  const response = await esClient.search({
    index: 'crawled_pages',
    query: {
      bool: { must, filter }
    },
    from: (page - 1) * limit,
    size: limit,
    sort: filters.sort === 'date' 
      ? [{ lastIndexed: filters.order || 'desc' }]
      : [{ _score: 'desc' }]
  });

  return transformResults(response);
}
```

### 3.5 Autocomplete Query

```typescript
async function autocomplete(query: string, limit: number): Promise<Suggestion[]> {
  const response = await esClient.search({
    index: 'crawled_pages',
    query: {
      match_phrase_prefix: {
        title_autocomplete: query
      }
    },
    size: limit,
    _source: ['url', 'title']
  });

  return response.hits.hits.map(hit => ({
    text: hit._source.title,
    url: hit._source.url
  }));
}
```

---

## Phase 4: Configuration

### 4.1 Environment Variables

```bash
# Search API
PORT=3001
ES_HOST=http://localhost:9200
ES_INDEX=crawled_pages

# Crawler (add to .env)
FRANC_MIN=true  # Enable language detection
```

---

## Implementation Order

| Step | Task | Files |
|------|------|-------|
| 1 | Update ES schema with analyzers | `src/indexer/index.ts` |
| 2 | Add franc-min dependency | `package.json` |
| 3 | Add language detection | `src/extractor/index.ts`, `src/extractor/content.ts` |
| 4 | Reset and rebuild index | `npm run reset` + restart crawler |
| 5 | Create search-api service | `services/search-api/` |
| 6 | Implement search endpoint | `services/search-api/src/routes/search.ts` |
| 7 | Implement autocomplete | `services/search-api/src/routes/autocomplete.ts` |
| 8 | Add scripts to root package.json | `package.json` |
| 9 | Test end-to-end | Manual testing |

---

## Dependencies

### Crawler (add)
- `franc-min` - Language detection

### Search API (new)
- `express` or `fastify` - HTTP server
- `@elastic/elasticsearch` - ES client
- `dotenv` - Config

---

## Success Criteria

1. **Full-text search** returns relevant results for any query
2. **Fuzzy matching** handles typos (e.g., "pythn" → "python")
3. **Autocomplete** returns suggestions as user types
4. **Filtering** works by domain, language, contentType
5. **Sorting** by relevance, date, word count
6. **Pagination** works correctly
7. **Response time** < 200ms for typical queries