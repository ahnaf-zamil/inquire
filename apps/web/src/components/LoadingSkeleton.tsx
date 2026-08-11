"use client"

import { Skeleton } from "@/components/ui/skeleton"

export function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-48 bg-gray-200" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-72 bg-gray-200" />
          <Skeleton className="h-3 w-48 bg-gray-200" />
          <Skeleton className="h-4 w-full bg-gray-100" />
          <Skeleton className="h-4 w-3/4 bg-gray-100" />
          <div className="h-2" />
        </div>
      ))}
    </div>
  )
}