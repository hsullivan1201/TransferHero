import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js'
import { searchPlaces, isGeocodingEnabled } from '../services/geocodingService.js'
import { resolveDestination } from '../services/exitResolver.js'
import { loadStationExits } from '../services/stationService.js'
import { getWalkingDirections } from '../services/walkingDirectionsService.js'
import { findBusConnectedStation } from '../services/busRouteFinder.js'

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
    // No Metro station within walking distance — try bus-connected fallback
    const busResult = findBusConnectedStation(lat, lon)
    if (!busResult) {
      console.warn(`[destinations] No stations or bus connections near (${lat}, ${lon})`)
      throw new NotFoundError('No stations within walking distance')
    }

    console.log(`[destinations] Bus-only fallback: (${lat}, ${lon}) → ${busResult.station.name} via bus`)
    res.json({
      station: busResult.station,
      exit: busResult.exit,
      walkTimeMinutes: busResult.walkTimeMinutes,
      walkDistanceMeters: busResult.walkDistanceMeters,
      alternatives: [],
      busOnly: true,
    })
    return
  }

  // Enrich with real Google walking directions (parallel, fallback to Haversine)
  const allExits = [
    result.exit,
    ...result.alternatives.map(a => a.exit),
  ]
  const directionsResults = await Promise.all(
    allExits.map(exit => getWalkingDirections(lat, lon, exit.lat, exit.lon))
  )

  if (directionsResults[0]) {
    result.walkTimeMinutes = directionsResults[0].walkTimeMinutes
    result.walkDistanceMeters = directionsResults[0].walkDistanceMeters
  }
  result.alternatives.forEach((alt, i) => {
    const dirs = directionsResults[i + 1]
    if (dirs) {
      alt.walkTimeMinutes = dirs.walkTimeMinutes
      alt.walkDistanceMeters = dirs.walkDistanceMeters
    }
  })

  res.json(result)
}))

export default router
