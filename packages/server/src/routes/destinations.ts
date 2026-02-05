import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js'
import { searchPlaces, isGeocodingEnabled } from '../services/geocodingService.js'
import { resolveDestination } from '../services/exitResolver.js'
import { loadStationExits } from '../services/stationService.js'

const router = Router()

const searchSchema = z.object({
  q: z.string().min(2).max(100),
  session: z.string().optional(),
})

const resolveSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
})

/**
 * GET /api/destinations/search?q=...&session=...
 * Geocode a place query via Google Places
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { q, session } = searchSchema.parse(req.query)

  if (!isGeocodingEnabled()) {
    return res.json({ places: [] })
  }

  const places = await searchPlaces(q, session)
  res.json({ places })
}))

/**
 * GET /api/destinations/resolve?lat=...&lon=...
 * Find the best station + exit for coordinates (pure math, no external calls)
 */
router.get('/resolve', asyncHandler(async (req, res) => {
  const { lat, lon } = resolveSchema.parse(req.query)

  // ensure exit data is loaded
  await loadStationExits()

  const result = resolveDestination(lat, lon)
  if (!result) {
    throw new NotFoundError('No stations within walking distance')
  }

  res.json(result)
}))

export default router
