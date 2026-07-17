import type { Line, PlaceContext, Station } from './index.js'

export const SHARE_TRIP_VERSION = 2 as const
export const SHARE_IMAGE_WIDTH = 1200
export const SHARE_IMAGE_HEIGHT = 630

const VALID_LINES: readonly Line[] = ['RD', 'OR', 'SV', 'BL', 'YL', 'GR']
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1)
const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u

export type SharedPlaceContext = Pick<
  PlaceContext,
  | 'place'
  | 'station'
  | 'exit'
  | 'walkTimeMinutes'
  | 'walkDistanceMeters'
  | 'direction'
  | 'busOnly'
>

export type SharedTripTimingSource = 'live' | 'mixed' | 'scheduled'

export interface SharedTripLeg {
  kind: 'walk' | 'rail' | 'transfer'
  minutes: number
  line?: Line
  toward?: string
  stationName?: string
}

export interface SharedTripTiming {
  /** When the pathfinding/live data used for this snapshot was fetched. */
  capturedAtMs: number
  /** Absolute train departure time at the origin station, when known. */
  departureAtMs: number | null
  /** Absolute arrival time at the final place/station, when known. */
  arrivalAtMs: number | null
  source: SharedTripTimingSource
}

export interface SharedTripPayload {
  v: typeof SHARE_TRIP_VERSION
  origin: Station
  destination: Station
  originPlaceContext?: SharedPlaceContext
  destPlaceContext?: SharedPlaceContext
  lines: Line[]
  durationMinutes: number
  arrivalClock: string | null
  routeSummary: string
  transferWalkSummary: string
  walkTime: number
  accessible: boolean
  /** Planned departure selected by the sender. Null means leave now. */
  departAt: number | null
  transferName: string | null
  legs: SharedTripLeg[]
  timing: SharedTripTiming
  /** Stamped by the server when it creates the signed share token. */
  sharedAtMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(value).every(key => allowed.has(key))
}

function finiteNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null
}

function epoch(value: unknown): number | null {
  return Number.isSafeInteger(value) && finiteNumber(value, 0, MAX_EPOCH_MS) != null
    ? value as number
    : null
}

function displayString(value: unknown, maxLength: number, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null
  const output = value.trim()
  if ((!allowEmpty && output.length === 0) || output.length > maxLength) return null
  if (UNSAFE_DISPLAY_CHARACTERS.test(output)) return null
  return output
}

function parseLine(value: unknown): Line | null {
  return typeof value === 'string' && VALID_LINES.includes(value as Line)
    ? value as Line
    : null
}

function parseLines(value: unknown, min = 1): Line[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > VALID_LINES.length) return null
  const lines = value.map(parseLine)
  if (lines.some(line => line == null)) return null
  const output = lines as Line[]
  return new Set(output).size === output.length ? output : null
}

function parseStation(value: unknown): Station | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['code', 'name', 'lines'])) return null
  const code = displayString(value.code, 8)
  const name = displayString(value.name, 100)
  const lines = parseLines(value.lines)
  if (!code || !/^[A-Z]\d{2}$/u.test(code) || !name || !lines) return null
  return { code, name, lines }
}

function parsePlaceContext(value: unknown): SharedPlaceContext | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'place',
    'station',
    'exit',
    'walkTimeMinutes',
    'walkDistanceMeters',
    'direction',
    'busOnly',
  ])) return null
  if (!isRecord(value.place) || !hasOnlyKeys(value.place, ['id', 'name', 'context', 'lat', 'lon'])) return null
  if (!isRecord(value.exit) || !hasOnlyKeys(value.exit, ['id', 'name', 'lat', 'lon', 'isAccessible'])) return null

  const station = parseStation(value.station)
  const placeId = displayString(value.place.id, 256)
  const placeName = displayString(value.place.name, 140)
  const placeDescription = displayString(value.place.context, 240, true)
  const placeLat = finiteNumber(value.place.lat, -90, 90)
  const placeLon = finiteNumber(value.place.lon, -180, 180)
  const exitId = displayString(value.exit.id, 160)
  const exitName = displayString(value.exit.name, 160)
  const exitLat = finiteNumber(value.exit.lat, -90, 90)
  const exitLon = finiteNumber(value.exit.lon, -180, 180)
  const walkTimeMinutes = finiteNumber(value.walkTimeMinutes, 0, 180)
  const walkDistanceMeters = finiteNumber(value.walkDistanceMeters, 0, 30_000)

  if (
    !station
    || !placeId
    || !placeName
    || placeDescription == null
    || placeLat == null
    || placeLon == null
    || !exitId
    || !exitName
    || exitLat == null
    || exitLon == null
    || typeof value.exit.isAccessible !== 'boolean'
    || walkTimeMinutes == null
    || walkDistanceMeters == null
    || (value.direction !== 'to_station' && value.direction !== 'from_station')
    || (value.busOnly != null && typeof value.busOnly !== 'boolean')
  ) return null

  return {
    place: {
      id: placeId,
      name: placeName,
      context: placeDescription,
      lat: placeLat,
      lon: placeLon,
    },
    station,
    exit: {
      id: exitId,
      name: exitName,
      lat: exitLat,
      lon: exitLon,
      isAccessible: value.exit.isAccessible,
    },
    walkTimeMinutes,
    walkDistanceMeters,
    direction: value.direction,
    ...(value.busOnly == null ? {} : { busOnly: value.busOnly }),
  }
}

