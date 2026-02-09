import fetch from 'node-fetch'
import type { BusPrediction } from '@transferhero/shared'

const PREDICTION_TTL = 15_000 // 15 seconds, matches rail prediction TTL

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
    return cached?.data ?? []
  }
}

/**
 * Filter predictions to a specific route
 */
export function filterPredictionsForRoute(
  predictions: BusPrediction[],
  routeId: string,
  limit: number = 3
): BusPrediction[] {
  return predictions
    .filter(p => p.routeId === routeId)
    .sort((a, b) => a.minutes - b.minutes)
    .slice(0, limit)
}
