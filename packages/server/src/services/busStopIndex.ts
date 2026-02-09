import type { BusStop } from '@transferhero/shared'
import { getBusStops } from './busGtfsLoader.js'
import { getAllExits } from './stationService.js'

const EARTH_RADIUS_M = 6371000
const CELL_SIZE_DEG = 0.0045 // ~500m grid cells
const STATION_BUS_RADIUS_M = 400

/**
 * Haversine distance in meters between two lat/lon points.
 * Shared with exitResolver.ts — same formula.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Grid-based spatial index
const grid = new Map<string, BusStop[]>()

function cellKey(lat: number, lon: number): string {
  const row = Math.floor(lat / CELL_SIZE_DEG)
  const col = Math.floor(lon / CELL_SIZE_DEG)
  return `${row}_${col}`
}

/**
 * Build the spatial grid from loaded bus stops
 */
export function buildSpatialIndex(): void {
  grid.clear()
  const stops = getBusStops()

  for (const stop of stops.values()) {
    const key = cellKey(stop.lat, stop.lon)
    const cell = grid.get(key)
    if (cell) {
      cell.push(stop)
    } else {
      grid.set(key, [stop])
    }
  }

  console.log(`[BusIndex] Spatial grid built: ${grid.size} cells for ${stops.size} stops`)
}

/**
 * Find bus stops within radiusMeters of a lat/lon point.
 * Checks cell + 8 neighbors, filters by Haversine.
 * Typical query: <5ms for 400m radius.
 */
export function queryNearbyStops(lat: number, lon: number, radiusMeters: number): BusStop[] {
  const results: BusStop[] = []
  const centerRow = Math.floor(lat / CELL_SIZE_DEG)
  const centerCol = Math.floor(lon / CELL_SIZE_DEG)

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const key = `${centerRow + dr}_${centerCol + dc}`
      const cell = grid.get(key)
      if (!cell) continue
      for (const stop of cell) {
        if (haversineMeters(lat, lon, stop.lat, stop.lon) <= radiusMeters) {
          results.push(stop)
        }
      }
    }
  }

  return results
}

// Station ↔ Bus Stop proximity maps
let stationBusStops = new Map<string, BusStop[]>()
let busStopStations = new Map<string, { stationCode: string; walkMeters: number; exitName: string }[]>()

/**
 * Pre-compute which bus stops are near which Metro stations.
 * Call after both station exits and bus stops are loaded.
 *
 * For each station+stop pair, keeps the CLOSEST exit (shortest walk).
 * Also stores the exit name so the client can highlight the right car.
 */
export function buildStationProximity(): void {
  const newStationBusStops = new Map<string, BusStop[]>()
  // Temporary: track best (shortest walk) exit per stop+station
  const bestEntry = new Map<string, { stationCode: string; walkMeters: number; exitName: string }>()

  const exitCache = getAllExits()

  for (const [stationCode, exits] of exitCache) {
    const primaryCode = stationCode.split('_')[0]
    const seenStops = new Set<string>()

    for (const exit of exits) {
      const stops = queryNearbyStops(exit.lat, exit.lon, STATION_BUS_RADIUS_M)
      for (const stop of stops) {
        // Add to station→stops map (dedup per station)
        if (!seenStops.has(stop.stopId)) {
          seenStops.add(stop.stopId)
          const existing = newStationBusStops.get(primaryCode)
          if (existing) {
            existing.push(stop)
          } else {
            newStationBusStops.set(primaryCode, [stop])
          }
        }

        // Track best (shortest walk) exit per stop+station pair
        const walkMeters = Math.round(haversineMeters(exit.lat, exit.lon, stop.lat, stop.lon))
        const pairKey = `${stop.stopId}_${primaryCode}`
        const prev = bestEntry.get(pairKey)
        if (!prev || walkMeters < prev.walkMeters) {
          bestEntry.set(pairKey, { stationCode: primaryCode, walkMeters, exitName: exit.name })
        }
      }
    }
  }

  // Build the stop→stations reverse map from the best-exit entries
  const newBusStopStations = new Map<string, { stationCode: string; walkMeters: number; exitName: string }[]>()
  for (const [pairKey, entry] of bestEntry) {
    const stopId = pairKey.split('_')[0]
    const list = newBusStopStations.get(stopId)
    if (list) {
      list.push(entry)
    } else {
      newBusStopStations.set(stopId, [entry])
    }
  }

  // Atomic swap
  stationBusStops = newStationBusStops
  busStopStations = newBusStopStations

  console.log(`[BusIndex] Station proximity: ${newStationBusStops.size} stations linked to bus stops, ${newBusStopStations.size} bus stops linked to stations`)
}

// Accessors
export function getStationBusStops(): Map<string, BusStop[]> { return stationBusStops }
export function getBusStopStations(): Map<string, { stationCode: string; walkMeters: number; exitName: string }[]> { return busStopStations }
