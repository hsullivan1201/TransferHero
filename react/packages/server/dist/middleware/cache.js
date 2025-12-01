const cache = new Map();
/**
 * Cache configuration (in milliseconds)
 */
export const CACHE_CONFIG = {
    stations: 24 * 60 * 60 * 1000, // 24 hours
    travelTimes: 24 * 60 * 60 * 1000, // 24 hours
    tripPlan: 30 * 1000, // 30 seconds (real-time data)
    gtfsRefresh: 6 * 60 * 60 * 1000 // 6 hours
};
/**
 * Get cached value if not expired
 */
export function getCache(key, ttl) {
    const entry = cache.get(key);
    if (!entry)
        return null;
    const now = Date.now();
    if (now - entry.timestamp > ttl) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}
/**
 * Set cache value
 */
export function setCache(key, data) {
    cache.set(key, {
        data,
        timestamp: Date.now()
    });
}
/**
 * Clear cache entry
 */
export function clearCache(key) {
    cache.delete(key);
}
/**
 * Clear all cache entries
 */
export function clearAllCache() {
    cache.clear();
}
/**
 * Express middleware for caching responses
 */
export function cacheMiddleware(ttl) {
    return (req, res, next) => {
        const cacheKey = `${req.method}:${req.originalUrl}`;
        const cached = getCache(cacheKey, ttl);
        if (cached) {
            res.set('X-Cache', 'HIT');
            return res.json(cached);
        }
        // Override res.json to cache the response
        const originalJson = res.json.bind(res);
        res.json = (data) => {
            setCache(cacheKey, data);
            res.set('X-Cache', 'MISS');
            return originalJson(data);
        };
        next();
    };
}
//# sourceMappingURL=cache.js.map