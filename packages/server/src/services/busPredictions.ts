import type { BusPrediction } from '@transferhero/shared'
import { getRouteStopSequences, getBusDb } from './busGtfsLoader.js'
import { fetchWithTimeout } from '../utils/http.js'

const PREDICTION_TTL = 15_000 // 15 seconds, matches rail prediction TTL
const FAILURE_TTL = 60_000   // 60 seconds — avoid hammering WMATA for known-bad stops
const CACHE_MAX_SIZE = 4000
const NEXTBUS_TIMEOUT_MS = 8_000

interface CacheEntry {
  data: BusPrediction[]
  ts: number
}

const cache = new Map<string, CacheEntry>()
const pendingPredictionRequests = new Map<string, Promise<BusPrediction[]>>()

// routeId_directionId -> headsign set (rebuilt after GTFS refresh)
const routeDirHeadsignsCache = new Map<string, Set<string>>()
// routeId_directionId -> stopId -> position index
const sequencePositionCache = new Map<string, Map<string, number>>()

const cacheCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.ts > FAILURE_TTL) {
      cache.delete(key)
    }
  }
}, 60_000)
cacheCleanupTimer.unref?.()

function evictIfOverCapacity(): void {
  while (cache.size > CACHE_MAX_SIZE) {
    const oldestKey = cache.keys().next().value
    if (!oldestKey) break
    cache.delete(oldestKey)
  }
}

interface WmataBusPrediction {
  RouteID: string
  DirectionText: string
  Minutes: number
  VehicleID?: string
}

export function invalidateBusPredictionCaches(): void {
  routeDirHeadsignsCache.clear()
  sequencePositionCache.clear()
}

/**
 * Fetch real-time bus predictions for a stop from WMATA NextBusService.
 * Uses the 7-digit stop_code (not stop_id) as required by the API.
 * Cached for 15 seconds.
 */
export async function fetchBusPredictions(
  stopCode: string,
  apiKey: string
): Promise<BusPrediction[]> {
  const now = Date.now()
  const cached = cache.get(stopCode)
  if (cached && (now - cached.ts) < PREDICTION_TTL) {
    return cached.data
  }

  const pending = pendingPredictionRequests.get(stopCode)
  if (pending) return pending

  const request = (async () => {
    try {
      const url = `https://api.wmata.com/NextBusService.svc/json/jPredictions?StopID=${encodeURIComponent(stopCode)}`
      const response = await fetchWithTimeout(url, {
        timeoutMs: NEXTBUS_TIMEOUT_MS,
        headers: { 'api_key': apiKey }
      })

      if (!response.ok) {
        console.warn(`[BusPredictions] API error for stop ${stopCode}: ${response.status}`)
        if (!cached) {
          cache.set(stopCode, { data: [], ts: now - PREDICTION_TTL + FAILURE_TTL })
          evictIfOverCapacity()
        }
        return cached?.data ?? []
      }

      const data = await response.json() as { Predictions?: WmataBusPrediction[] }
      const predictions: BusPrediction[] = (data.Predictions || []).map(p => ({
        routeId: `wmata:${p.RouteID}`,
        directionText: p.DirectionText,
        minutes: p.Minutes,
        vehicleId: p.VehicleID,
      }))

      cache.set(stopCode, { data: predictions, ts: Date.now() })
      evictIfOverCapacity()
      return predictions
    } catch (err) {
      console.warn(`[BusPredictions] Fetch failed for stop ${stopCode}:`, err)
      if (!cached) {
        cache.set(stopCode, { data: [], ts: now - PREDICTION_TTL + FAILURE_TTL })
        evictIfOverCapacity()
      }
      return cached?.data ?? []
    } finally {
      pendingPredictionRequests.delete(stopCode)
    }
  })()

  pendingPredictionRequests.set(stopCode, request)
  return request
}

function getStopPositionMap(seqKey: string, sequence: string[]): Map<string, number> {
  const cached = sequencePositionCache.get(seqKey)
  if (cached) return cached

  const positions = new Map<string, number>()
  for (let i = 0; i < sequence.length; i++) {
    if (!positions.has(sequence[i])) {
      positions.set(sequence[i], i)
    }
  }

  sequencePositionCache.set(seqKey, positions)
  return positions
}

function routeDirectionCanServeLeg(
  routeId: string,
  directionId: number,
  boardStopId: string,
  alightStopId: string,
  sequences: Map<string, string[]>
): boolean {
  const seqKey = `${routeId}_${directionId}`
  const sequence = sequences.get(seqKey)
  if (!sequence) return false

  const positions = getStopPositionMap(seqKey, sequence)
  const boardIdx = positions.get(boardStopId)
  const alightIdx = positions.get(alightStopId)
  return boardIdx !== undefined && alightIdx !== undefined && boardIdx < alightIdx
}

