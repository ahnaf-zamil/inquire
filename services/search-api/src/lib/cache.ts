import Redis from 'ioredis'

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  keyPrefix: 'search:cache:',
})

const DEFAULT_TTL = parseInt(process.env.SEARCH_CACHE_TTL || '30')

export async function getCached(key: string): Promise<string | null> {
  return redis.get(key)
}

export async function setCache(key: string, value: string, ttl = DEFAULT_TTL): Promise<void> {
  await redis.setex(key, ttl, value)
}

export function cacheKey(q: string, page: number, limit: number, filters: Record<string, string | undefined>): string {
  const parts = [`q=${encodeURIComponent(q)}`, `p=${page}`, `l=${limit}`]
  for (const [k, v] of Object.entries(filters)) {
    if (v) parts.push(`${k}=${encodeURIComponent(v)}`)
  }
  return parts.sort().join('|')
}