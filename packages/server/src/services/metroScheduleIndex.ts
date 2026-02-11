import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ROUTE_TO_LINE, normalizeDestination } from '@transferhero/shared'
import type { Line } from '@transferhero/shared'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GTFS_DIR = resolve(__dirname, '../../../../metro-gtfs')

// ── Types ──────────────────────────────────────────────────────────────

interface MetroDeparture {
  depSec: number
  tripId: string
  line: Line
  headsign: string // raw from GTFS, e.g. "GLENMONT"
}

interface MetroScheduleIndex {
  date: string // YYYY-MM-DD, rebuild on day change
  activeServiceIds: Set<string>
  stationDepartures: Map<string, MetroDeparture[]> // stationCode → sorted departures
}

interface MetroTrip {
  serviceId: string
  line: Line
  headsign: string
}

export interface ScheduledMetroTrain {
  depSec: number
  minutesFromNow: number
  tripId: string
  line: Line
  headsign: string
}

// ── State ──────────────────────────────────────────────────────────────

let index: MetroScheduleIndex | null = null
let dataLoaded = false

// ── Timezone helper (copied from busScheduleIndex.ts) ──────────────────

function getEasternTime(): { date: Date; nowSec: number; dateStr: string } {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value)
  const year = get('year')
  const month = get('month')
  const day = get('day')
  const hour = get('hour') % 24
  const minute = get('minute')
  const second = get('second')

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const nowSec = hour * 3600 + minute * 60 + second
  const date = new Date(year, month - 1, day, hour, minute, second)

  return { date, nowSec, dateStr }
}

// ── GTFS file parsers ──────────────────────────────────────────────────

/**
 * Parse calendar_dates.txt → Map<dateNum, Set<serviceId>>
 * Metro GTFS has no calendar.txt; every active service day is an exception_type=1 entry.
 */
function parseCalendarDates(): Map<number, Set<string>> {
  const path = resolve(GTFS_DIR, 'calendar_dates.txt')
  const content = readFileSync(path, 'utf-8')
  const lines = content.split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const serviceIdx = headers.indexOf('service_id')
  const dateIdx = headers.indexOf('date')
  const typeIdx = headers.indexOf('exception_type')

  const dateServices = new Map<number, Set<string>>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',')
    const exType = parseInt(cols[typeIdx])
    if (exType !== 1) continue // only "service added" entries

    const dateNum = parseInt(cols[dateIdx])
    const serviceId = cols[serviceIdx].trim()
    const existing = dateServices.get(dateNum)
    if (existing) {
      existing.add(serviceId)
    } else {
      dateServices.set(dateNum, new Set([serviceId]))
    }
  }

  return dateServices
}

/**
 * Parse trips.txt → Map<tripId, MetroTrip>
 */
function parseTrips(): Map<string, MetroTrip> {
  const path = resolve(GTFS_DIR, 'trips.txt')
  const content = readFileSync(path, 'utf-8')
  const lines = content.split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const routeIdx = headers.indexOf('route_id')
  const serviceIdx = headers.indexOf('service_id')
  const tripIdx = headers.indexOf('trip_id')
  const headsignIdx = headers.indexOf('trip_headsign')

  const trips = new Map<string, MetroTrip>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',')
    const tripId = cols[tripIdx]?.trim()
    const routeId = cols[routeIdx]?.trim()
    const serviceId = cols[serviceIdx]?.trim()
    const headsign = cols[headsignIdx]?.replace(/"/g, '').trim() || 'Unknown'

    if (!tripId || !routeId) continue
    const lineCode = ROUTE_TO_LINE[routeId] || ROUTE_TO_LINE[routeId.toUpperCase()]
    if (!lineCode) continue // skip unknown routes

    trips.set(tripId, { serviceId, line: lineCode, headsign })
  }

  return trips
}

/**
 * Parse stop_times.txt, filtered to active trips only.
 * Returns Map<stationCode, MetroDeparture[]> (unsorted).
 */
function parseStopTimes(
  activeTrips: Map<string, MetroTrip>
): Map<string, MetroDeparture[]> {
  const path = resolve(GTFS_DIR, 'stop_times.txt')
  const content = readFileSync(path, 'utf-8')
  const lines = content.split('\n')
  const headers = lines[0].split(',').map(h => h.trim())
  const tripIdx = headers.indexOf('trip_id')
  const depIdx = headers.indexOf('departure_time')
  const stopIdx = headers.indexOf('stop_id')

  const stationDeps = new Map<string, MetroDeparture[]>()

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',')
    const tripId = cols[tripIdx]?.trim()

    const trip = tripId ? activeTrips.get(tripId) : undefined
    if (!trip) continue // skip inactive trips early

    const stopId = cols[stopIdx]?.trim()
    if (!stopId || !stopId.startsWith('PF_')) continue

    // PF_B09_C → B09, PF_K06_1 → K06
    const stationCode = stopId.slice(3, 6)

    const depStr = cols[depIdx]?.trim()
    if (!depStr) continue
    const depParts = depStr.split(':')
    const depSec = parseInt(depParts[0]) * 3600 + parseInt(depParts[1]) * 60 + parseInt(depParts[2])

    const existing = stationDeps.get(stationCode)
    const entry: MetroDeparture = {
      depSec,
      tripId,
      line: trip.line,
      headsign: trip.headsign,
    }
    if (existing) {
      existing.push(entry)
    } else {
      stationDeps.set(stationCode, [entry])
    }
  }

  return stationDeps
}

