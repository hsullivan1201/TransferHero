import fetch from 'node-fetch'
import unzipper from 'unzipper'
import csv from 'csv-parser'
import fs from 'fs'
import { Readable } from 'stream'
import Database from 'better-sqlite3'
import type { BusStop } from '@transferhero/shared'
import { invalidateScheduleIndex } from './busScheduleIndex.js'
import { invalidateHeadsignCache } from './busRouteFinder.js'

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

// In-memory caches (small data — kept in memory)
let busStops = new Map<string, BusStop>()
let busRoutes = new Map<string, BusRoute>()
let routeStopSequences = new Map<string, string[]>()
let stopRoutes = new Map<string, Set<string>>()
let busCalendar = new Map<string, BusCalendarEntry>()
let busCalendarDates = new Map<string, BusCalendarException[]>()

// SQLite database (trips + stop_times — big data)
let db: Database.Database | null = null
const DB_PATH = '/tmp/transferhero-bus-gtfs.db'
const DB_PATH_NEW = '/tmp/transferhero-bus-gtfs.db.new'

let loaded = false
let refreshInterval: ReturnType<typeof setInterval> | null = null

const GTFS_URL = 'https://api.wmata.com/gtfs/bus-gtfs-static.zip'
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const INSERT_BATCH_SIZE = 5000

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
 * Create a new SQLite database with the GTFS schema.
 * Tables are created without indexes; indexes are added after bulk inserts.
 */
function createDatabase(dbPath: string): Database.Database {
  // Remove any existing file at this path
  try { fs.unlinkSync(dbPath); } catch { /* ignore if not exists */ }
  // Also clean up WAL/SHM files from prior runs
  try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }

  const newDb = new Database(dbPath)
  newDb.pragma('journal_mode = WAL')
  newDb.pragma('synchronous = OFF')     // temp DB — rebuilt on restart
  newDb.pragma('cache_size = -8192')     // 8MB cache
  newDb.pragma('mmap_size = 268435456')  // 256MB mmap

  newDb.exec(`
    CREATE TABLE trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL,
      direction_id INTEGER NOT NULL,
      headsign TEXT NOT NULL DEFAULT '',
      service_id TEXT NOT NULL
    );

    CREATE TABLE stop_times (
      trip_id TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      dep_sec INTEGER NOT NULL,
      PRIMARY KEY (trip_id, seq)
    );
  `)

  return newDb
}

/**
 * Add indexes after bulk inserts (faster than indexing during insert)
 */
