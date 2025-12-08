import { Router } from 'express'
import { getWmataCacheStats, resetWmataCacheStats } from '../services/wmata.js'

const router = Router()

// remember when we booted
const startTime = Date.now()

// stash when GTFS last updated (cron sets this)
let gtfsLastUpdated: Date | null = null

/**
 * update the GTFS timestamp (cron pokes this)
 */
export function setGtfsLastUpdated(date: Date): void {
  gtfsLastUpdated = date
}

/**
 * GET /api/health
 * basic health check for monitors and dashboards
 */
router.get('/', (_req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000)
  const cacheStats = getWmataCacheStats()

  res.json({
    status: 'ok',
    gtfsLastUpdated: gtfsLastUpdated?.toISOString() || null,
    uptime: uptime,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    wmataCache: {
      predictions: {
        hits: cacheStats.predictionHits,
        misses: cacheStats.predictionMisses,
        hitRate: cacheStats.predictionHits + cacheStats.predictionMisses > 0
          ? Math.round((cacheStats.predictionHits / (cacheStats.predictionHits + cacheStats.predictionMisses)) * 100)
          : 0
      },
      gtfs: {
        hits: cacheStats.gtfsHits,
        misses: cacheStats.gtfsMisses,
        hitRate: cacheStats.gtfsHits + cacheStats.gtfsMisses > 0
          ? Math.round((cacheStats.gtfsHits / (cacheStats.gtfsHits + cacheStats.gtfsMisses)) * 100)
          : 0
      }
    }
  })
})

/**
 * POST /api/health/reset-cache-stats
 * reset cache stats (handy for debugging)
 */
router.post('/reset-cache-stats', (_req, res) => {
  resetWmataCacheStats()
  res.json({ status: 'ok', message: 'Cache stats reset' })
})

export default router
