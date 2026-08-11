"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  currentPage: number
  totalPages: number
}

export function Pagination({ currentPage, totalPages }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const go = (page: number) => {
    const p = new URLSearchParams(searchParams.toString())
    p.set("page", String(page))
    router.push(`/results?${p}`)
  }

  if (totalPages <= 1) return null

  const pages: (number | "...")[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...")
    }
  }

  return (
    <nav className="flex items-center justify-center gap-1 py-8">
      <button
        onClick={() => go(currentPage - 1)}
        disabled={currentPage <= 1}
        className="flex h-9 w-9 items-center justify-center rounded text-sm text-[#70757a] transition-colors hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`dots-${i}`} className="flex h-9 w-9 items-center justify-center text-sm text-[#70757a]">
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => go(p)}
            className={cn(
              "flex h-9 min-w-[36px] items-center justify-center rounded text-sm transition-colors",
              p === currentPage
                ? "text-[#1a0dab] font-bold"
                : "text-[#1a0dab] hover:bg-gray-100"
            )}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => go(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="flex h-9 w-9 items-center justify-center rounded text-sm text-[#70757a] transition-colors hover:bg-gray-100 disabled:opacity-30 disabled:pointer-events-none"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  )
}