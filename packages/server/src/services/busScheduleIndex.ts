import type { BusScheduledDeparture } from '@transferhero/shared'
import { getBusCalendar, getBusCalendarDates, getBusDb } from './busGtfsLoader.js'

interface StopDeparture {
  depSec: number
  tripId: string
  routeId: string
  directionId: number
}

/**
 * Get current date/time in Eastern Time (America/New_York).
 * WMATA GTFS departure times are in ET, so all schedule comparisons must use ET.
 * Avoids relying on server system timezone (often UTC in cloud deployments).
 */
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
  const hour = get('hour') % 24 // Intl may return 24 for midnight
  const minute = get('minute')
  const second = get('second')

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const nowSec = hour * 3600 + minute * 60 + second

  // Create Date with ET values for day-of-week / date comparisons
  const date = new Date(year, month - 1, day, hour, minute, second)

  return { date, nowSec, dateStr }
}

/**
 * Format YYYYMMDD number from a Date
 */
function toYYYYMMDD(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

/**
 * Get JS day-of-week as GTFS index: Mon=0..Sun=6
 * (JS Date.getDay() returns 0=Sun, 1=Mon, ..., 6=Sat)
 */
function getGtfsDayIndex(d: Date): number {
  const jsDay = d.getDay() // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1 // Mon=0..Sun=6
}

/**
 * Format seconds since midnight to "h:mm AM/PM"
 */
function formatTime(sec: number): string {
  const normalizedSec = sec % 86400
  const h = Math.floor(normalizedSec / 3600)
  const m = Math.floor((normalizedSec % 3600) / 60)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}

/**
 * Compute active service IDs for a given date
 */
function computeActiveServices(date: Date): Set<string> {
  const calendar = getBusCalendar()
  const calendarDates = getBusCalendarDates()
  const dateNum = toYYYYMMDD(date)
  const dayIdx = getGtfsDayIndex(date)

  const active = new Set<string>()

  for (const [serviceId, entry] of calendar) {
    if (dateNum >= entry.startDate && dateNum <= entry.endDate && entry.days[dayIdx]) {
      active.add(serviceId)
    }
  }

  for (const [serviceId, exceptions] of calendarDates) {
    for (const ex of exceptions) {
      if (ex.date === dateNum) {
        if (ex.added) {
          active.add(serviceId)
        } else {
          active.delete(serviceId)
        }
      }
    }
  }

  return active
}

// Cached service state: active service IDs + SQL IN clause fragment, rebuilt once per day
interface ServiceState {
  dateStr: string
  activeServiceIds: Set<string>
  serviceParams: string[]  // Array of active service IDs for SQL binding
  inClause: string         // Pre-built "?,?,?" placeholder string
}

let cached: ServiceState | null = null

/**
 * Invalidate the cached service state (e.g. after a GTFS data refresh).
 * Next query will rebuild from fresh data.
 */
export function invalidateScheduleIndex(): void {
  cached = null
}

/**
 * Ensure we have today's active service IDs computed.
 * Rebuilds on day change or after invalidation.
 */
function ensureServiceState(): ServiceState | null {
  const busDb = getBusDb()
  if (!busDb) return null

  const et = getEasternTime()

  if (cached && cached.dateStr === et.dateStr) {
    return cached
  }

  console.log(`[BusSchedule] Building service state for ${et.dateStr}...`)
  const startMs = Date.now()

  const activeServiceIds = computeActiveServices(et.date)
  if (activeServiceIds.size === 0) {
    console.log('[BusSchedule] No active services today')
    return null
  }

  const serviceParams = Array.from(activeServiceIds)
  const inClause = serviceParams.map(() => '?').join(',')

  cached = {
    dateStr: et.dateStr,
    activeServiceIds,
    serviceParams,
    inClause,
  }

  const elapsed = Date.now() - startMs
  console.log(`[BusSchedule] Service state built in ${elapsed}ms: ${activeServiceIds.size} active services`)

  return cached
}

/**
 * Get next scheduled departures for a stop+route+direction.
 * @param afterMinFromNow — only return departures at least this many minutes from now
 */
export function getNextScheduledDepartures(
  stopId: string,
  routeId: string,
  directionId: number,
  limit: number = 3,
  afterMinFromNow: number = 0,
  extraRouteIds?: Set<string>,
): BusScheduledDeparture[] {
  const state = ensureServiceState()
  if (!state) return []

  const { nowSec } = getEasternTime()
  const searchFromSec = nowSec + afterMinFromNow * 60

  // Fetch generous number of candidates to filter route/direction in JS
  const fetchLimit = limit * 20
  const busDb = getBusDb()!

  const rows = busDb.prepare(`
    SELECT st.dep_sec AS depSec, st.trip_id AS tripId, t.route_id AS routeId, t.direction_id AS directionId
    FROM stop_times st JOIN trips t ON st.trip_id = t.trip_id
    WHERE st.stop_id = ? AND st.dep_sec >= ? AND t.service_id IN (${state.inClause})
    ORDER BY st.dep_sec
    LIMIT ?
  `).all(stopId, searchFromSec, ...state.serviceParams, fetchLimit) as StopDeparture[]

  const results: BusScheduledDeparture[] = []

  for (const d of rows) {
    if (results.length >= limit) break
    const routeMatch = d.routeId === routeId || (extraRouteIds != null && extraRouteIds.has(d.routeId))
    if (routeMatch && d.directionId === directionId) {
      results.push({
        departureTime: formatTime(d.depSec),
        minutesFromNow: Math.max(0, Math.round((d.depSec - nowSec) / 60)),
      })
    }
  }

  return results
}

/**
 * Get the next departure (full detail) at a stop for a route+direction.
 * Returns tripId, depSec, and wait time.
 * @param afterMinFromNow — search from this many minutes in the future
 */
export function getNextDeparture(
  stopId: string,
  routeId: string,
  directionId: number,
  afterMinFromNow: number = 0
): { tripId: string; depSec: number; minutesFromNow: number } | null {
  const state = ensureServiceState()
  if (!state) return null

  const { nowSec } = getEasternTime()
  const searchFromSec = nowSec + afterMinFromNow * 60

  const busDb = getBusDb()!

  // A stop typically has ~200 departures/day, so fetching a batch is fast
  const rows = busDb.prepare(`
    SELECT st.dep_sec AS depSec, st.trip_id AS tripId, t.route_id AS routeId, t.direction_id AS directionId
    FROM stop_times st JOIN trips t ON st.trip_id = t.trip_id
    WHERE st.stop_id = ? AND st.dep_sec >= ? AND t.service_id IN (${state.inClause})
    ORDER BY st.dep_sec
    LIMIT 100
  `).all(stopId, searchFromSec, ...state.serviceParams) as StopDeparture[]

  for (const d of rows) {
    if (d.routeId === routeId && d.directionId === directionId) {
      return {
        tripId: d.tripId,
        depSec: d.depSec,
        minutesFromNow: Math.max(0, Math.round((d.depSec - nowSec) / 60)),
      }
    }
  }
  return null
}

/**
 * Get scheduled ride time between two stops on a specific trip.
 * Returns minutes or null if stops not found on trip.
 */
export function getScheduledRideMinutes(
  tripId: string,
  boardStopId: string,
  alightStopId: string
): number | null {
  const busDb = getBusDb()
  if (!busDb) return null

  const rows = busDb.prepare(`
    SELECT stop_id, dep_sec FROM stop_times
    WHERE trip_id = ? AND stop_id IN (?, ?)
    ORDER BY seq
  `).all(tripId, boardStopId, alightStopId) as { stop_id: string; dep_sec: number }[]

  let boardSec: number | null = null
  let alightSec: number | null = null

  for (const row of rows) {
    if (row.stop_id === boardStopId && boardSec === null) boardSec = row.dep_sec
    if (row.stop_id === alightStopId && alightSec === null) alightSec = row.dep_sec
  }

  if (boardSec === null || alightSec === null || boardSec < 0 || alightSec < 0) return null
  const diffMin = Math.round((alightSec - boardSec) / 60)
  return diffMin > 0 ? diffMin : null
}
