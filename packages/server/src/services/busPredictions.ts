import fetch from 'node-fetch'
import type { BusPrediction } from '@transferhero/shared'
import { getRouteStopSequences } from './busGtfsLoader.js'

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
 * Filter predictions to routes that serve both the board and alight stops.
 * Exact route ID match first, then checks GTFS sequences for variant routes
 * (e.g. D5X is a variant of D50 — both serve the same stops on that segment).
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

  if (alightStopId && boardStopId) {
    const sequences = getRouteStopSequences()
    const otherRouteIds = new Set(predictions.map(p => p.routeId).filter(r => r !== routeId))

    for (const candidateRoute of otherRouteIds) {
      // Check both directions
      for (const dir of [0, 1]) {
        const seq = sequences.get(`${candidateRoute}_${dir}`)
        if (!seq) continue
        const boardIdx = seq.indexOf(boardStopId)
        const alightIdx = seq.indexOf(alightStopId)
        // Both stops must be on the route, in the correct order
        if (boardIdx !== -1 && alightIdx !== -1 && boardIdx < alightIdx) {
          validRoutes.add(candidateRoute)
          break
        }
      }
    }
  }

  const filtered = predictions
    .filter(p => validRoutes.has(p.routeId))
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, limit)

  if (filtered.length === 0 && predictions.length > 0) {
    console.log(`[BusPredictions] No match for route "${routeId}" (+ variants). Available: ${[...new Set(predictions.map(p => p.routeId))].join(', ')}`)
  } else if (validRoutes.size > 1) {
    console.log(`[BusPredictions] Route "${routeId}" + variants [${[...validRoutes].join(', ')}]: ${filtered.length} predictions`)
  }

  return filtered
}
