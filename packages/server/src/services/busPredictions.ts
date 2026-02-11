import fetch from 'node-fetch'
import type { BusPrediction } from '@transferhero/shared'
import { getRouteStopSequences, getBusDb } from './busGtfsLoader.js'

const PREDICTION_TTL = 15_000 // 15 seconds, matches rail prediction TTL
const FAILURE_TTL = 60_000   // 60 seconds — avoid hammering WMATA for known-bad stops

interface CacheEntry {
  data: BusPrediction[]
  ts: number
}

const cache = new Map<string, CacheEntry>()

interface WmataBusPrediction {
  RouteID: string
  DirectionText: string
  Minutes: number
  VehicleID?: string
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

  try {
    const url = `https://api.wmata.com/NextBusService.svc/json/jPredictions?StopID=${encodeURIComponent(stopCode)}`
    const response = await fetch(url, {
      headers: { 'api_key': apiKey }
    })

    if (!response.ok) {
      console.warn(`[BusPredictions] API error for stop ${stopCode}: ${response.status}`)
      if (!cached) cache.set(stopCode, { data: [], ts: now - PREDICTION_TTL + FAILURE_TTL })
      return cached?.data ?? []
    }

    const data = await response.json() as { Predictions?: WmataBusPrediction[] }
    const predictions: BusPrediction[] = (data.Predictions || []).map(p => ({
      routeId: p.RouteID,
      directionText: p.DirectionText,
      minutes: p.Minutes,
      vehicleId: p.VehicleID,
    }))

    cache.set(stopCode, { data: predictions, ts: now })
    return predictions
  } catch (err) {
    console.warn(`[BusPredictions] Fetch failed for stop ${stopCode}:`, err)
    if (!cached) cache.set(stopCode, { data: [], ts: now - PREDICTION_TTL + FAILURE_TTL })
    return cached?.data ?? []
  }
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
): Set<string> | null {
  const sequences = getRouteStopSequences()
  const validDirs: number[] = []

  for (const dir of [0, 1]) {
    const seq = sequences.get(`${routeId}_${dir}`)
    if (!seq) continue
    const boardIdx = seq.indexOf(boardStopId)
    const alightIdx = seq.indexOf(alightStopId)
    if (boardIdx !== -1 && alightIdx !== -1 && boardIdx < alightIdx) {
      validDirs.push(dir)
    }
  }

  if (validDirs.length === 0) return null

  // Get all distinct headsigns for these directions from SQLite
  const busDb = getBusDb()
  if (!busDb) return null

  const headsigns = new Set<string>()
  for (const dir of validDirs) {
    const rows = busDb.prepare(
      'SELECT DISTINCT headsign FROM trips WHERE route_id = ? AND direction_id = ?'
    ).all(routeId, dir) as { headsign: string }[]
    for (const row of rows) {
      if (row.headsign) headsigns.add(row.headsign)
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
  // Build set of acceptable route IDs: the requested route + any variant that
  // also serves the alight stop (checked via GTFS stop sequences)
  const validRoutes = new Set([routeId])

  // Collect valid headsigns per route (for direction filtering)
  const validHeadsignsByRoute = new Map<string, Set<string>>()

  if (alightStopId && boardStopId) {
    // Get valid headsigns for primary route
    const primaryHeadsigns = getValidHeadsigns(routeId, boardStopId, alightStopId)
    if (primaryHeadsigns) {
      validHeadsignsByRoute.set(routeId, primaryHeadsigns)
    }

    // Check variant routes
    const sequences = getRouteStopSequences()
    const otherRouteIds = new Set(predictions.map(p => p.routeId).filter(r => r !== routeId))

    for (const candidateRoute of otherRouteIds) {
      for (const dir of [0, 1]) {
        const seq = sequences.get(`${candidateRoute}_${dir}`)
        if (!seq) continue
        const boardIdx = seq.indexOf(boardStopId)
        const alightIdx = seq.indexOf(alightStopId)
        if (boardIdx !== -1 && alightIdx !== -1 && boardIdx < alightIdx) {
          validRoutes.add(candidateRoute)
          const variantHeadsigns = getValidHeadsigns(candidateRoute, boardStopId, alightStopId)
          if (variantHeadsigns) {
            validHeadsignsByRoute.set(candidateRoute, variantHeadsigns)
          }
          break
        }
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
