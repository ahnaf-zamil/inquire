"use client"

import Link from "next/link"
import { FloatingNav } from "@/components/ui/floating-navbar"
import { Search, Home } from "lucide-react"

const navItems = [
  { name: "Home", link: "/", icon: <Home className="h-4 w-4" /> },
  { name: "Search", link: "/results?q=", icon: <Search className="h-4 w-4" /> },
]

export function Navbar() {
  return (
    <FloatingNav
      navItems={navItems}
      className="top-4"
    />
  )
}