function parseLeg(value: unknown): SharedTripLeg | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['kind', 'minutes', 'line', 'toward', 'stationName'])) return null
  if (value.kind !== 'walk' && value.kind !== 'rail' && value.kind !== 'transfer') return null
  const minutes = finiteNumber(value.minutes, 0, 360)
  const line = value.line == null ? undefined : parseLine(value.line) ?? undefined
  const toward = value.toward == null ? undefined : displayString(value.toward, 100) ?? undefined
  const stationName = value.stationName == null ? undefined : displayString(value.stationName, 100) ?? undefined
  if (minutes == null) return null
  if (value.line != null && !line) return null
  if (value.toward != null && !toward) return null
  if (value.stationName != null && !stationName) return null
  if (value.kind === 'rail' && !line) return null
  if (value.kind !== 'rail' && line) return null
  return {
    kind: value.kind,
    minutes,
    ...(line ? { line } : {}),
    ...(toward ? { toward } : {}),
    ...(stationName ? { stationName } : {}),
  }
}

function parseTiming(value: unknown): SharedTripTiming | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'capturedAtMs',
    'departureAtMs',
    'arrivalAtMs',
    'source',
  ])) return null
  const capturedAtMs = epoch(value.capturedAtMs)
  const departureAtMs = value.departureAtMs === null ? null : epoch(value.departureAtMs)
  const arrivalAtMs = value.arrivalAtMs === null ? null : epoch(value.arrivalAtMs)
  if (
    capturedAtMs == null
    || (value.departureAtMs !== null && departureAtMs == null)
    || (value.arrivalAtMs !== null && arrivalAtMs == null)
    || (value.source !== 'live' && value.source !== 'mixed' && value.source !== 'scheduled')
    || (departureAtMs != null && arrivalAtMs != null && arrivalAtMs < departureAtMs)
  ) return null
  return { capturedAtMs, departureAtMs, arrivalAtMs, source: value.source }
}

/** Strictly validates an untrusted share snapshot and returns a normalized copy. */
export function parseSharedTripPayload(value: unknown): SharedTripPayload | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'v',
    'origin',
    'destination',
    'originPlaceContext',
    'destPlaceContext',
    'lines',
    'durationMinutes',
    'arrivalClock',
    'routeSummary',
    'transferWalkSummary',
    'walkTime',
    'accessible',
    'departAt',
    'transferName',
    'legs',
    'timing',
    'sharedAtMs',
  ])) return null
  if (value.v !== SHARE_TRIP_VERSION) return null

  const origin = parseStation(value.origin)
  const destination = parseStation(value.destination)
  const originPlaceContext = value.originPlaceContext == null
    ? undefined
    : parsePlaceContext(value.originPlaceContext)
  const destPlaceContext = value.destPlaceContext == null
    ? undefined
    : parsePlaceContext(value.destPlaceContext)
  const lines = parseLines(value.lines)
  const durationMinutes = finiteNumber(value.durationMinutes, 0, 1_440)
  const arrivalClock = value.arrivalClock === null ? null : displayString(value.arrivalClock, 40)
  const routeSummary = displayString(value.routeSummary, 240)
  const transferWalkSummary = displayString(value.transferWalkSummary, 240)
  const walkTime = finiteNumber(value.walkTime, 0, 180)
  const departAt = value.departAt === null ? null : epoch(value.departAt)
  const transferName = value.transferName === null ? null : displayString(value.transferName, 100)
  const timing = parseTiming(value.timing)
  const sharedAtMs = epoch(value.sharedAtMs)

  if (
    !origin
    || !destination
    || origin.code === destination.code
    || (value.originPlaceContext != null && !originPlaceContext)
    || (value.destPlaceContext != null && !destPlaceContext)
    || (originPlaceContext && originPlaceContext.station.code !== origin.code)
    || (destPlaceContext && destPlaceContext.station.code !== destination.code)
    || !lines
    || durationMinutes == null
    || (value.arrivalClock !== null && arrivalClock == null)
    || !routeSummary
    || !transferWalkSummary
    || walkTime == null
    || typeof value.accessible !== 'boolean'
    || (value.departAt !== null && departAt == null)
    || (value.transferName !== null && transferName == null)
    || !Array.isArray(value.legs)
    || value.legs.length < 1
    || value.legs.length > 8
    || !timing
    || sharedAtMs == null
  ) return null

  const legs = value.legs.map(parseLeg)
  if (legs.some(leg => leg == null)) return null
  const normalizedLegs = legs as SharedTripLeg[]
  const railLines = normalizedLegs
    .filter((leg): leg is SharedTripLeg & { line: Line } => leg.kind === 'rail' && leg.line != null)
    .map(leg => leg.line)
  if (railLines.length < 1 || railLines.some(line => !lines.includes(line))) return null

  return {
    v: SHARE_TRIP_VERSION,
    origin,
    destination,
    ...(originPlaceContext ? { originPlaceContext } : {}),
    ...(destPlaceContext ? { destPlaceContext } : {}),
    lines,
    durationMinutes,
    arrivalClock,
    routeSummary,
    transferWalkSummary,
    walkTime,
    accessible: value.accessible,
    departAt,
    transferName,
    legs: normalizedLegs,
    timing,
    sharedAtMs,
  }
}
