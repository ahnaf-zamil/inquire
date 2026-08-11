import type { SearchParams, SearchResponse, AutocompleteResponse } from "./types"

const BASE = process.env.NEXT_PUBLIC_SEARCH_API_URL || "http://localhost:3001"

export async function searchResults(params: SearchParams): Promise<SearchResponse> {
  const qs = new URLSearchParams()
  qs.set("q", params.q)
  if (params.page) qs.set("page", String(params.page))
  if (params.limit) qs.set("limit", String(params.limit))
  if (params.domain) qs.set("domain", params.domain)
  if (params.language) qs.set("language", params.language)
  if (params.contentType) qs.set("contentType", params.contentType)
  if (params.sort) qs.set("sort", params.sort)
  if (params.order) qs.set("order", params.order)

  const res = await fetch(`${BASE}/search?${qs}`, { cache: "no-store" })
  if (!res.ok) throw new Error(`Search API error: ${res.status}`)
  return res.json()
}

export async function autocompleteSuggestions(q: string): Promise<AutocompleteResponse> {
  if (!q.trim()) return { suggestions: [] }
  const qs = new URLSearchParams({ q: q.trim() })
  const res = await fetch(`${BASE}/autocomplete?${qs}`, { cache: "no-store" })
  if (!res.ok) return { suggestions: [] }
  return res.json()
}