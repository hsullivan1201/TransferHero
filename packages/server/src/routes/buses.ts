import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../middleware/errorHandler.js'
import { isBusDataLoaded, getFeedConfigs } from '../services/busGtfsLoader.js'
import { findMetroBusTrips, findBusMetroTrips, getStationCentroid } from '../services/busRouteFinder.js'
import { fetchBusPredictions, filterPredictionsForRoute } from '../services/busPredictions.js'
import { fetchGtfsRtBusPredictions } from '../services/gtfsRtPredictions.js'
import { getWalkingDirections } from '../services/walkingDirectionsService.js'
import type { HybridTrip } from '@transferhero/shared'
import { busTripsRateLimit, busPredictionsRateLimit, busWalkRateLimit } from '../middleware/rateLimit.js'

const router = Router()

const tripsSchema = z.object({
  originLat: z.coerce.number().min(-90).max(90).optional(),
  originLon: z.coerce.number().min(-180).max(180).optional(),
  destLat: z.coerce.number().min(-90).max(90).optional(),
  destLon: z.coerce.number().min(-180).max(180).optional(),
  originStation: z.string().min(2).max(10),
  destStation: z.string().min(2).max(10),
})

// Route-finding cache: short TTL because wait times are time-sensitive.
const routeCache = new Map<string, { data: HybridTrip[]; ts: number }>()
const ROUTE_CACHE_TTL = 20 * 1000
const ROUTE_CACHE_MAX_SIZE = 400

function pruneRouteCache(now: number): void {
  for (const [key, entry] of routeCache) {
    if ((now - entry.ts) >= ROUTE_CACHE_TTL) routeCache.delete(key)
  }

  while (routeCache.size > ROUTE_CACHE_MAX_SIZE) {
    const oldestKey = routeCache.keys().next().value
    if (!oldestKey) break
    routeCache.delete(oldestKey)
  }
}

function getApiKey(): string {
  const key = process.env.WMATA_API_KEY
  if (!key) throw new Error('WMATA_API_KEY not set')
  return key
}

/**
 * GET /api/buses/trips
 * Find hybrid Metro+Bus trip options
 */
router.get('/trips', busTripsRateLimit, asyncHandler(async (req, res) => {
  if (!isBusDataLoaded()) {
    return res.json({ trips: [], busDataAvailable: false })
  }

  const parsed = tripsSchema.parse(req.query)
  const { originStation, destStation } = parsed

  // Fall back to station centroids when coordinates aren't provided
  // (happens when user selects a Metro station directly instead of a place)
  const originCentroid = getStationCentroid(originStation)
  const destCentroid = getStationCentroid(destStation)
  const originLat = parsed.originLat ?? originCentroid?.lat
  const originLon = parsed.originLon ?? originCentroid?.lon
  const destLat = parsed.destLat ?? destCentroid?.lat
  const destLon = parsed.destLon ?? destCentroid?.lon

  if (originLat == null || originLon == null || destLat == null || destLon == null) {
    return res.json({ trips: [], busDataAvailable: true })
  }

  // Check route cache
  const cacheKey = `${originLat.toFixed(4)}_${originLon.toFixed(4)}_${destLat.toFixed(4)}_${destLon.toFixed(4)}_${originStation}_${destStation}`
  const now = Date.now()
  pruneRouteCache(now)
  const cached = routeCache.get(cacheKey)

  let trips: HybridTrip[]
  if (cached && (now - cached.ts) < ROUTE_CACHE_TTL) {
    trips = cached.data
  } else {
    // Run both Metro→Bus and Bus→Metro finders
    const metroBus = findMetroBusTrips(destLat, destLon, originStation, originLat, originLon)
    const busMetro = findBusMetroTrips(originLat, originLon, destStation, destLat, destLon)

    trips = [...metroBus, ...busMetro]
      .sort((a, b) => a.totalTimeMinutes - b.totalTimeMinutes)
      .slice(0, 7)

    // Lightweight telemetry so we can spot asymmetry/empty-pattern issues quickly.
    if (metroBus.length === 0 || busMetro.length === 0) {
      console.log(
        `[BusTrips] ${originStation}->${destStation} metroBus=${metroBus.length} busMetro=${busMetro.length} returned=${trips.length}`
      )
    }

    routeCache.set(cacheKey, { data: trips, ts: now })
    pruneRouteCache(now)
  }

  res.json({ trips, busDataAvailable: true, _v: 2 })
}))

const predictionsSchema = z.object({
  stopCode: z.string().min(1).max(20),
  routeId: z.string().min(1).max(20),
  boardStopId: z.string().optional(),
  alightStopId: z.string().optional(),
  agencyId: z.enum(['wmata', 'art', 'fairfax']).default('wmata'),
})

/**
 * GET /api/buses/predictions
 * Fetch real-time predictions for a specific boarding stop + route.
 * Dispatches to WMATA JSON API or GTFS-RT based on agencyId.
 * Called only when user selects a trip — 1 API call.
 */
router.get('/predictions', busPredictionsRateLimit, asyncHandler(async (req, res) => {
  const { stopCode, routeId, boardStopId, alightStopId, agencyId } = predictionsSchema.parse(req.query)

  let all
  if (agencyId === 'wmata') {
    // WMATA uses their proprietary JSON API with un-prefixed stop codes
    const apiKey = getApiKey()
    all = await fetchBusPredictions(stopCode, apiKey)
  } else {
    // Other agencies use GTFS-RT TripUpdates feed
    const feed = getFeedConfigs().find(f => f.agencyId === agencyId)
    if (!feed?.gtfsRtTripUpdatesUrl) {
      return res.json({ predictions: [] })
    }
    // boardStopId is the namespaced stop ID (e.g. 'art:12345')
    all = await fetchGtfsRtBusPredictions(agencyId, boardStopId || '', feed.gtfsRtTripUpdatesUrl, feed.headers)
  }

  const predictions = filterPredictionsForRoute(all, routeId, boardStopId, alightStopId)
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
router.get('/walk', busWalkRateLimit, asyncHandler(async (req, res) => {
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
