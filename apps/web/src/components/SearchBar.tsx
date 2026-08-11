"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ArrowRight } from "lucide-react"
import { autocompleteSuggestions } from "@/lib/api"
import type { AutocompleteSuggestion } from "@/lib/types"
import { AutocompleteDropdown } from "./AutocompleteDropdown"
import { cn } from "@/lib/utils"

export function SearchBar({ className }: { className?: string }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setSuggestions([])
      setShowDropdown(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      const res = await autocompleteSuggestions(query)
      setSuggestions(res.suggestions)
      setShowDropdown(true)
      setActive(-1)
    }, 150)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [])

  const submit = (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    setShowDropdown(false)
    router.push(`/results?q=${encodeURIComponent(trimmed)}`)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (active >= 0 && suggestions[active]) {
        submit(suggestions[active].text)
      } else {
        submit(query)
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => (a + 1) % Math.max(suggestions.length, 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => (a - 1 + Math.max(suggestions.length, 1)) % Math.max(suggestions.length, 1))
    } else if (e.key === "Escape") {
      setShowDropdown(false)
      setActive(-1)
    }
  }

  return (
    <div ref={boxRef} className={cn("relative w-full", className)}>
      <form
        className="group relative flex items-center"
        onSubmit={(e) => {
          e.preventDefault()
          submit(query)
        }}
      >
        <Search className="absolute left-4 h-5 w-5 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => query.trim() && setShowDropdown(true)}
          placeholder="Search the web..."
          className="h-14 w-full rounded-full border border-border bg-background pl-12 pr-16 text-base shadow-sm transition-all outline-none placeholder:text-muted-foreground focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
          aria-label="Search"
        />
        <button
          type="submit"
          aria-label="Search"
          className="absolute right-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
      </form>
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-20 mt-2 w-full">
          <AutocompleteDropdown
            suggestions={suggestions}
            active={active}
            onSelect={(text) => {
              setQuery(text)
              submit(text)
            }}
            onHover={(i) => setActive(i)}
          />
        </div>
      )}
    </div>
  )
}
