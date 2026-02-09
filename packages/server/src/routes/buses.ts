import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js'
import { isBusDataLoaded } from '../services/busGtfsLoader.js'
import { findMetroBusTrips, findBusMetroTrips } from '../services/busRouteFinder.js'
import { fetchBusPredictions, filterPredictionsForRoute } from '../services/busPredictions.js'
import { getWalkingDirections } from '../services/walkingDirectionsService.js'
import type { HybridTrip } from '@transferhero/shared'

const router = Router()

const tripsSchema = z.object({
  originLat: z.coerce.number().min(-90).max(90),
  originLon: z.coerce.number().min(-180).max(180),
  destLat: z.coerce.number().min(-90).max(90),
  destLon: z.coerce.number().min(-180).max(180),
  originStation: z.string().min(2).max(10),
  destStation: z.string().min(2).max(10),
})

// Route-finding cache: 5 min TTL (bus routes don't change)
const routeCache = new Map<string, { data: HybridTrip[]; ts: number }>()
const ROUTE_CACHE_TTL = 5 * 60 * 1000

function getApiKey(): string {
  const key = process.env.WMATA_API_KEY
  if (!key) throw new Error('WMATA_API_KEY not set')
  return key
}

/**
 * GET /api/buses/trips
 * Find hybrid Metro+Bus trip options
 */
router.get('/trips', asyncHandler(async (req, res) => {
  if (!isBusDataLoaded()) {
    return res.json({ trips: [], busDataAvailable: false })
  }

  const { originLat, originLon, destLat, destLon, originStation, destStation } = tripsSchema.parse(req.query)

  // Check route cache
  const cacheKey = `${originLat.toFixed(4)}_${originLon.toFixed(4)}_${destLat.toFixed(4)}_${destLon.toFixed(4)}_${originStation}_${destStation}`
  const now = Date.now()
  const cached = routeCache.get(cacheKey)

  let trips: HybridTrip[]
  if (cached && (now - cached.ts) < ROUTE_CACHE_TTL) {
    trips = cached.data
  } else {
    // Run both Metro→Bus and Bus→Metro finders
    const metroBus = findMetroBusTrips(destLat, destLon, originStation, originLat, originLon)
    const busMetro = findBusMetroTrips(originLat, originLon, destStation, originStation, destLat, destLon)

    trips = [...metroBus, ...busMetro]
      .sort((a, b) => a.totalTimeMinutes - b.totalTimeMinutes)
      .slice(0, 5)

    routeCache.set(cacheKey, { data: trips, ts: now })
  }

  res.json({ trips, busDataAvailable: true })
}))

const predictionsSchema = z.object({
  stopCode: z.string().min(1).max(10),
  routeId: z.string().min(1).max(10),
})

/**
 * GET /api/buses/predictions
 * Fetch real-time predictions for a specific boarding stop + route.
 * Called only when user selects a trip — 1 WMATA API call.
 */
router.get('/predictions', asyncHandler(async (req, res) => {
  const { stopCode, routeId } = predictionsSchema.parse(req.query)
  const apiKey = getApiKey()
  const all = await fetchBusPredictions(stopCode, apiKey)
  const predictions = filterPredictionsForRoute(all, routeId)
  res.json({ predictions })
}))

const walkSchema = z.object({
  boardStopLat: z.coerce.number().min(-90).max(90),
  boardStopLon: z.coerce.number().min(-180).max(180),
  alightStopLat: z.coerce.number().min(-90).max(90),
  alightStopLon: z.coerce.number().min(-180).max(180),
  /** For metro-bus: walk origin is Metro exit, walk dest is bus board stop.
   *  For bus-metro: walk origin is user location, walk dest is bus board stop.
   *  We also need the alight side: bus alight stop → final destination (or Metro station). */
  boardFromLat: z.coerce.number().min(-90).max(90),
  boardFromLon: z.coerce.number().min(-180).max(180),
  alightToLat: z.coerce.number().min(-90).max(90),
  alightToLon: z.coerce.number().min(-180).max(180),
})

/**
 * GET /api/buses/walk
 * Enrich a selected bus trip's walk segments with Google Directions.
 * Called only when user taps a bus trip card — max 2 Google API calls.
 */
router.get('/walk', asyncHandler(async (req, res) => {
  const params = walkSchema.parse(req.query)

  // Walk TO the boarding stop (from Metro exit or user location)
  // Walk FROM the alighting stop (to destination or Metro station)
  const [boardWalk, alightWalk] = await Promise.all([
    getWalkingDirections(params.boardFromLat, params.boardFromLon, params.boardStopLat, params.boardStopLon),
    getWalkingDirections(params.alightStopLat, params.alightStopLon, params.alightToLat, params.alightToLon),
  ])

  res.json({
    board: boardWalk ? {
      walkTimeMinutes: boardWalk.walkTimeMinutes,
      walkDistanceMeters: boardWalk.walkDistanceMeters,
    } : null,
    alight: alightWalk ? {
      walkTimeMinutes: alightWalk.walkTimeMinutes,
      walkDistanceMeters: alightWalk.walkDistanceMeters,
    } : null,
  })
}))

export default router
