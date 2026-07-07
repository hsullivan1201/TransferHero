import { Router } from 'express'
import { cacheMiddleware } from '../middleware/cache.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { getIncidents } from '../services/incidents.js'

const ALERTS_CACHE_TTL = 60 * 1000

function getApiKey(): string {
  const key = process.env.WMATA_API_KEY
  if (!key) {
    throw new Error('WMATA_API_KEY not configured')
  }
  return key
}

const router = Router()

router.get('/', cacheMiddleware(ALERTS_CACHE_TTL), asyncHandler(async (_req, res) => {
  const payload = await getIncidents(getApiKey())
  res.json(payload)
}))

export default router
