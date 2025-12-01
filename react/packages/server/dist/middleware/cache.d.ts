import type { Request, Response, NextFunction } from 'express';
/**
 * Cache configuration (in milliseconds)
 */
export declare const CACHE_CONFIG: {
    stations: number;
    travelTimes: number;
    tripPlan: number;
    gtfsRefresh: number;
};
/**
 * Get cached value if not expired
 */
export declare function getCache<T>(key: string, ttl: number): T | null;
/**
 * Set cache value
 */
export declare function setCache(key: string, data: any): void;
/**
 * Clear cache entry
 */
export declare function clearCache(key: string): void;
/**
 * Clear all cache entries
 */
export declare function clearAllCache(): void;
/**
 * Express middleware for caching responses
 */
export declare function cacheMiddleware(ttl: number): (req: Request, res: Response, next: NextFunction) => Response<any, Record<string, any>> | undefined;
//# sourceMappingURL=cache.d.ts.map