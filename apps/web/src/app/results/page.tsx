"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { SearchBar } from "@/components/SearchBar"
import { FilterSidebar } from "@/components/FilterSidebar"
import { ResultCard } from "@/components/ResultCard"
import { Pagination } from "@/components/Pagination"
import { LoadingSkeleton } from "@/components/LoadingSkeleton"
import { EmptyState } from "@/components/EmptyState"
import { Footer } from "@/components/Footer"
import { searchResults } from "@/lib/api"
import type { SearchResponse } from "@/lib/types"
import { AlertCircle, SlidersHorizontal, X } from "lucide-react"

function ResultsContent() {
  const searchParams = useSearchParams()

  const q = searchParams.get("q") || ""
  const page = parseInt(searchParams.get("page") || "1", 10)
  const domain = searchParams.get("domain") || ""
  const language = searchParams.get("language") || ""
  const contentType = searchParams.get("contentType") || ""
  const sort = searchParams.get("sort") || "relevance"
  const order = searchParams.get("order") || "desc"

  if (!q) {
    return (
      <div className="text-center py-20 text-[#70757a]">
        Enter a search query to get started
      </div>
    )
  }

  return <ResultsView q={q} page={page} domain={domain} language={language} contentType={contentType} sort={sort} order={order} />
}

function ResultsView({
  q,
  page,
  domain,
  language,
  contentType,
  sort,
  order,
}: {
  q: string
  page: number
  domain: string
  language: string
  contentType: string
  sort: string
  order: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [data, setData] = useState<SearchResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(null)
    searchResults({
      q,
      page,
      limit: 10,
      domain: domain || undefined,
      language: language || undefined,
      contentType: contentType || undefined,
      sort: (sort as "relevance" | "date") || undefined,
      order: (order as "asc" | "desc") || undefined,
    })
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message || "Failed to fetch results")
        setLoading(false)
      })
  }, [q, page, domain, language, contentType, sort, order])

  const updateFilter = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams.toString())
    if (value) {
      p.set(key, value)
    } else {
      p.delete(key)
    }
    if (key !== "page") p.set("page", "1")
    router.push(`/results?${p}`)
  }

  const resetFilters = () => {
    router.push(`/results?q=${encodeURIComponent(q)}`)
  }

  return (
    <>
      <header className="border-b border-[#dadce0] bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 h-16">
          <a href="/" className="text-2xl font-bold tracking-tight shrink-0 text-[#1f1f1f]">
            Search
          </a>
          <SearchBar className="flex-1 max-w-2xl" />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 text-sm text-[#70757a] hover:text-[#1f1f1f] shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </button>
        </div>
        {showFilters && (
          <div className="border-t border-[#dadce0] bg-white">
            <div className="mx-auto max-w-5xl px-4 py-3">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-[#1f1f1f]">Filters</h2>
                <button onClick={() => setShowFilters(false)} className="text-[#70757a] hover:text-[#1f1f1f]">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <FilterSidebar
                domain={domain}
                language={language}
                contentType={contentType}
                sort={sort}
                order={order}
                onChange={updateFilter}
                onReset={resetFilters}
                horizontal
              />
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-5">
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="h-10 w-10 text-[#d93025] mb-4" />
            <h2 className="text-lg font-medium mb-2">Search API unavailable</h2>
            <p className="text-sm text-[#70757a] max-w-md">
              Could not connect to the search service. Make sure the search API is running on port 3001.
            </p>
            <p className="text-xs text-[#70757a] mt-2">{error}</p>
          </div>
        ) : data && data.results.length === 0 ? (
          <EmptyState query={q} />
        ) : data ? (
          <>
            <p className="text-sm text-[#70757a] mb-4">
              About {data.total.toLocaleString()} results ({data.page * 0.1}s)
            </p>
            {data.results.map((r) => (
              <ResultCard key={r.url} result={r} />
            ))}
            <Pagination currentPage={data.page} totalPages={data.totalPages} />
          </>
        ) : null}
      </main>
    </>
  )
}

export default function ResultsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <Suspense>
        <ResultsContent />
      </Suspense>
      <Footer />
    </div>
  )
}