function getHeadsignsForRouteDirection(routeId: string, directionId: number): Set<string> {
  const key = `${routeId}_${directionId}`
  const cached = routeDirHeadsignsCache.get(key)
  if (cached) return cached

  const busDb = getBusDb()
  if (!busDb) return new Set<string>()

  const rows = busDb.prepare(
    'SELECT DISTINCT headsign FROM trips WHERE route_id = ? AND direction_id = ?'
  ).all(routeId, directionId) as { headsign: string }[]

  const headsigns = new Set<string>()
  for (const row of rows) {
    if (row.headsign) headsigns.add(row.headsign)
  }

  routeDirHeadsignsCache.set(key, headsigns)
  return headsigns
}

/**
 * For a route, find which direction(s) have boardStop before alightStop,
 * then return ALL headsigns for those valid directions from GTFS.
 * This handles short turns: a short-turn trip shares the same direction_id
 * but has a different headsign (e.g. "South to Wheaton" vs "South to Silver Spring").
 */
function getValidHeadsigns(
  routeId: string,
  boardStopId: string,
  alightStopId: string,
  sequences: Map<string, string[]>
): Set<string> | null {
  const validDirs: number[] = []

  for (const dir of [0, 1]) {
    if (routeDirectionCanServeLeg(routeId, dir, boardStopId, alightStopId, sequences)) {
      validDirs.push(dir)
    }
  }

  if (validDirs.length === 0) return null

  const headsigns = new Set<string>()
  for (const dir of validDirs) {
    const byDir = getHeadsignsForRouteDirection(routeId, dir)
    for (const headsign of byDir) {
      headsigns.add(headsign)
    }
  }

  return headsigns.size > 0 ? headsigns : null
}

/**
 * Filter predictions to routes that serve both the board and alight stops,
 * AND are going in the correct direction. Handles short turns by matching
 * against all GTFS headsigns for the valid direction_id.
 */
export function filterPredictionsForRoute(
  predictions: BusPrediction[],
  routeId: string,
  boardStopId?: string,
  alightStopId?: string,
  limit: number = 5
): BusPrediction[] {
  if (predictions.length === 0) return []

  // Build set of acceptable route IDs: the requested route + any variant that
  // also serves the alight stop (checked via GTFS stop sequences)
  const validRoutes = new Set([routeId])

  // Collect valid headsigns per route (for direction filtering)
  const validHeadsignsByRoute = new Map<string, Set<string>>()

  if (alightStopId && boardStopId) {
    const sequences = getRouteStopSequences()

    // Get valid headsigns for primary route
    const primaryHeadsigns = getValidHeadsigns(routeId, boardStopId, alightStopId, sequences)
    if (primaryHeadsigns) {
      validHeadsignsByRoute.set(routeId, primaryHeadsigns)
    }

    // Check variant routes
    const otherRouteIds = new Set(predictions.map(p => p.routeId).filter(r => r !== routeId))

    for (const candidateRoute of otherRouteIds) {
      let canServe = false
      for (const dir of [0, 1]) {
        if (routeDirectionCanServeLeg(candidateRoute, dir, boardStopId, alightStopId, sequences)) {
          canServe = true
          break
        }
      }

      if (!canServe) continue

      validRoutes.add(candidateRoute)
      const variantHeadsigns = getValidHeadsigns(candidateRoute, boardStopId, alightStopId, sequences)
      if (variantHeadsigns) {
        validHeadsignsByRoute.set(candidateRoute, variantHeadsigns)
      }
    }
  }

  const filtered = predictions
    .filter(p => {
      if (!validRoutes.has(p.routeId)) return false
      // If we have headsign data, filter by direction
      const headsigns = validHeadsignsByRoute.get(p.routeId)
      if (headsigns && p.directionText) {
        return headsigns.has(p.directionText)
      }
      // No headsign data available — allow through (graceful degradation)
      return true
    })
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, limit)

  if (filtered.length === 0 && predictions.length > 0) {
    const headsigns = validHeadsignsByRoute.get(routeId)
    console.log(`[BusPredictions] No match for route "${routeId}" dir=[${headsigns ? [...headsigns].join(', ') : '?'}]. Available: ${[...new Set(predictions.map(p => `${p.routeId}:${p.directionText}`))].join(', ')}`)
  } else if (validRoutes.size > 1) {
    console.log(`[BusPredictions] Route "${routeId}" + variants [${[...validRoutes].join(', ')}]: ${filtered.length} predictions`)
  }

  return filtered
}
