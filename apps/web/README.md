# Web Frontend

Next.js 16 search UI for the search engine. Connects to the Search API (`services/search-api`) for querying and autocomplete.

## Stack

- **Next.js 16** (App Router)
- **React 19**
- **Tailwind CSS v4** + `tw-animate-css`
- **shadcn/ui** components (base-nova style, RSC enabled)
- **base-ui/react** — headless UI primitives (button, input, select, dialog)
- **Motion** — animation library
- **Aceternity UI** — animated effects (spotlight, typewriter, ripple, beams)

## Pages

### Home (`/`)

Animated landing page. Components:
- `BackgroundRippleEffect` — interactive grid with click ripple
- `Spotlight` — animated gradient spotlights
- `TypewriterEffect` — "Search the indexed web" char-by-char
- `SearchBar` with `AutocompleteDropdown`

Typing triggers autocomplete (150ms debounce). Submit navigates to `/results?q=<query>`.

### Results (`/results?q=...`)

Search results page. URL-driven — all filter/sort changes update URL search params and trigger re-fetch. Components:
- `SearchBar` at top (persistent, allows refining query)
- `FilterSidebar` (inline toggleable) — domain text input, language select, contentType select, sort (relevance/date), order (asc/desc)
- `ResultCard[]` — title link, URL with favicon, description + `<em>` highlights, contentType badge, word count, last indexed date
- `Pagination` — page numbers with ellipsis, prev/next
- `LoadingSkeleton` — 5 shimmer placeholders during fetch
- `EmptyState` — "No results found" with tip
- Error state — "Search API unavailable" with hint

## API Connection (`src/lib/api.ts`)

| Function | Endpoint | Cache |
|---|---|---|
| `searchResults(params)` | `GET /search?q=...&page=...&domain=...&sort=...` | `cache: "no-store"` |
| `autocompleteSuggestions(q)` | `GET /autocomplete?q=...` | `cache: "no-store"` |

Backend URL: `NEXT_PUBLIC_SEARCH_API_URL` env var (default `http://localhost:3001`).

## Data Flow

```
User types in SearchBar
  → 150ms debounce → GET /autocomplete?q=<prefix> (search-api:3001)
  → dropdown shows suggestions

User submits (Enter or click)
  → router.push(/results?q=<query>)

ResultsPage mounts
  → useEffect → GET /search?q=<query>&page=1&limit=10&...
  → renders ResultCard[], EmptyState, or error

User changes filter/sort
  → URL search params updated → router.push(...) → useEffect re-fires

User clicks pagination
  → ?page=N → re-fetch
```

## Component Tree

```
RootLayout
├── HomePage (/)
│   ├── BackgroundRippleEffect
│   ├── Spotlight
│   ├── TypewriterEffect
│   └── SearchBar
│       └── AutocompleteDropdown (keyboard nav, click to search)
│
└── ResultsPage (/results)
    ├── SearchBar
    ├── FilterSidebar (inline)
    ├── LoadingSkeleton | EmptyState | ResultCard[]
    │   └── HighlightedText (renders <em> as bold)
    └── Pagination
```

## Key Components

| Component | File | Purpose |
|---|---|---|
| `SearchBar` | `components/SearchBar.tsx` | Controlled input, search icon, Enter submits, autocomplete integration |
| `AutocompleteDropdown` | `components/AutocompleteDropdown.tsx` | Up to 5 suggestions, keyboard nav, click navigates |
| `ResultCard` | `components/ResultCard.tsx` | Title link, URL, favicon, highlights, word count, last indexed |
| `Pagination` | `components/Pagination.tsx` | Page numbers with ellipsis, prev/next |
| `FilterSidebar` | `components/FilterSidebar.tsx` | Inline collapsible: domain, language, contentType, sort, order |
| `HighlightedText` | `components/HighlightedText.tsx` | `dangerouslySetInnerHTML` for `<em>` bold rendering |
| `EmptyState` | `components/EmptyState.tsx` | No results message with tip |
| `LoadingSkeleton` | `components/LoadingSkeleton.tsx` | Shimmer placeholders |

## UI Components (`components/ui/`)

**shadcn primitives:** `button.tsx`, `input.tsx`, `select.tsx`, `skeleton.tsx`, `badge.tsx`, `sheet.tsx`

**Aceternity effects:** `typewriter-effect.tsx`, `spotlight-new.tsx`, `background-beams-with-collision.tsx`, `floating-navbar.tsx`, `glare-card.tsx`, `background-ripple-effect.tsx`

## Types (`src/lib/types.ts`)

```typescript
SearchResult              { url, title, domain, description, highlights[], contentType, wordCount, lastIndexed }
SearchResponse            { results[], total, page, totalPages }
AutocompleteSuggestion    { text, url }
AutocompleteResponse      { suggestions[] }
SearchParams              { q, page?, limit?, domain?, language?, contentType?, sort?, order? }
```

## Configuration

| File | Key Settings |
|---|---|
| `.env.example` | `NEXT_PUBLIC_SEARCH_API_URL=http://localhost:3001` |
| `next.config.ts` | `allowedDevOrigins: ["*"]` |
| `tsconfig.json` | `strict: true`, `jsx: "react-jsx"`, paths `@/*` → `./src/*` |
| `components.json` | shadcn base-nova style, RSC enabled, lucide icons, Aceternity registry |

## Scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `bun run dev` | Next.js dev server (port 3000) |
| `build` | `bun run build` | Production build |
| `start` | `bun run start` | Production server |
| `lint` | `bun run lint` | ESLint (next/core-web-vitals + typescript) |

From root: `bun run dev:web` / `bun run build:web`

## Infrastructure

Docker Compose provides only `elasticsearch` (9200) and `redis` (6379). The web app runs outside Docker during development. No web container in `docker-compose.yml`.