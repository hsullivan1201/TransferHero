import fetch from 'node-fetch'
import unzipper from 'unzipper'
import csv from 'csv-parser'
import fs from 'fs'
import { Readable } from 'stream'
import Database from 'better-sqlite3'
import type { BusStop, BusAgencyId } from '@transferhero/shared'
import { invalidateScheduleIndex } from './busScheduleIndex.js'
import { invalidateHeadsignCache } from './busRouteFinder.js'

// Parsed GTFS data structures
export interface BusRoute {
  routeId: string
  shortName: string
  longName: string
  agencyId: BusAgencyId
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

// --- Multi-agency feed configuration ---

export interface AgencyFeedConfig {
  agencyId: BusAgencyId
  displayName: string
  gtfsUrl: string
  headers?: Record<string, string>
  gtfsRtTripUpdatesUrl?: string
}

function getFeeds(): AgencyFeedConfig[] {
  const feeds: AgencyFeedConfig[] = []

  // WMATA Metrobus — requires API key
  const wmataKey = process.env.WMATA_API_KEY
  if (wmataKey) {
    feeds.push({
      agencyId: 'wmata',
      displayName: 'Metrobus',
      gtfsUrl: 'https://api.wmata.com/gtfs/bus-gtfs-static.zip',
      headers: { 'api_key': wmataKey },
      gtfsRtTripUpdatesUrl: 'https://api.wmata.com/gtfs/bus-gtfsrt-tripupdates.pb',
    })
  } else {
    console.warn('[BusGTFS] WMATA_API_KEY not set — Metrobus disabled')
  }

  // ART (Arlington Transit) — open GTFS, no auth required
  feeds.push({
    agencyId: 'art',
    displayName: 'ART',
    gtfsUrl: 'https://www.arlingtontransit.com/shared/content/gtfs/art/google_transit.zip',
    gtfsRtTripUpdatesUrl: 'https://realtime.arlingtontransit.com/gtfsrt/trips',
  })

  // Fairfax Connector — open GTFS, no auth required
  feeds.push({
    agencyId: 'fairfax',
    displayName: 'Fairfax Connector',
    gtfsUrl: 'https://www.fairfaxcounty.gov/connector/sites/connector/files/assets/connector_gtfs.zip',
    gtfsRtTripUpdatesUrl: 'https://www.fairfaxcounty.gov/gtfsrt/trips',
  })

  return feeds
}

// --- ID namespacing helpers ---

/** Prefix an ID with the agency namespace */
function prefixId(agencyId: BusAgencyId, id: string): string {
  return `${agencyId}:${id}`
}

/** Strip the agency prefix from a namespaced ID */
export function stripAgencyPrefix(id: string): string {
  const colonIdx = id.indexOf(':')
  return colonIdx >= 0 ? id.slice(colonIdx + 1) : id
}

/** Extract the agency ID from a namespaced ID */
export function getAgencyFromId(id: string): BusAgencyId | null {
  const colonIdx = id.indexOf(':')
  if (colonIdx < 0) return null
  return id.slice(0, colonIdx) as BusAgencyId
}

/** Get the feed configs (for use by predictions layer) */
export function getFeedConfigs(): AgencyFeedConfig[] {
  return getFeeds()
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

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const INSERT_BATCH_SIZE = 5000

/**
 * Get current date in Eastern Time as a Date object.
 * GTFS feeds in this region use ET for all schedule data.
 */
function getEasternDate(): Date {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value)
  return new Date(get('year'), get('month') - 1, get('day'))
}

/**
 * Compute active service IDs for a date, using the provided calendar data.
 * (Can't use the module-level caches because they haven't been swapped yet during parsing.)
 */
function computeActiveServicesForDate(
  date: Date,
  calendar: Map<string, BusCalendarEntry>,
  calendarDates: Map<string, BusCalendarException[]>,
): Set<string> {
  const dateNum = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
  const jsDay = date.getDay()
  const dayIdx = jsDay === 0 ? 6 : jsDay - 1 // Mon=0..Sun=6

  const active = new Set<string>()
  for (const [serviceId, entry] of calendar) {
    if (dateNum >= entry.startDate && dateNum <= entry.endDate && entry.days[dayIdx]) {
      active.add(serviceId)
    }
  }
  for (const [serviceId, exceptions] of calendarDates) {
    for (const ex of exceptions) {
      if (ex.date === dateNum) {
        if (ex.added) active.add(serviceId)
        else active.delete(serviceId)
      }
    }
  }
  return active
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
  newDb.pragma('cache_size = -2048')     // 2MB cache (runtime queries are small)
  newDb.pragma('mmap_size = 0')           // disable mmap — avoid RSS bloat

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

/** Result of parsing a single agency feed */
interface FeedParseResult {
  agencyId: BusAgencyId
  stops: Map<string, BusStop>
  routes: Map<string, BusRoute>
  filteredTrips: Map<string, BusTrip>
  activeTripIds: Set<string>
  calendar: Map<string, BusCalendarEntry>
  calendarDates: Map<string, BusCalendarException[]>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stopTimesFile: any
  tripCount: number
}

/**
 * Download and parse a single agency GTFS feed.
 * All IDs are namespaced with `{agencyId}:` prefix to prevent cross-agency collisions.
 */
async function downloadAndParseFeed(feed: AgencyFeedConfig): Promise<FeedParseResult> {
  const { agencyId } = feed
  const prefix = (id: string) => prefixId(agencyId, id)

  console.log(`[BusGTFS:${agencyId}] Downloading GTFS feed...`)
  const response = await fetch(feed.gtfsUrl, {
    headers: feed.headers || {}
  })

  if (!response.ok) {
    throw new Error(`GTFS download failed for ${agencyId}: ${response.status}`)
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

  // Parse stops.txt — namespace stopId, keep stopCode un-prefixed
  const newStops = new Map<string, BusStop>()
  if (files.has('stops.txt')) {
    const rows = await parseCsv<{ stop_id: string; stop_code: string; stop_name: string; stop_lat: string; stop_lon: string; location_type?: string }>(files.get('stops.txt')!)
    for (const row of rows) {
      const locType = row.location_type || '0'
      if (locType !== '0' && locType !== '') continue
      const lat = parseFloat(row.stop_lat)
      const lon = parseFloat(row.stop_lon)
      if (isNaN(lat) || isNaN(lon)) continue
      const namespacedId = prefix(row.stop_id)
      newStops.set(namespacedId, {
        stopId: namespacedId,
        stopCode: row.stop_code || row.stop_id,
        name: row.stop_name,
        lat,
        lon,
        agencyId,
      })
    }
  }

  // Parse routes.txt — namespace routeId
  const newRoutes = new Map<string, BusRoute>()
  if (files.has('routes.txt')) {
    const rows = await parseCsv<{ route_id: string; route_short_name: string; route_long_name: string }>(files.get('routes.txt')!)
    for (const row of rows) {
      const namespacedId = prefix(row.route_id)
      newRoutes.set(namespacedId, {
        routeId: namespacedId,
        shortName: row.route_short_name || row.route_id,
        longName: row.route_long_name || '',
        agencyId,
      })
    }
  }

  // Parse trips.txt — namespace tripId, routeId, serviceId
  const parsedTrips = new Map<string, BusTrip>()
  if (files.has('trips.txt')) {
    const rows = await parseCsv<{ trip_id: string; route_id: string; direction_id: string; trip_headsign: string; service_id: string }>(files.get('trips.txt')!)
    for (const row of rows) {
      parsedTrips.set(prefix(row.trip_id), {
        routeId: prefix(row.route_id),
        directionId: parseInt(row.direction_id) || 0,
        headsign: row.trip_headsign || '',
        serviceId: prefix(row.service_id),
      })
    }
  }

  // Parse calendar.txt — namespace serviceId
  const newCalendar = new Map<string, BusCalendarEntry>()
  if (files.has('calendar.txt')) {
    const rows = await parseCsv<{
      service_id: string; monday: string; tuesday: string; wednesday: string;
      thursday: string; friday: string; saturday: string; sunday: string;
      start_date: string; end_date: string
    }>(files.get('calendar.txt')!)
    for (const row of rows) {
      newCalendar.set(prefix(row.service_id), {
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

  // Parse calendar_dates.txt — namespace serviceId
  const newCalendarDates = new Map<string, BusCalendarException[]>()
  if (files.has('calendar_dates.txt')) {
    const rows = await parseCsv<{ service_id: string; date: string; exception_type: string }>(files.get('calendar_dates.txt')!)
    for (const row of rows) {
      const exception: BusCalendarException = {
        date: parseInt(row.date) || 0,
        added: row.exception_type === '1',
      }
      const nsServiceId = prefix(row.service_id)
      const existing = newCalendarDates.get(nsServiceId)
      if (existing) {
        existing.push(exception)
      } else {
        newCalendarDates.set(nsServiceId, [exception])
      }
    }
  }

  // Free zip buffer + extracted file buffers — no longer needed
  files.clear()

  // Compute active services for today + tomorrow (for late-night lookups)
  const today = getEasternDate()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const activeServices = computeActiveServicesForDate(today, newCalendar, newCalendarDates)
  const tomorrowServices = computeActiveServicesForDate(tomorrow, newCalendar, newCalendarDates)
  for (const s of tomorrowServices) activeServices.add(s)
  console.log(`[BusGTFS:${agencyId}] Active services (today+tomorrow): ${activeServices.size}`)

  // Filter trips to active services only
  const activeTripIds = new Set<string>()
  const filteredTrips = new Map<string, BusTrip>()
  for (const [tripId, trip] of parsedTrips) {
    if (activeServices.has(trip.serviceId)) {
      filteredTrips.set(tripId, trip)
      activeTripIds.add(tripId)
    }
  }
  console.log(`[BusGTFS:${agencyId}] Filtered trips: ${filteredTrips.size} of ${parsedTrips.size}`)
  parsedTrips.clear()

  return {
    agencyId,
    stops: newStops,
    routes: newRoutes,
    filteredTrips,
    activeTripIds,
    calendar: newCalendar,
    calendarDates: newCalendarDates,
    stopTimesFile,
    tripCount: filteredTrips.size,
  }
}

/**
 * Insert a parsed feed's trips and stop_times into the shared SQLite database.
 * stop_id in stop_times is namespaced with the agency prefix.
 */
async function insertFeedIntoDb(
  newDb: Database.Database,
  result: FeedParseResult,
): Promise<{ tripCount: number; stopTimeCount: number }> {
  const { agencyId, filteredTrips, activeTripIds, stopTimesFile } = result
  const prefix = (id: string) => prefixId(agencyId, id)

  // Insert filtered trips
  const insertTrip = newDb.prepare(
    'INSERT INTO trips (trip_id, route_id, direction_id, headsign, service_id) VALUES (?, ?, ?, ?, ?)'
  )
  const tripCount = filteredTrips.size
  const insertTrips = newDb.transaction((trips: Map<string, BusTrip>) => {
    for (const [tripId, trip] of trips) {
      insertTrip.run(tripId, trip.routeId, trip.directionId, trip.headsign, trip.serviceId)
    }
  })
  insertTrips(filteredTrips)
  filteredTrips.clear()

  // Stream stop_times.txt into SQLite — only for active trips, namespace IDs
  let stopTimeCount = 0
  let skippedStopTimes = 0

  // Build a set of raw (un-prefixed) active trip IDs for matching against CSV rows
  const rawActiveTripIds = new Set<string>()
  for (const id of activeTripIds) {
    rawActiveTripIds.add(stripAgencyPrefix(id))
  }

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
          if (!rawActiveTripIds.has(row.trip_id)) { skippedStopTimes++; return }
          const seq = parseInt(row.stop_sequence)
          if (isNaN(seq)) return
          const depSec = parseTimeToSeconds(row.departure_time)
          if (depSec < 0) return
          batch.push([prefix(row.trip_id), prefix(row.stop_id), seq, depSec])
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

  activeTripIds.clear()
  rawActiveTripIds.clear()
  console.log(`[BusGTFS:${agencyId}] Inserted ${tripCount} trips, ${stopTimeCount} stop_times (skipped ${skippedStopTimes})`)

  return { tripCount, stopTimeCount }
}

/**
 * Download all agency feeds, merge into a single DB, and swap caches.
 */
async function downloadAndParseAll(): Promise<void> {
  const feeds = getFeeds()
  if (feeds.length === 0) {
    console.warn('[BusGTFS] No feeds configured — bus features disabled')
    return
  }

  // Download and parse each feed independently (error isolation)
  const results: FeedParseResult[] = []
  for (const feed of feeds) {
    try {
      const result = await downloadAndParseFeed(feed)
      results.push(result)
    } catch (err) {
      console.error(`[BusGTFS:${feed.agencyId}] Feed failed — skipping:`, err)
    }
  }

  if (results.length === 0) {
    console.warn('[BusGTFS] All feeds failed — bus features disabled')
    return
  }

  // --- Merge all feed data into unified caches ---
  const mergedStops = new Map<string, BusStop>()
  const mergedRoutes = new Map<string, BusRoute>()
  const mergedCalendar = new Map<string, BusCalendarEntry>()
  const mergedCalendarDates = new Map<string, BusCalendarException[]>()

  for (const result of results) {
    for (const [k, v] of result.stops) mergedStops.set(k, v)
    for (const [k, v] of result.routes) mergedRoutes.set(k, v)
    for (const [k, v] of result.calendar) mergedCalendar.set(k, v)
    for (const [k, v] of result.calendarDates) mergedCalendarDates.set(k, v)
  }

  // --- SQLite: create temp DB and insert all feeds ---
  console.log('[BusGTFS] Creating merged SQLite database...')
  const newDb = createDatabase(DB_PATH_NEW)

  let totalTrips = 0
  let totalStopTimes = 0
  for (const result of results) {
    const { tripCount, stopTimeCount } = await insertFeedIntoDb(newDb, result)
    totalTrips += tripCount
    totalStopTimes += stopTimeCount
  }

  // Create indexes after all bulk inserts
  console.log('[BusGTFS] Creating indexes...')
  createIndexes(newDb)

  // Build routeStopSequences + stopRoutes from SQLite
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

  // Checkpoint WAL into main DB file and release cached pages
  newDb.pragma('wal_checkpoint(TRUNCATE)')
  newDb.pragma('shrink_memory')

  // Atomic swap: assign new DB, close old
  const oldDb = db
  db = newDb
  if (oldDb) {
    try { oldDb.close(); } catch { /* ignore */ }
  }
  try {
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH)
    }
    fs.renameSync(DB_PATH_NEW, DB_PATH)
    try { if (fs.existsSync(DB_PATH_NEW + '-wal')) fs.renameSync(DB_PATH_NEW + '-wal', DB_PATH + '-wal'); } catch { /* ignore */ }
    try { if (fs.existsSync(DB_PATH_NEW + '-shm')) fs.renameSync(DB_PATH_NEW + '-shm', DB_PATH + '-shm'); } catch { /* ignore */ }
  } catch {
    // Non-fatal — DB handle is already pointing to the right file
  }

  // Swap in-memory caches
  busStops = mergedStops
  busRoutes = mergedRoutes
  routeStopSequences = newRouteStopSequences
  stopRoutes = newStopRoutes
  busCalendar = mergedCalendar
  busCalendarDates = mergedCalendarDates
  loaded = true

  // Invalidate caches that depend on the old data
  invalidateScheduleIndex()
  invalidateHeadsignCache()

  const agencyNames = results.map(r => r.agencyId).join(', ')
  console.log(`[BusGTFS] Loaded [${agencyNames}]: ${mergedStops.size} stops, ${mergedRoutes.size} routes, ${totalTrips} trips, ${newRouteStopSequences.size} route sequences, ${totalStopTimes} stop_times`)
}

/**
 * Load bus GTFS data at server startup. Graceful degradation on failure.
 */
export async function loadBusGtfs(): Promise<void> {
  try {
    await downloadAndParseAll()

    // Schedule 24h refresh
    if (refreshInterval) clearInterval(refreshInterval)
    refreshInterval = setInterval(async () => {
      try {
        await downloadAndParseAll()
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
