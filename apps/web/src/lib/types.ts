export interface SearchResult {
  url: string
  title: string
  domain: string
  description: string
  highlights: string[]
  contentType: "static" | "javascript"
  wordCount: number
  lastIndexed: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  page: number
  totalPages: number
}

export interface AutocompleteSuggestion {
  text: string
  url: string
}

export interface AutocompleteResponse {
  suggestions: AutocompleteSuggestion[]
}

export interface SearchParams {
  q: string
  page?: number
  limit?: number
  domain?: string
  language?: string
  contentType?: string
  sort?: "relevance" | "date"
  order?: "asc" | "desc"
}