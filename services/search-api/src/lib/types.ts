export interface SearchQuery {
  q: string
  page?: number
  limit?: number
  domain?: string
  language?: string
  contentType?: string
  sort?: string
  order?: string
}

export interface SearchResultHit {
  url: string
  title: string
  domain: string
  description: string
  highlights: string[]
  contentType: string
  wordCount: number
  lastIndexed: string
}

export interface SearchResult {
  results: SearchResultHit[]
  total: number
  page: number
  totalPages: number
}

export interface AutocompleteQuery {
  q: string
  limit?: number
}

export interface Suggestion {
  text: string
  url: string
}

export interface CrawledPage {
  url: string
  title: string
  domain: string
  metaDescription?: string
  ogDescription?: string
  contentType: string
  wordCount: number
  lastIndexed: string
  all_text?: string
  [key: string]: unknown
}