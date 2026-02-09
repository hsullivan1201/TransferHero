import type { BusScheduledDeparture } from '@transferhero/shared'
import { getBusCalendar, getBusCalendarDates, getBusTrips, getBusTripStopTimes } from './busGtfsLoader.js'

interface StopDeparture {
  depSec: number
  tripId: string
  routeId: string
  directionId: number
}

interface ScheduleIndex {
  date: string // YYYY-MM-DD, rebuild on day change
  activeServiceIds: Set<string>
  stopDepartures: Map<string, StopDeparture[]> // stopId → sorted departures
}

let index: ScheduleIndex | null = null

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
  // Normalize >24h times
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

  // Base: calendar.txt regular services
  for (const [serviceId, entry] of calendar) {
    if (dateNum >= entry.startDate && dateNum <= entry.endDate && entry.days[dayIdx]) {
      active.add(serviceId)
    }
  }

  // Exceptions: calendar_dates.txt
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

/**
 * Build or rebuild the schedule index. Lazy — only called on first query or day change.
 */
function ensureScheduleIndex(): ScheduleIndex {
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  if (index && index.date === todayStr) {
    return index
  }

  console.log(`[BusSchedule] Building schedule index for ${todayStr}...`)
  const startMs = Date.now()

  const activeServiceIds = computeActiveServices(now)
  const trips = getBusTrips()
  const tripStopTimes = getBusTripStopTimes()

  const stopDepartures = new Map<string, StopDeparture[]>()

  for (const [tripId, trip] of trips) {
    if (!activeServiceIds.has(trip.serviceId)) continue

    const stopTimes = tripStopTimes.get(tripId)
    if (!stopTimes) continue

    for (const st of stopTimes) {
      if (st.depSec < 0) continue // invalid time
      const entry: StopDeparture = {
        depSec: st.depSec,
        tripId,
        routeId: trip.routeId,
        directionId: trip.directionId,
      }
      const existing = stopDepartures.get(st.stopId)
      if (existing) {
        existing.push(entry)
      } else {
        stopDepartures.set(st.stopId, [entry])
      }
    }
  }

  // Sort each stop's departures by time
  for (const deps of stopDepartures.values()) {
    deps.sort((a, b) => a.depSec - b.depSec)
  }

  index = { date: todayStr, activeServiceIds, stopDepartures }

  const elapsed = Date.now() - startMs
  console.log(`[BusSchedule] Index built in ${elapsed}ms: ${activeServiceIds.size} active services, ${stopDepartures.size} stops with departures`)

  return index
}

/**
 * Binary search for the first departure at or after `targetSec` in sorted array
 */
function lowerBound(deps: StopDeparture[], targetSec: number): number {
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

/**
 * Get next scheduled departures for a stop+route+direction.
 * @param afterMinFromNow — only return departures at least this many minutes from now
 *   (e.g. if the user won't arrive at the stop for 15 min, pass 15)
 */
export function getNextScheduledDepartures(
  stopId: string,
  routeId: string,
  directionId: number,
  limit: number = 3,
  afterMinFromNow: number = 0,
  extraRouteIds?: Set<string>,
): BusScheduledDeparture[] {
  const idx = ensureScheduleIndex()
  const deps = idx.stopDepartures.get(stopId)
  if (!deps || deps.length === 0) return []

  const now = new Date()
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const searchFromSec = nowSec + afterMinFromNow * 60

  const startIdx = lowerBound(deps, searchFromSec)
  const results: BusScheduledDeparture[] = []

  for (let i = startIdx; i < deps.length && results.length < limit; i++) {
    const d = deps[i]
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
 * Returns tripId, depSec, and wait time. Used for ride time lookups and
 * computing realistic bus wait in trip estimates.
 * @param afterMinFromNow — search from this many minutes in the future
 */
export function getNextDeparture(
  stopId: string,
  routeId: string,
  directionId: number,
  afterMinFromNow: number = 0
): { tripId: string; depSec: number; minutesFromNow: number } | null {
  const idx = ensureScheduleIndex()
  const deps = idx.stopDepartures.get(stopId)
  if (!deps || deps.length === 0) return null

  const now = new Date()
  const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const searchFromSec = nowSec + afterMinFromNow * 60

  const startIdx = lowerBound(deps, searchFromSec)

  for (let i = startIdx; i < deps.length; i++) {
    const d = deps[i]
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
  const tripStopTimes = getBusTripStopTimes()
  const stopTimes = tripStopTimes.get(tripId)
  if (!stopTimes) return null

  let boardSec: number | null = null
  let alightSec: number | null = null

  for (const st of stopTimes) {
    if (st.stopId === boardStopId && boardSec === null) boardSec = st.depSec
    if (st.stopId === alightStopId && alightSec === null) alightSec = st.depSec
  }

  if (boardSec === null || alightSec === null || boardSec < 0 || alightSec < 0) return null
  const diffMin = Math.round((alightSec - boardSec) / 60)
  return diffMin > 0 ? diffMin : null
}
