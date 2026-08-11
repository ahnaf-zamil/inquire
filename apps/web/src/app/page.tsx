"use client"

import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect"
import { Spotlight } from "@/components/ui/spotlight-new"
import { TypewriterEffect } from "@/components/ui/typewriter-effect"
import { SearchBar } from "@/components/SearchBar"

const typewriterWords = [
  { text: "Search" },
  { text: "the" },
  { text: "indexed" },
  { text: "web", className: "text-blue-500" },
]

export default function HomePage() {
  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-white">
      <BackgroundRippleEffect rows={25} cols={48} cellSize={56} />
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4">
        <Spotlight />

        <TypewriterEffect
          words={typewriterWords}
          className="mb-8"
          cursorClassName="bg-blue-500"
        />

        <p className="text-[#70757a] text-sm sm:text-base mb-8 text-center max-w-lg">
          Discover pages crawled from across the web. Full-text search with smart ranking and instant results.
        </p>

        <SearchBar className="w-full max-w-xl" />
      </div>
    </div>
  )
}