// ── Index builder ──────────────────────────────────────────────────────

function toYYYYMMDD(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function ensureIndex(): MetroScheduleIndex | null {
  if (!dataLoaded) return null

  const et = getEasternTime()
  if (index && index.date === et.dateStr) return index

  console.log(`[MetroSchedule] Building index for ${et.dateStr}...`)
  const startMs = Date.now()

  // 1. Find active services for today
  const calendarDates = parseCalendarDates()
  const todayNum = toYYYYMMDD(et.date)
  const activeServiceIds = calendarDates.get(todayNum) ?? new Set<string>()

  if (activeServiceIds.size === 0) {
    console.warn(`[MetroSchedule] No active services for ${et.dateStr} (${todayNum})`)
    // Return empty index rather than null
    index = { date: et.dateStr, activeServiceIds, stationDepartures: new Map() }
    return index
  }

  // 2. Parse trips, keep only active services
  const allTrips = parseTrips()
  const activeTrips = new Map<string, MetroTrip>()
  for (const [tripId, trip] of allTrips) {
    if (activeServiceIds.has(trip.serviceId)) {
      activeTrips.set(tripId, trip)
    }
  }

  // 3. Parse stop_times filtered to active trips
  const stationDepartures = parseStopTimes(activeTrips)

  // 4. Sort each station's departures by time
  for (const deps of stationDepartures.values()) {
    deps.sort((a, b) => a.depSec - b.depSec)
  }

  index = { date: et.dateStr, activeServiceIds, stationDepartures }

  const elapsed = Date.now() - startMs
  console.log(
    `[MetroSchedule] Index built in ${elapsed}ms: ${activeServiceIds.size} active services, ${stationDepartures.size} stations`
  )

  return index
}

// ── Binary search (copied from busScheduleIndex.ts) ────────────────────

function lowerBound(deps: MetroDeparture[], targetSec: number): number {
  let lo = 0
  let hi = deps.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (deps[mid].depSec < targetSec) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Load metro schedule data and eagerly build the index.
 * Call at startup after GTFS files are available.
 * Building eagerly avoids blocking the event loop during a request.
 */
export function loadMetroScheduleData(): void {
  try {
    const testPath = resolve(GTFS_DIR, 'calendar_dates.txt')
    readFileSync(testPath, { encoding: 'utf-8', flag: 'r' }).slice(0, 1) // existence check only
    dataLoaded = true
    ensureIndex() // Build now, not on first request
  } catch {
    console.warn('[MetroSchedule] Metro GTFS files not yet available')
    dataLoaded = false
  }
}

/**
 * Invalidate the cached schedule index (e.g. after GTFS refresh).
 */
export function invalidateMetroScheduleIndex(): void {
  index = null
  dataLoaded = false
}

/**
 * Get metro departures for a station, filtered by terminus.
 * @param stationCode - e.g. "B09"
 * @param terminus - destination(s) to filter by (e.g. "Glenmont" or ["Glenmont"])
 * @param startFromMinutes - only return departures at least this many minutes from now
 * @param limit - max results (default 10)
 */
export function getMetroDepartures(
  stationCode: string,
  terminus: string | string[],
  startFromMinutes = 0,
  limit = 10
): ScheduledMetroTrain[] {
  const idx = ensureIndex()
  if (!idx) return []

  const deps = idx.stationDepartures.get(stationCode)
  if (!deps || deps.length === 0) return []

  const { nowSec } = getEasternTime()
  const searchFromSec = nowSec + startFromMinutes * 60

  const terminusList = Array.isArray(terminus) ? terminus : [terminus]
  const normalizedTermini = terminusList.map(t => normalizeDestination(t))

  const matchesTerminus = (headsign: string) => {
    const normalizedHeadsign = normalizeDestination(headsign)
    return normalizedTermini.some(term => {
      if (normalizedHeadsign === term) return true
      // partial match: "vienna" matches "vienna fairfax-gmu"
      if (normalizedHeadsign.includes(term) || term.includes(normalizedHeadsign)) return true
      // first-word match
      const headsignFirst = normalizedHeadsign.split(/[\s\-\/]/)[0]
      const termFirst = term.split(/[\s\-\/]/)[0]
      return headsignFirst === termFirst
    })
  }

  const startIdx = lowerBound(deps, searchFromSec)
  const results: ScheduledMetroTrain[] = []

  for (let i = startIdx; i < deps.length && results.length < limit; i++) {
    const d = deps[i]
    if (matchesTerminus(d.headsign)) {
      results.push({
        depSec: d.depSec,
        minutesFromNow: Math.max(0, Math.round((d.depSec - nowSec) / 60)),
        tripId: d.tripId,
        line: d.line,
        headsign: d.headsign,
      })
    }
  }

  return results
}
