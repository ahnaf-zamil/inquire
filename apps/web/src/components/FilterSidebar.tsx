"use client"

import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  domain: string
  language: string
  contentType: string
  sort: string
  order: string
  onChange: (key: string, value: string) => void
  onReset: () => void
  horizontal?: boolean
}

export function FilterSidebar({
  domain,
  language,
  contentType,
  sort,
  order,
  onChange,
  onReset,
  horizontal,
}: Props) {
  const hasFilters = domain || language || contentType || sort !== "relevance" || order !== "desc"

  const wrap = (children: React.ReactNode) =>
    horizontal ? (
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    ) : (
      <div className="space-y-6">{children}</div>
    )

  const group = (label: string, children: React.ReactNode) =>
    horizontal ? (
      <div className="space-y-1 min-w-[140px]">
        <label className="text-xs text-[#70757a]">{label}</label>
        {children}
      </div>
    ) : (
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#70757a]">{label}</label>
        {children}
      </div>
    )

  const content = (
    <>
      {group("Domain",
        <Input
          placeholder="example.com"
          value={domain}
          onChange={(e) => onChange("domain", e.target.value)}
          className="h-9 text-sm"
        />
      )}
      {group("Language",
        <Select value={language} onValueChange={(v) => onChange("language", (v ?? "") === "all" ? "" : (v ?? ""))}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="es">Spanish</SelectItem>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="de">German</SelectItem>
            <SelectItem value="zh">Chinese</SelectItem>
            <SelectItem value="ja">Japanese</SelectItem>
          </SelectContent>
        </Select>
      )}
      {group("Type",
        <Select value={contentType} onValueChange={(v) => onChange("contentType", (v ?? "") === "all" ? "" : (v ?? ""))}>
          <SelectTrigger className="h-9">
            <SelectValue placeholder="Any" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any</SelectItem>
            <SelectItem value="static">Static</SelectItem>
            <SelectItem value="javascript">JavaScript</SelectItem>
          </SelectContent>
        </Select>
      )}
      {group("Sort",
        <Select value={sort} onValueChange={(v) => onChange("sort", v ?? "relevance")}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">Relevance</SelectItem>
            <SelectItem value="date">Date</SelectItem>
          </SelectContent>
        </Select>
      )}
      {group("Order",
        <Select value={order} onValueChange={(v) => onChange("order", v ?? "desc")}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="desc">Descending</SelectItem>
            <SelectItem value="asc">Ascending</SelectItem>
          </SelectContent>
        </Select>
      )}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onReset} className="h-9 text-xs text-[#70757a]">
          <X className="h-3 w-3 mr-1" />
          Reset
        </Button>
      )}
    </>
  )

  if (horizontal) return wrap(content)

  return (
    <aside className="w-full shrink-0 space-y-6 lg:w-64">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-[#1f1f1f]">
          <Search className="h-4 w-4" />
          Filters
        </h2>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={onReset} className="h-7 text-xs">
            <X className="h-3 w-3 mr-1" />
            Reset
          </Button>
        )}
      </div>
      {content}
    </aside>
  )
}