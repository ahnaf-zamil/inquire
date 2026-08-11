export function HighlightedText({ text }: { text: string }) {
  if (!text) return null
  const parts = text.split(/(<em>|<\/em>)/g)
  let inEm = false
  return (
    <span>
      {parts.map((part, i) => {
        if (part === "<em>") { inEm = true; return null }
        if (part === "</em>") { inEm = false; return null }
        return inEm ? <em key={i} className="text-primary font-semibold not-italic">{part}</em> : part
      })}
    </span>
  )
}
