import { SearchX } from "lucide-react"

export function EmptyState({ query }: { query?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <SearchX className="h-10 w-10 text-[#70757a] mb-4" />
      <h2 className="text-lg font-medium mb-2">No results found</h2>
      {query && (
        <p className="text-sm text-[#70757a] mb-4 max-w-md">
          Your search &ndash; <span className="font-medium">{query}</span> &ndash; did not match any documents.
        </p>
      )}
      <ul className="text-sm text-[#70757a] space-y-1">
        <li>Try different keywords</li>
        <li>Make sure all words are spelled correctly</li>
        <li>Use fewer or more general keywords</li>
      </ul>
    </div>
  )
}