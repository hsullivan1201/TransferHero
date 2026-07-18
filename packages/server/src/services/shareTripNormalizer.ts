import type {
  SharedPlaceContext,
  SharedTrackedTrain,
  SharedTripLeg,
  SharedTripPayload,
  SharedTripTracking,
  Station,
} from '@transferhero/shared'
import { parseSharedTripPayload, SHARE_TRIP_VERSION } from '@transferhero/shared'
import { LINE_PATHS } from '../data/lineConfig.js'
import { normalizePlatformCode, STATION_ALIASES } from '../data/platformCodes.js'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'
import { getExitsForStation } from './stationService.js'

const TRACKING_ARRIVAL_GRACE_MS = 30 * 60 * 1000
const MAX_TRACKING_FUTURE_MS = 24 * 60 * 60 * 1000
const CANONICAL_STATION_CODES = Object.values(LINE_PATHS).flat(2)

type RailLeg = SharedTripLeg & { kind: 'rail'; line: SharedTrackedTrain['line'] }

function canonicalPlaceContext(
  context: SharedPlaceContext | undefined,
  stationCode: string
): SharedPlaceContext | undefined {
  if (!context || context.station.code !== stationCode) return undefined
  const station = findStationByCode(stationCode)
  if (!station) return undefined
  const knownExits = getExitsForStation(stationCode)
  if (knownExits.length > 0 && !knownExits.some(exit => exit.id === context.exit.id)) return undefined
  return { ...context, station }
}

function canonicalStation(station: Station): Station | null {
  const code = normalizePlatformCode(station.code, CANONICAL_STATION_CODES)
  return findStationByCode(code) ?? null
}

function pathMatchesStops(path: string[], codes: string[]): boolean {
  const normalizedCodes = codes.map(code => normalizePlatformCode(code, path))
  const fromIndex = path.indexOf(normalizedCodes[0])
  const toIndex = path.indexOf(normalizedCodes[normalizedCodes.length - 1])
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false
  const step = fromIndex < toIndex ? 1 : -1
  const expected = path.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1)
  if (step < 0) expected.reverse()
  return expected.length === normalizedCodes.length
    && expected.every((code, index) => code === normalizedCodes[index])
}

function followsCanonicalPath(train: SharedTrackedTrain): boolean {
  const codes = train.stops.map(stop => stop.code)
  return LINE_PATHS[train.line].some(path => pathMatchesStops(path, codes))
}

function canonicalTrackedTrain(train: SharedTrackedTrain): SharedTrackedTrain | null {
  const stops = train.stops.map(canonicalStation)
  const from = canonicalStation(train.from)
  const to = canonicalStation(train.to)
  if (stops.some(stop => stop == null) || !from || !to) return null
  const normalizedStops = stops as Station[]
  const normalized: SharedTrackedTrain = { ...train, from, to, stops: normalizedStops }
  if (
    normalizedStops[0].code !== from.code
    || normalizedStops[normalizedStops.length - 1].code !== to.code
    || normalizedStops.some(stop => !stop.lines.includes(train.line))
    || !followsCanonicalPath(normalized)
  ) return null
  return normalized
}

function normalizedStationName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function samePhysicalStation(left: Station, right: Station): boolean {
  return left.code === right.code
    || STATION_ALIASES[left.code] === right.code
    || STATION_ALIASES[right.code] === left.code
}

function railLegsFor(trip: SharedTripPayload): RailLeg[] {
  return trip.legs.filter((leg): leg is RailLeg => leg.kind === 'rail' && leg.line != null)
}

function transferStationsFor(trip: SharedTripPayload): Station[] {
  if (!trip.transferName) return []
  const transferName = normalizedStationName(trip.transferName)
  return ALL_STATIONS.filter(station => normalizedStationName(station.name) === transferName)
}

