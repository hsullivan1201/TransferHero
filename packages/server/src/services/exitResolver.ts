import type { Station, StationExit, ResolveResponse } from '@transferhero/shared'
import { ALL_STATIONS } from '../data/stations.js'
import { getAllExits } from './stationService.js'

const EARTH_RADIUS_M = 6371000
const MAX_DISTANCE_M = 1500 // 1.5 km
const GRID_FACTOR = 1.4 // DC street grid adjustment
const WALK_SPEED_MPS = 1.33 // ~3 mph

// O(1) station lookup — built once at module load
const STATION_BY_CODE = new Map<string, Station>(
  ALL_STATIONS.map(s => [s.code, s])
)

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function estimateWalkMinutes(straightLineMeters: number): number {
  return Math.round((straightLineMeters * GRID_FACTOR) / (WALK_SPEED_MPS * 60))
}

interface RankedStation {
  station: Station
  exit: StationExit
  distanceMeters: number
  walkTimeMinutes: number
}

/**
 * Resolve destination coordinates to the best station + exit.
 * Pure math against in-memory exit data — no external API calls.
 */
export function resolveDestination(lat: number, lon: number): ResolveResponse | null {
  const exitCache = getAllExits()
  if (exitCache.size === 0) return null

  // score every exit by distance to target
  const candidates: Array<{ stationCode: string; exit: StationExit; distance: number }> = []

  for (const [stationCode, exits] of exitCache) {
    for (const exit of exits) {
      const distance = haversineMeters(lat, lon, exit.lat, exit.lon)
      if (distance <= MAX_DISTANCE_M) {
        candidates.push({ stationCode, exit, distance })
      }
    }
  }

  if (candidates.length === 0) return null

  // group by station, pick the closest exit per station
  const stationBest = new Map<string, { exit: StationExit; distance: number }>()
  for (const c of candidates) {
    // resolve compound codes like "A01_C01" to their primary code
    const primaryCode = c.stationCode.split('_')[0]
    const existing = stationBest.get(primaryCode)
    if (!existing || c.distance < existing.distance) {
      stationBest.set(primaryCode, { exit: c.exit, distance: c.distance })
    }
  }

  // rank stations by their best exit distance
  const ranked: RankedStation[] = []
  for (const [code, best] of stationBest) {
    const station = STATION_BY_CODE.get(code)
    if (!station) continue
    ranked.push({
      station,
      exit: best.exit,
      distanceMeters: Math.round(best.distance),
      walkTimeMinutes: Math.max(1, estimateWalkMinutes(best.distance)),
    })
  }

  ranked.sort((a, b) => a.distanceMeters - b.distanceMeters)

  const best = ranked[0]
  const alternatives = ranked.slice(1, 3).map(r => ({
    station: r.station,
    exit: r.exit,
    walkTimeMinutes: r.walkTimeMinutes,
    walkDistanceMeters: r.distanceMeters,
  }))

  return {
    station: best.station,
    exit: best.exit,
    walkTimeMinutes: best.walkTimeMinutes,
    walkDistanceMeters: best.distanceMeters,
    alternatives,
  }
}
