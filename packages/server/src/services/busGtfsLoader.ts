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
  serviceId: string
}

export interface BusCalendarEntry {
  days: boolean[] // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
  startDate: number // YYYYMMDD
  endDate: number   // YYYYMMDD
}

export interface BusCalendarException {
  date: number    // YYYYMMDD
  added: boolean  // true = added (exception_type 1), false = removed (exception_type 2)
}

export interface StopTimeEntry {
  stopId: string
  seq: number
  depSec: number // seconds since midnight (handles >24:00:00)
}

interface StopTimeRow {
  trip_id: string
  stop_id: string
  stop_sequence: string
  departure_time: string
}

// In-memory caches
let busStops = new Map<string, BusStop>()
let busRoutes = new Map<string, BusRoute>()
let busTrips = new Map<string, BusTrip>()
let routeStopSequences = new Map<string, string[]>()
let stopRoutes = new Map<string, Set<string>>()
let busCalendar = new Map<string, BusCalendarEntry>()
let busCalendarDates = new Map<string, BusCalendarException[]>()
let busTripStopTimes = new Map<string, StopTimeEntry[]>()

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
 * Parse HH:MM:SS (possibly >24:00:00) to seconds since midnight
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':')
  if (parts.length !== 3) return -1
  const h = parseInt(parts[0])
  const m = parseInt(parts[1])
  const s = parseInt(parts[2])
  if (isNaN(h) || isNaN(m) || isNaN(s)) return -1
  return h * 3600 + m * 60 + s
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
  // Small files are buffered; stop_times.txt is streamed later to avoid OOM
  // (stop_times.txt decompresses to ~100MB+ and parsing it into JS objects spikes even higher)
  const files = new Map<string, Buffer>()
  const smallFiles = new Set(['stops.txt', 'routes.txt', 'trips.txt', 'calendar.txt', 'calendar_dates.txt'])

  const directory = await unzipper.Open.buffer(buffer)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stopTimesFile: any = null

  for (const file of directory.files) {
    const name = file.path.split('/').pop() || file.path
    if (smallFiles.has(name)) {
      files.set(name, await file.buffer())
    } else if (name === 'stop_times.txt') {
      stopTimesFile = file
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
    const rows = await parseCsv<{ trip_id: string; route_id: string; direction_id: string; trip_headsign: string; service_id: string }>(files.get('trips.txt')!)
    for (const row of rows) {
      newTrips.set(row.trip_id, {
        routeId: row.route_id,
        directionId: parseInt(row.direction_id) || 0,
        headsign: row.trip_headsign || '',
        serviceId: row.service_id || '',
      })
    }
  }

  // Parse calendar.txt
  const newCalendar = new Map<string, BusCalendarEntry>()
  if (files.has('calendar.txt')) {
    const rows = await parseCsv<{
      service_id: string; monday: string; tuesday: string; wednesday: string;
      thursday: string; friday: string; saturday: string; sunday: string;
      start_date: string; end_date: string
    }>(files.get('calendar.txt')!)
    for (const row of rows) {
      newCalendar.set(row.service_id, {
        days: [
          row.monday === '1',
          row.tuesday === '1',
          row.wednesday === '1',
          row.thursday === '1',
          row.friday === '1',
          row.saturday === '1',
          row.sunday === '1',
        ],
        startDate: parseInt(row.start_date) || 0,
        endDate: parseInt(row.end_date) || 0,
      })
    }
  }

  // Parse calendar_dates.txt
  const newCalendarDates = new Map<string, BusCalendarException[]>()
  if (files.has('calendar_dates.txt')) {
    const rows = await parseCsv<{ service_id: string; date: string; exception_type: string }>(files.get('calendar_dates.txt')!)
    for (const row of rows) {
      const exception: BusCalendarException = {
        date: parseInt(row.date) || 0,
        added: row.exception_type === '1',
      }
      const existing = newCalendarDates.get(row.service_id)
      if (existing) {
        existing.push(exception)
      } else {
        newCalendarDates.set(row.service_id, [exception])
      }
    }
  }

  // Parse stop_times.txt → build route stop sequences + stop→routes index + retain full stop times
  // Streamed directly from zip entry to avoid buffering the huge file in memory
  const newRouteStopSequences = new Map<string, string[]>()
  const newStopRoutes = new Map<string, Set<string>>()
  const newTripStopTimes = new Map<string, StopTimeEntry[]>()

  if (stopTimesFile) {
    // Stream from zip entry through csv-parser directly into the map
    await new Promise<void>((resolve, reject) => {
      stopTimesFile.stream()
        .pipe(csv())
        .on('data', (row: StopTimeRow) => {
          const seq = parseInt(row.stop_sequence)
          if (isNaN(seq)) return
          const depSec = parseTimeToSeconds(row.departure_time)
          const entry: StopTimeEntry = { stopId: row.stop_id, seq, depSec }
          const existing = newTripStopTimes.get(row.trip_id)
          if (existing) {
            existing.push(entry)
          } else {
            newTripStopTimes.set(row.trip_id, [entry])
          }
        })
        .on('end', () => resolve())
        .on('error', reject)
    })

    // Sort each trip's stop times by sequence
    for (const stops of newTripStopTimes.values()) {
      stops.sort((a, b) => a.seq - b.seq)
    }

    // Build sequences per route+direction (use first trip of each route+direction as representative)
    const seenRouteDir = new Set<string>()
    for (const [tripId, stopTimes] of newTripStopTimes) {
      const trip = newTrips.get(tripId)
      if (!trip) continue

      const key = `${trip.routeId}_${trip.directionId}`
      if (seenRouteDir.has(key)) continue
      seenRouteDir.add(key)

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
  busCalendar = newCalendar
  busCalendarDates = newCalendarDates
  busTripStopTimes = newTripStopTimes
  loaded = true

  console.log(`[BusGTFS] Loaded: ${newStops.size} stops, ${newRoutes.size} routes, ${newTrips.size} trips, ${newRouteStopSequences.size} route sequences, ${newCalendar.size} calendar entries, ${newTripStopTimes.size} trip stop times`)
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
export function getBusCalendar(): Map<string, BusCalendarEntry> { return busCalendar }
export function getBusCalendarDates(): Map<string, BusCalendarException[]> { return busCalendarDates }
export function getBusTripStopTimes(): Map<string, StopTimeEntry[]> { return busTripStopTimes }
