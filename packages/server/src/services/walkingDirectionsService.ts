// Google Directions API — walking mode
// Follows the same patterns as geocodingService.ts: lazy API key, LRU cache, graceful fallback
import { fetchWithTimeout } from '../utils/http.js'
import { routedWalkMinutes } from './walkingTime.js'

export interface WalkingDirectionsResult {
  walkTimeMinutes: number
  walkDistanceMeters: number
}

export interface GoogleWalkingLeg {
  distance: { value: number }
  duration?: { value: number }
}

export function walkingDirectionsResultFromLeg(leg: GoogleWalkingLeg): WalkingDirectionsResult {
  const walkDistanceMeters = leg.distance.value
  return {
    walkTimeMinutes: routedWalkMinutes(walkDistanceMeters),
    walkDistanceMeters,
  }
}

interface CacheEntry {
  result: WalkingDirectionsResult
  ts: number
}

function getApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY || ''
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 3_600_000 // 1 hour — walking routes between fixed points are stable
const CACHE_MAX_SIZE = 1000
const DIRECTIONS_TIMEOUT_MS = 6_000

function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

function makeCacheKey(
  originLat: number, originLon: number,
  destLat: number, destLon: number
): string {
  return `${roundCoord(originLat)},${roundCoord(originLon)}|${roundCoord(destLat)},${roundCoord(destLon)}`
}

// Periodic stale-entry cleanup instead of per-write iteration
const directionsCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_TTL_MS) cache.delete(key)
  }
}, 60_000)
directionsCleanupTimer.unref?.()

function evictIfOverCapacity() {
  if (cache.size > CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

export function isDirectionsEnabled(): boolean {
  return getApiKey().length > 0
}

export async function getWalkingDirections(
  originLat: number, originLon: number,
  destLat: number, destLon: number
): Promise<WalkingDirectionsResult | null> {
  if (!isDirectionsEnabled()) return null

  const key = makeCacheKey(originLat, originLon, destLat, destLon)
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result
  }

  try {
    const params = new URLSearchParams({
      origin: `${originLat},${originLon}`,
      destination: `${destLat},${destLon}`,
      mode: 'walking',
      key: getApiKey(),
    })

    const response = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/directions/json?${params}`,
      { timeoutMs: DIRECTIONS_TIMEOUT_MS }
    )

    if (!response.ok) {
      console.error(`[Directions] Google returned ${response.status}`)
      return null
    }

    const data: any = await response.json()

    if (data.status !== 'OK' || !data.routes?.length) {
      console.error(`[Directions] status=${data.status}`)
      return null
    }

    const leg = data.routes[0].legs[0] as GoogleWalkingLeg
    const result = walkingDirectionsResultFromLeg(leg)

    evictIfOverCapacity()
    cache.set(key, { result, ts: Date.now() })

    return result
  } catch (err) {
    console.error('[Directions] walking directions failed:', err)
    return null
  }
}
