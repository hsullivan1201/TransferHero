import type { Line, Station } from './index.js'

export const MAX_TRACKED_TRAINS = 2
export const MAX_TRACKED_STOPS = 64

const VALID_LINES: readonly Line[] = ['RD', 'OR', 'SV', 'BL', 'YL', 'GR']
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1)
const MAX_TRACKED_RIDE_MS = 12 * 60 * 60 * 1000
const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u

/** The bounded identity and route snapshot needed to follow one selected train. */
export interface SharedTrackedTrain {
  /** Stable within this share, and unique across the selected trains. */
  id: string
  leg: 1 | 2
  line: Line
  toward: string
  tripId?: string
  trainId?: string
  trainNumber?: string
  vehicleId?: string
  from: Station
  to: Station
  /** Ordered station path for this selected leg, including from and to. */
  stops: Station[]
  departureAtMs: number
  arrivalAtMs: number
}

export interface SharedTripTracking {
  trains: SharedTrackedTrain[]
  /** Server-stamped hard stop for all live polling for this share. */
  expiresAtMs: number
}

export interface MetroMapPoint {
  stationCode: string
  lat: number
  lon: number
}

export interface MetroMapStation extends Station {
  /** Centroid of this physical station's public entrance/exit coordinates. */
  lat: number
  lon: number
}

export interface MetroMapPath {
  id: string
  line: Line
  stationCodes: string[]
  /** Geographic station anchors in stationCodes order. */
  points: MetroMapPoint[]
}

export interface MetroMapData {
  generatedAtMs: number
  stations: MetroMapStation[]
  paths: MetroMapPath[]
}

export type LiveTrackerPhase =
  | 'not_started'
  | 'at_station'
  | 'in_transit'
  | 'arriving'
  | 'arrived'
  | 'ended'
  | 'unknown'

export type LiveTrackerPositionSource = 'vehicle' | 'trip_update' | 'schedule'

export interface LiveTrackerStopStatus {
  code: string
  name: string
  expectedAtMs: number | null
}

export interface LiveTrackerEta {
  arrivalAtMs: number
  minutes: number
}

export interface LiveTrackerFreshness {
  updatedAtMs: number
  ageMs: number
  isStale: boolean
}

export interface LiveTrackerPosition {
  lat: number
  lon: number
  bearing: number | null
  /** `vehicle` is measured; the other sources are clearly marked interpolation. */
  source: LiveTrackerPositionSource
  /** Approximate, derived from consecutive GPS fixes; null when unknown. */
  speedMph?: number | null
}

/**
 * Where an inbound train is before it reaches the rider's boarding station.
 * Covers a bounded window of upstream stations ending at the trip origin.
 */
export interface LiveTrackerApproach {
  /** Upstream station codes in travel order; the last code is the trip origin. */
  stationCodes: string[]
  previousStop: LiveTrackerStopStatus | null
  nextStop: LiveTrackerStopStatus | null
  /** Clamped progress along the approach window, from 0 to 1. */
  progress: number
}

export interface LiveTrackedTrainStatus {
  id: string
  leg: 1 | 2
  line: Line
  toward: string
  tripId: string | null
  vehicleId: string | null
  from: Station
  to: Station
  routeStationCodes: string[]
  phase: LiveTrackerPhase
  previousStop: LiveTrackerStopStatus | null
  nextStop: LiveTrackerStopStatus | null
  eta: LiveTrackerEta | null
  freshness: LiveTrackerFreshness
  position: LiveTrackerPosition | null
  /** Clamped progress through this selected leg, from 0 to 1. */
  progress: number
  /** Present only while the train is still on its way to the boarding station. */
  approach?: LiveTrackerApproach | null
  ended: boolean
}

