import fetch from 'node-fetch'
import unzipper from 'unzipper'
import csv from 'csv-parser'
import { Readable } from 'stream'
import type { BusStop } from '@transferhero/shared'

// Parsed GTFS data structures
export interface BusRoute {
  routeId: string
  shortName: string
  longName: string
}

export interface BusTrip {
  routeId: string
  directionId: number
  headsign: string
}

interface StopTimeRow {
  trip_id: string
  stop_id: string
  stop_sequence: string
}

// In-memory caches
let busStops = new Map<string, BusStop>()
let busRoutes = new Map<string, BusRoute>()
let busTrips = new Map<string, BusTrip>()
let routeStopSequences = new Map<string, string[]>()
let stopRoutes = new Map<string, Set<string>>()

let loaded = false
let refreshInterval: ReturnType<typeof setInterval> | null = null

const GTFS_URL = 'https://api.wmata.com/gtfs/bus-gtfs-static.zip'
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

function getApiKey(): string {
  const key = process.env.WMATA_API_KEY
  if (!key) throw new Error('WMATA_API_KEY not set')
  return key
}

/**
 * Parse a CSV file from a buffer into rows
 */
function parseCsv<T>(buffer: Buffer): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const rows: T[] = []
    const stream = Readable.from(buffer)
    stream
      .pipe(csv())
      .on('data', (row: T) => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject)
  })
}

/**
 * Download and parse WMATA bus GTFS feed
 */
async function downloadAndParse(): Promise<void> {
  const apiKey = getApiKey()
  console.log('[BusGTFS] Downloading bus GTFS feed...')

  const response = await fetch(GTFS_URL, {
    headers: { 'api_key': apiKey }
  })

  if (!response.ok) {
    throw new Error(`GTFS download failed: ${response.status}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Extract needed files from ZIP
  const files = new Map<string, Buffer>()
  const needed = new Set(['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'])

  const directory = await unzipper.Open.buffer(buffer)
  for (const file of directory.files) {
    const name = file.path.split('/').pop() || file.path
    if (needed.has(name)) {
      files.set(name, await file.buffer())
    }
  }

  // Parse stops.txt
  const newStops = new Map<string, BusStop>()
  if (files.has('stops.txt')) {
    const rows = await parseCsv<{ stop_id: string; stop_code: string; stop_name: string; stop_lat: string; stop_lon: string; location_type?: string }>(files.get('stops.txt')!)
    for (const row of rows) {
      // location_type 0 or empty = stop/platform (not station parent)
      const locType = row.location_type || '0'
      if (locType !== '0' && locType !== '') continue
      const lat = parseFloat(row.stop_lat)
      const lon = parseFloat(row.stop_lon)
      if (isNaN(lat) || isNaN(lon)) continue
      newStops.set(row.stop_id, {
        stopId: row.stop_id,
        stopCode: row.stop_code || row.stop_id,
        name: row.stop_name,
        lat,
        lon,
      })
    }
  }

  // Parse routes.txt
  const newRoutes = new Map<string, BusRoute>()
  if (files.has('routes.txt')) {
    const rows = await parseCsv<{ route_id: string; route_short_name: string; route_long_name: string }>(files.get('routes.txt')!)
    for (const row of rows) {
      newRoutes.set(row.route_id, {
        routeId: row.route_id,
        shortName: row.route_short_name || row.route_id,
        longName: row.route_long_name || '',
      })
    }
  }

  // Parse trips.txt
  const newTrips = new Map<string, BusTrip>()
  if (files.has('trips.txt')) {
    const rows = await parseCsv<{ trip_id: string; route_id: string; direction_id: string; trip_headsign: string }>(files.get('trips.txt')!)
    for (const row of rows) {
      newTrips.set(row.trip_id, {
        routeId: row.route_id,
        directionId: parseInt(row.direction_id) || 0,
        headsign: row.trip_headsign || '',
      })
    }
  }

  // Parse stop_times.txt → build route stop sequences + stop→routes index
  const newRouteStopSequences = new Map<string, string[]>()
  const newStopRoutes = new Map<string, Set<string>>()

  if (files.has('stop_times.txt')) {
    // Collect stop times grouped by trip
    const tripStopTimes = new Map<string, { stopId: string; seq: number }[]>()

    const rows = await parseCsv<StopTimeRow>(files.get('stop_times.txt')!)
    for (const row of rows) {
      const seq = parseInt(row.stop_sequence)
      if (isNaN(seq)) continue
      const existing = tripStopTimes.get(row.trip_id)
      if (existing) {
        existing.push({ stopId: row.stop_id, seq })
      } else {
        tripStopTimes.set(row.trip_id, [{ stopId: row.stop_id, seq }])
      }
    }

    // Build sequences per route+direction (use first trip of each route+direction as representative)
    const seenRouteDir = new Set<string>()
    for (const [tripId, stopTimes] of tripStopTimes) {
      const trip = newTrips.get(tripId)
      if (!trip) continue

      const key = `${trip.routeId}_${trip.directionId}`
      if (seenRouteDir.has(key)) continue
      seenRouteDir.add(key)

      stopTimes.sort((a, b) => a.seq - b.seq)
      const orderedStops = stopTimes.map(st => st.stopId)
      newRouteStopSequences.set(key, orderedStops)

      // Build stop→routes reverse index
      for (const st of stopTimes) {
        let routes = newStopRoutes.get(st.stopId)
        if (!routes) {
          routes = new Set()
          newStopRoutes.set(st.stopId, routes)
        }
        routes.add(trip.routeId)
      }
    }
  }

  // Atomic swap
  busStops = newStops
  busRoutes = newRoutes
  busTrips = newTrips
  routeStopSequences = newRouteStopSequences
  stopRoutes = newStopRoutes
  loaded = true

  console.log(`[BusGTFS] Loaded: ${newStops.size} stops, ${newRoutes.size} routes, ${newTrips.size} trips, ${newRouteStopSequences.size} route sequences`)
}

/**
 * Load bus GTFS data at server startup. Graceful degradation on failure.
 */
export async function loadBusGtfs(): Promise<void> {
  try {
    await downloadAndParse()

    // Schedule 24h refresh
    if (refreshInterval) clearInterval(refreshInterval)
    refreshInterval = setInterval(async () => {
      try {
        await downloadAndParse()
      } catch (err) {
        console.error('[BusGTFS] Refresh failed:', err)
      }
    }, REFRESH_INTERVAL_MS)
  } catch (err) {
    console.warn('[BusGTFS] Initial load failed — bus features disabled:', err)
  }
}

// Accessors
export function isBusDataLoaded(): boolean { return loaded }
export function getBusStops(): Map<string, BusStop> { return busStops }
export function getBusRoutes(): Map<string, BusRoute> { return busRoutes }
export function getBusTrips(): Map<string, BusTrip> { return busTrips }
export function getRouteStopSequences(): Map<string, string[]> { return routeStopSequences }
export function getStopRoutes(): Map<string, Set<string>> { return stopRoutes }
