"use client"

import type { AutocompleteSuggestion } from "@/lib/types"
import { cn } from "@/lib/utils"

interface Props {
  suggestions: AutocompleteSuggestion[]
  active: number
  onSelect: (text: string) => void
  onHover: (i: number) => void
}

export function AutocompleteDropdown({ suggestions, active, onSelect, onHover }: Props) {
  return (
    <ul className="max-h-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg backdrop-blur-md">
      {suggestions.map((s, i) => (
        <li key={`${s.url}-${i}`}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(s.text)
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm",
              active === i ? "bg-accent" : ""
            )}
          >
            <span className="text-muted-foreground shrink-0">{"⌕"}</span>
            <span className="truncate">{s.text}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