function trainMatchesRailLeg(
  train: SharedTrackedTrain,
  railLegs: RailLeg[],
  tripLines: SharedTripPayload['lines']
): boolean {
  const railLeg = railLegs[train.leg - 1]
  if (!railLeg || railLeg.line !== train.line || !tripLines.includes(train.line)) return false
  return !railLeg.toward
    || normalizedStationName(railLeg.toward) === normalizedStationName(train.toward)
}

function trainMatchesEndpoints(
  train: SharedTrackedTrain,
  trip: SharedTripPayload,
  railLegCount: number
): boolean {
  if (train.leg === 1 && !samePhysicalStation(train.from, trip.origin)) return false
  if (train.leg === railLegCount && !samePhysicalStation(train.to, trip.destination)) return false
  return true
}

function trainMatchesTransfer(
  train: SharedTrackedTrain,
  railLegCount: number,
  transferStations: Station[]
): boolean {
  if (railLegCount !== 2) return true
  const transferEndpoint = train.leg === 1 ? train.to : train.from
  return transferStations.some(station => samePhysicalStation(station, transferEndpoint))
}

function trackedLegsConnect(trains: SharedTrackedTrain[]): boolean {
  const first = trains.find(train => train.leg === 1)
  const second = trains.find(train => train.leg === 2)
  return !first || !second || samePhysicalStation(first.to, second.from)
}

function trackingMatchesTrip(trains: SharedTrackedTrain[], trip: SharedTripPayload): boolean {
  const railLegs = railLegsFor(trip)
  if (railLegs.length < 1 || railLegs.length > 2) return false
  const transferStations = transferStationsFor(trip)
  const allTrainsMatch = trains.every(train =>
    trainMatchesRailLeg(train, railLegs, trip.lines)
    && trainMatchesEndpoints(train, trip, railLegs.length)
    && trainMatchesTransfer(train, railLegs.length, transferStations)
  )
  return allTrainsMatch && trackedLegsConnect(trains)
}

function canonicalTracking(
  tracking: SharedTripTracking | undefined,
  trip: SharedTripPayload,
  nowMs: number
): SharedTripTracking | undefined | null {
  if (!tracking) return undefined
  const trains = tracking.trains.map(canonicalTrackedTrain)
  if (trains.some(train => train == null)) return null
  const normalizedTrains = trains as SharedTrackedTrain[]
  if (!trackingMatchesTrip(normalizedTrains, trip)) return null
  const tripEndMs = Math.max(...normalizedTrains.map(train => train.arrivalAtMs))
  if (tripEndMs > nowMs + MAX_TRACKING_FUTURE_MS) return null
  return {
    trains: normalizedTrains,
    expiresAtMs: Math.min(tripEndMs + TRACKING_ARRIVAL_GRACE_MS, nowMs + MAX_TRACKING_FUTURE_MS),
  }
}

/** Canonicalize and bind an untrusted v3 share request before it is signed. */
export function normalizeCreatedTrip(value: unknown, nowMs = Date.now()): SharedTripPayload | null {
  const parsed = parseSharedTripPayload(value)
  // Creation always upgrades to the current contract. Decoding still accepts v2.
  if (!parsed || parsed.v !== SHARE_TRIP_VERSION) return null
  const origin = findStationByCode(parsed.origin.code)
  const destination = findStationByCode(parsed.destination.code)
  if (!origin || !destination || origin.code === destination.code) return null

  const originPlaceContext = canonicalPlaceContext(parsed.originPlaceContext, origin.code)
  const destPlaceContext = canonicalPlaceContext(parsed.destPlaceContext, destination.code)
  if (parsed.originPlaceContext && !originPlaceContext) return null
  if (parsed.destPlaceContext && !destPlaceContext) return null
  const tracking = canonicalTracking(parsed.tracking, parsed, nowMs)
  if (tracking === null) return null

  return {
    ...parsed,
    origin,
    destination,
    ...(originPlaceContext ? { originPlaceContext } : {}),
    ...(destPlaceContext ? { destPlaceContext } : {}),
    sharedAtMs: nowMs,
    ...(tracking ? { tracking } : {}),
  }
}
