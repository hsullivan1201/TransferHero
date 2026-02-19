import type { Request, Response, NextFunction } from 'express'

interface CacheEntry {
  data: unknown
  timestamp: number
  ttl: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_MAX_ENTRIES = 2000

/**
 * Cache configuration (in milliseconds)
 */
export const CACHE_CONFIG = {
  stations: 24 * 60 * 60 * 1000,     // 24 hours
  travelTimes: 24 * 60 * 60 * 1000,  // 24 hours
  tripPlan: 10 * 1000,               // 10 seconds (real-time data)
  gtfsRefresh: 6 * 60 * 60 * 1000    // 6 hours
}

/**
 * Normalize URLs so query parameter order does not fragment cache keys.
 */
export function normalizeCacheUrl(originalUrl: string): string {
  const [path, queryString] = originalUrl.split('?', 2)
  if (!queryString) return path

  const params = new URLSearchParams(queryString)
  const entries = Array.from(params.entries())
  entries.sort(([aKey, aValue], [bKey, bValue]) => {
    if (aKey === bKey) return aValue.localeCompare(bValue)
    return aKey.localeCompare(bKey)
  })

  const normalizedParams = new URLSearchParams(entries).toString()
  return normalizedParams ? `${path}?${normalizedParams}` : path
}

/**
 * Get cached value if not expired
 */
export function getCache<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null

  const now = Date.now()
  if (now - entry.timestamp > entry.ttl) {
    cache.delete(key)
    return null
  }

  return entry.data as T
}

/**
 * Set cache value
 */
function pruneExpiredEntries(now: number): void {
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > entry.ttl) {
      cache.delete(key)
    }
  }
}

function evictOverflowEntries(): void {
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) break
    cache.delete(oldestKey)
  }
}

export function setCache(key: string, data: unknown, ttl: number): void {
  const now = Date.now()
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, {
    data,
    timestamp: now,
    ttl
  })

  if (cache.size > CACHE_MAX_ENTRIES) {
    pruneExpiredEntries(now)
    evictOverflowEntries()
  }
}

/**
 * Clear cache entry
 */
export function clearCache(key: string): void {
  cache.delete(key)
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  cache.clear()
}

/**
 * Express middleware for caching responses
 */
export function cacheMiddleware(ttl: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cacheKey = `${req.method}:${normalizeCacheUrl(req.originalUrl)}`
    const cached = getCache(cacheKey)

    if (cached) {
      res.set('X-Cache', 'HIT')
      return res.json(cached)
    }

    // Override res.json to cache the response
    const originalJson = res.json.bind(res)
    res.json = (data: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setCache(cacheKey, data, ttl)
      }
      res.set('X-Cache', 'MISS')
      return originalJson(data)
    }

    next()
  }
}
