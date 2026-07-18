import { Router } from 'express'
import { ALL_STATIONS } from '../data/stations.js'
import { cacheMiddleware, CACHE_CONFIG } from '../middleware/cache.js'
import { getMetroMapData } from '../services/metroMap.js'

const router = Router()

/**
 * GET /api/stations
 * Returns all stations for typeahead
 */
router.get('/', cacheMiddleware(CACHE_CONFIG.stations), (_req, res) => {
  res.json({
    stations: ALL_STATIONS
  })
})

/** Geographic station anchors and canonical ordered paths for the live tracker. */
router.get('/map', cacheMiddleware(CACHE_CONFIG.stations), async (_req, res, next) => {
  try {
    res.json(await getMetroMapData())
  } catch (error) {
    next(error)
  }
})

export default router
