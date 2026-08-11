# Web Frontend

Next.js search UI for the search engine. Connects to the Search API (`services/search-api`) for querying and autocomplete.

## Stack

- **Next.js 16** (App Router)
- **React 19**
- **Tailwind CSS v4** + `tw-animate-css`
- **shadcn/ui** components (base-nova style)
- **Motion** — animation library
- **Aceternity UI** — animated effects (spotlight, typewriter, ripple, beams)

## Pages

### Home (`/`)

Animated landing page with:
- Background ripple effect
- Spotlight hover effect
- Typewriter heading: "Search the indexed web"
- Search bar with autocomplete dropdown

Typing in the search bar triggers autocomplete queries (150ms debounce). On submit, navigates to `/results?q=<query>`.

### Results (`/results?q=...`)

Search results page with:
- **Search bar** at top (persistent, allows refining query)
- **Filter sidebar** (toggleable): domain filter, language selector, contentType filter, sort (relevance/date), order (asc/desc)
- **Result cards** — title, URL, description with `<em>` highlighted matches, word count, last indexed date
- **Pagination** — page numbers + prev/next
- **Empty state** — "No results found" with tip to try different keywords
- **Loading skeleton** — shimmer placeholders during fetch
- **Error state** — "Search API unavailable" with hint to start the service

All filter/sort changes update URL search params and re-fetch results.

## API Connection

Defined in `lib/api.ts`:

- `searchResults(params: SearchParams)` → `GET /search` with query, pagination, filters, sort
- `autocompleteSuggestions(q: string)` → `GET /autocomplete` with prefix

Backend URL configured via `NEXT_PUBLIC_SEARCH_API_URL` (default `http://localhost:3001`). All requests use `cache: 'no-store'` for fresh results.

## Component Tree

```
RootLayout
├── HomePage (/)
│   ├── BackgroundRippleEffect
│   ├── Spotlight
│   ├── TypewriterEffect
│   └── SearchBar
│       └── AutocompleteDropdown
│
└── ResultsPage (/results)
    ├── SearchBar
    ├── FilterSidebar (inline toggle)
    ├── LoadingSkeleton | EmptyState | ResultCard[]
    │   └── HighlightedText (renders <em> from API)
    └── Pagination
```

## Key Components

- **SearchBar** — Filled input with search icon, controlled value, submit on Enter, autocomplete integration
- **AutocompleteDropdown** — Shows up to 5 suggestions below search bar, click navigates to results, keyboard navigation
- **ResultCard** — Title link, URL display, description with highlights, word count badge, last indexed timestamp
- **Pagination** — Page numbers with ellipsis, prev/next buttons
- **FilterSidebar** — Inline collapsible filters: domain, language, contentType, sort, order
- **HighlightedText** — Renders text with `<em>` tags from API as bold (dangerouslySetInnerHTML)

## Types (`lib/types.ts`)

```typescript
SearchResult         { url, title, domain, description, highlights[], contentType, wordCount, lastIndexed }
SearchResponse       { results[], total, page, totalPages }
AutocompleteSuggestion { text, url }
AutocompleteResponse   { suggestions[] }
SearchParams           { q, page?, limit?, domain?, language?, contentType?, sort?, order? }
```

## Scripts

```bash
bun run dev      # Next.js dev server (port 3000)
bun run build    # Production build
bun run start    # Start production server
bun run lint     # ESLint (next/core-web-vitals + typescript)
```

From root: `bun run dev:web` / `bun run build:web`

## UI Components

`components/ui/` — shadcn/ui primitives: button, input, select, skeleton, badge, sheet.
`components/ui/` — Aceternity effects: spotlight-new, typewriter-effect, background-beams-with-collision, floating-navbar, glare-card, background-ripple-effect.