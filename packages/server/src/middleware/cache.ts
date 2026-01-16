import type { Request, Response, NextFunction } from 'express'

interface CacheEntry {
  data: any
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

/**
 * Cache configuration (in milliseconds)
 */
export const CACHE_CONFIG = {
  stations: 24 * 60 * 60 * 1000,     // 24 hours
  travelTimes: 24 * 60 * 60 * 1000,  // 24 hours
  tripPlan: 30 * 1000,               // 30 seconds (real-time data)
  gtfsRefresh: 6 * 60 * 60 * 1000    // 6 hours
}

/**
 * Get cached value if not expired
 */
export function getCache<T>(key: string, ttl: number): T | null {
  const entry = cache.get(key)
  if (!entry) return null

  const now = Date.now()
  if (now - entry.timestamp > ttl) {
    cache.delete(key)
    return null
  }

  return entry.data as T
}

/**
 * Set cache value
 */
export function setCache(key: string, data: any): void {
  cache.set(key, {
    data,
    timestamp: Date.now()
  })
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
    const cacheKey = `${req.method}:${req.originalUrl}`
    const cached = getCache(cacheKey, ttl)

    if (cached) {
      res.set('X-Cache', 'HIT')
      return res.json(cached)
    }

    // Override res.json to cache the response
    const originalJson = res.json.bind(res)
    res.json = (data: any) => {
      setCache(cacheKey, data)
      res.set('X-Cache', 'MISS')
      return originalJson(data)
    }

    next()
  }
}