export interface LiveTrackerResponse {
  updatedAtMs: number
  expiresAtMs: number
  expired: boolean
  ended: boolean
  trains: LiveTrackedTrainStatus[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function displayString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const output = value.trim()
  if (!output || output.length > maxLength || UNSAFE_DISPLAY_CHARACTERS.test(output)) return null
  return output
}

function epoch(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_EPOCH_MS
    ? value as number
    : null
}

function parseStation(value: unknown): Station | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['code', 'name', 'lines'])) return null
  const code = displayString(value.code, 8)
  const name = displayString(value.name, 100)
  if (!code || !/^[A-Z]\d{2}$/u.test(code) || !name) return null
  if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > VALID_LINES.length) return null
  const lines = value.lines.filter((line): line is Line => VALID_LINES.includes(line as Line))
  if (lines.length !== value.lines.length || new Set(lines).size !== lines.length) return null
  return { code, name, lines }
}

function optionalId(value: unknown): string | undefined | null {
  return value == null ? undefined : displayString(value, 128)
}

function parseTrackedTrain(value: unknown): SharedTrackedTrain | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id',
    'leg',
    'line',
    'toward',
    'tripId',
    'trainId',
    'trainNumber',
    'vehicleId',
    'from',
    'to',
    'stops',
    'departureAtMs',
    'arrivalAtMs',
  ])) return null

  const id = displayString(value.id, 128)
  const line = VALID_LINES.includes(value.line as Line) ? value.line as Line : null
  const toward = displayString(value.toward, 100)
  const tripId = optionalId(value.tripId)
  const trainId = optionalId(value.trainId)
  const trainNumber = optionalId(value.trainNumber)
  const vehicleId = optionalId(value.vehicleId)
  const from = parseStation(value.from)
  const to = parseStation(value.to)
  const departureAtMs = epoch(value.departureAtMs)
  const arrivalAtMs = epoch(value.arrivalAtMs)

  if (
    !id
    || (value.leg !== 1 && value.leg !== 2)
    || !line
    || !toward
    || tripId === null
    || trainId === null
    || trainNumber === null
    || vehicleId === null
    || (!tripId && !trainId && !trainNumber && !vehicleId)
    || !from
    || !to
    || from.code === to.code
    || departureAtMs == null
    || arrivalAtMs == null
    || arrivalAtMs <= departureAtMs
    || arrivalAtMs - departureAtMs > MAX_TRACKED_RIDE_MS
    || !Array.isArray(value.stops)
    || value.stops.length < 2
    || value.stops.length > MAX_TRACKED_STOPS
  ) return null

  const stops = value.stops.map(parseStation)
  if (stops.some(stop => stop == null)) return null
  const normalizedStops = stops as Station[]
  if (
    normalizedStops[0].code !== from.code
    || normalizedStops[normalizedStops.length - 1].code !== to.code
    || new Set(normalizedStops.map(stop => stop.code)).size !== normalizedStops.length
  ) return null

  return {
    id,
    leg: value.leg,
    line,
    toward,
    ...(tripId ? { tripId } : {}),
    ...(trainId ? { trainId } : {}),
    ...(trainNumber ? { trainNumber } : {}),
    ...(vehicleId ? { vehicleId } : {}),
    from,
    to,
    stops: normalizedStops,
    departureAtMs,
    arrivalAtMs,
  }
}

/** Strictly validates the live-only section of a v3 share payload. */
export function parseSharedTripTracking(value: unknown): SharedTripTracking | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['trains', 'expiresAtMs'])) return null
  if (!Array.isArray(value.trains) || value.trains.length < 1 || value.trains.length > MAX_TRACKED_TRAINS) {
    return null
  }
  const expiresAtMs = epoch(value.expiresAtMs)
  if (expiresAtMs == null) return null
  const trains = value.trains.map(parseTrackedTrain)
  if (trains.some(train => train == null)) return null
  const normalizedTrains = trains as SharedTrackedTrain[]
  if (
    new Set(normalizedTrains.map(train => train.id)).size !== normalizedTrains.length
    || new Set(normalizedTrains.map(train => train.leg)).size !== normalizedTrains.length
    || normalizedTrains.some(train => expiresAtMs < train.arrivalAtMs)
  ) return null
  return { trains: normalizedTrains, expiresAtMs }
}