function createIndexes(targetDb: Database.Database): void {
  targetDb.exec(`
    CREATE INDEX idx_trips_service ON trips(service_id);
    CREATE INDEX idx_trips_route_dir ON trips(route_id, direction_id);
    CREATE INDEX idx_st_stop_dep ON stop_times(stop_id, dep_sec, trip_id);
    CREATE INDEX idx_st_trip_stop ON stop_times(trip_id, stop_id, dep_sec);
  `)
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

  // Parse trips.txt into a temporary Map (needed for calendar lookup + SQLite insert)
  const parsedTrips = new Map<string, BusTrip>()
  if (files.has('trips.txt')) {
    const rows = await parseCsv<{ trip_id: string; route_id: string; direction_id: string; trip_headsign: string; service_id: string }>(files.get('trips.txt')!)
    for (const row of rows) {
      parsedTrips.set(row.trip_id, {
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

  // --- SQLite: create temp DB and insert trips + stop_times ---
  console.log('[BusGTFS] Creating SQLite database...')
  const newDb = createDatabase(DB_PATH_NEW)

  // Insert all trips in a single transaction
  const insertTrip = newDb.prepare(
    'INSERT INTO trips (trip_id, route_id, direction_id, headsign, service_id) VALUES (?, ?, ?, ?, ?)'
  )
  const insertTrips = newDb.transaction((trips: Map<string, BusTrip>) => {
    for (const [tripId, trip] of trips) {
      insertTrip.run(tripId, trip.routeId, trip.directionId, trip.headsign, trip.serviceId)
    }
  })
  insertTrips(parsedTrips)
  console.log(`[BusGTFS] Inserted ${parsedTrips.size} trips into SQLite`)

  // Stream stop_times.txt into SQLite in batches
  let stopTimeCount = 0
  if (stopTimesFile) {
    const insertStopTime = newDb.prepare(
      'INSERT INTO stop_times (trip_id, stop_id, seq, dep_sec) VALUES (?, ?, ?, ?)'
    )
    const insertBatch = newDb.transaction((batch: [string, string, number, number][]) => {
      for (const row of batch) {
        insertStopTime.run(row[0], row[1], row[2], row[3])
      }
    })

    let batch: [string, string, number, number][] = []

    await new Promise<void>((resolve, reject) => {
      stopTimesFile.stream()
        .pipe(csv())
        .on('data', (row: StopTimeRow) => {
          const seq = parseInt(row.stop_sequence)
          if (isNaN(seq)) return
          const depSec = parseTimeToSeconds(row.departure_time)
          if (depSec < 0) return
          batch.push([row.trip_id, row.stop_id, seq, depSec])
          stopTimeCount++
          if (batch.length >= INSERT_BATCH_SIZE) {
            insertBatch(batch)
            batch = []
          }
        })
        .on('end', () => {
          if (batch.length > 0) insertBatch(batch)
          resolve()
        })
        .on('error', reject)
    })
  }
  console.log(`[BusGTFS] Inserted ${stopTimeCount} stop_times into SQLite`)

  // Create indexes after bulk insert
  console.log('[BusGTFS] Creating indexes...')
  createIndexes(newDb)

  // Build routeStopSequences + stopRoutes from SQLite
  // Use the longest trip per route+direction as the representative sequence
  const newRouteStopSequences = new Map<string, string[]>()
  const newStopRoutes = new Map<string, Set<string>>()

  const longestTrips = newDb.prepare(`
    SELECT t.route_id, t.direction_id, st.trip_id, COUNT(*) as cnt
    FROM stop_times st JOIN trips t ON st.trip_id = t.trip_id
    GROUP BY st.trip_id
    ORDER BY t.route_id, t.direction_id, cnt DESC
  `).all() as { route_id: string; direction_id: number; trip_id: string; cnt: number }[]

  const seenKeys = new Set<string>()
  const getStopSeq = newDb.prepare(
    'SELECT stop_id FROM stop_times WHERE trip_id = ? ORDER BY seq'
  )
  for (const row of longestTrips) {
    const key = `${row.route_id}_${row.direction_id}`
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const stops = (getStopSeq.all(row.trip_id) as { stop_id: string }[]).map(r => r.stop_id)
    newRouteStopSequences.set(key, stops)
  }

  // Build stop→routes reverse index
  const stopRouteRows = newDb.prepare(`
    SELECT DISTINCT st.stop_id, t.route_id
    FROM stop_times st JOIN trips t ON st.trip_id = t.trip_id
  `).all() as { stop_id: string; route_id: string }[]

  for (const row of stopRouteRows) {
    let routes = newStopRoutes.get(row.stop_id)
    if (!routes) {
      routes = new Set()
      newStopRoutes.set(row.stop_id, routes)
    }
    routes.add(row.route_id)
  }

  // Atomic swap: assign new DB, close old
  const oldDb = db
  db = newDb
  if (oldDb) {
    try { oldDb.close(); } catch { /* ignore */ }
  }
  // Rename temp DB files over live path
  // Since we already assigned the new handle, the live path is just for cleanup on next run
  try {
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH)
    }
    fs.renameSync(DB_PATH_NEW, DB_PATH)
    // Move WAL/SHM too if they exist
    try { if (fs.existsSync(DB_PATH_NEW + '-wal')) fs.renameSync(DB_PATH_NEW + '-wal', DB_PATH + '-wal'); } catch { /* ignore */ }
    try { if (fs.existsSync(DB_PATH_NEW + '-shm')) fs.renameSync(DB_PATH_NEW + '-shm', DB_PATH + '-shm'); } catch { /* ignore */ }
  } catch {
    // Non-fatal — DB handle is already pointing to the right file
  }

  // Swap in-memory caches
  busStops = newStops
  busRoutes = newRoutes
  routeStopSequences = newRouteStopSequences
  stopRoutes = newStopRoutes
  busCalendar = newCalendar
  busCalendarDates = newCalendarDates
  loaded = true

  // Invalidate caches that depend on the old data
  invalidateScheduleIndex()
  invalidateHeadsignCache()

  console.log(`[BusGTFS] Loaded: ${newStops.size} stops, ${newRoutes.size} routes, ${parsedTrips.size} trips (SQLite), ${newRouteStopSequences.size} route sequences, ${newCalendar.size} calendar entries, ${stopTimeCount} stop_times (SQLite)`)
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
export function getRouteStopSequences(): Map<string, string[]> { return routeStopSequences }
export function getStopRoutes(): Map<string, Set<string>> { return stopRoutes }
export function getBusCalendar(): Map<string, BusCalendarEntry> { return busCalendar }
export function getBusCalendarDates(): Map<string, BusCalendarException[]> { return busCalendarDates }
export function getBusDb(): Database.Database | null { return db }
