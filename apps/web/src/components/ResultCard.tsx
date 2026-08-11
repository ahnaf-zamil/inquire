import type { SearchResult } from "@/lib/types"
import { HighlightedText } from "./HighlightedText"

export function ResultCard({ result }: { result: SearchResult }) {
  let displayUrl = result.url
  let hostname = ""
  try {
    const u = new URL(result.url)
    hostname = u.hostname
    displayUrl = hostname + u.pathname.replace(/\/$/, "")
  } catch {}

  return (
    <article className="mb-6">
      <div className="flex items-center gap-2 mb-0.5">
        <img
          src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
          alt=""
          className="h-5 w-5 rounded-full shrink-0"
          width={20}
          height={20}
        />
        <cite className="text-sm text-[#006621] truncate not-italic">
          {displayUrl}
        </cite>
      </div>
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group"
      >
        <h2 className="text-xl text-[#1a0dab] group-hover:underline leading-6 font-normal">
          {result.title || displayUrl}
        </h2>
      </a>
      {result.description && (
        <p className="text-sm text-[#4d5156] leading-6 mt-0.5">
          <HighlightedText text={result.description} />
        </p>
      )}
      {result.highlights.length > 0 && (
        <p className="text-sm text-[#4d5156] leading-6 mt-0.5">
          {result.highlights.slice(0, 1).map((h, i) => (
            <span key={i}><HighlightedText text={`…${h}…`} /></span>
          ))}
        </p>
      )}
      <div className="flex items-center gap-3 mt-1 text-xs text-[#70757a]">
        {result.contentType && <span>{result.contentType}</span>}
        {result.wordCount > 0 && <span>{result.wordCount.toLocaleString()} words</span>}
        {result.lastIndexed && <span>{new Date(result.lastIndexed).toLocaleDateString()}</span>}
      </div>
    </article>
  )
}