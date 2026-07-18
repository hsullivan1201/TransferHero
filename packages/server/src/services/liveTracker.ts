import type {
  LiveTrackedTrainStatus,
  LiveTrackerPhase,
  LiveTrackerPosition,
  LiveTrackerResponse,
  LiveTrackerStopStatus,
  MetroMapData,
  SharedTrackedTrain,
  SharedTripPayload,
} from '@transferhero/shared'
import { LINE_PATHS } from '../data/lineConfig.js'
import { normalizePlatformCode } from '../data/platformCodes.js'
import { calculateRouteTravelTime } from './travelTime.js'
import { getMetroMapData } from './metroMap.js'
import {
  fetchGTFSTripUpdates,
  fetchGTFSVehiclePositions,
  getGTFSTripProgress,
  type GtfsTripProgress,
  type RailVehiclePosition,
} from './wmata.js'

const LIVE_STALE_AFTER_MS = 30_000

export interface LiveTrackerDependencies {
  now?: () => number
  apiKey?: string
  fetchVehiclePositions?: (apiKey: string) => Promise<RailVehiclePosition[]>
  fetchTripUpdates?: (apiKey: string) => Promise<any[]>
  getMapData?: () => Promise<MetroMapData>
}

interface ScheduleModel {
  times: number[]
  routeFractions: number[]
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeId(value: string | undefined): string | null {
  const output = value?.trim().toLowerCase()
  return output || null
}

function findMatchingVehicle(
  selected: SharedTrackedTrain,
  positions: RailVehiclePosition[]
): RailVehiclePosition | undefined {
  if (selected.tripId) {
    const tripId = normalizeId(selected.tripId)
    const exactTrip = positions.find(position =>
      normalizeId(position.tripId) === tripId
      && (!position.line || position.line === selected.line)
    )
    if (exactTrip) return exactTrip
  }

  const selectedIds = new Set([
    selected.vehicleId,
    selected.trainId,
    selected.trainNumber,
  ].map(normalizeId).filter((id): id is string => id != null))
  if (selectedIds.size === 0) return undefined

  return positions.find(position => {
    if (position.line && position.line !== selected.line) return false
    return [position.vehicleId, position.vehicleLabel, position.entityId]
      .map(normalizeId)
      .some(id => id != null && selectedIds.has(id))
  })
}

function buildScheduleModel(train: SharedTrackedTrain): ScheduleModel {
  const cumulativeMinutes = [0]
  let totalMinutes = 0

  for (let index = 1; index < train.stops.length; index++) {
    const segmentMinutes = calculateRouteTravelTime(
      train.stops[index - 1].code,
      train.stops[index].code,
      train.line
    )
    if (!Number.isFinite(segmentMinutes) || segmentMinutes <= 0) {
      throw new Error(
        `Missing pathfinding travel time for ${train.line} ${train.stops[index - 1].code}-${train.stops[index].code}`
      )
    }
    totalMinutes += segmentMinutes
    cumulativeMinutes.push(totalMinutes)
  }

  const durationMs = train.arrivalAtMs - train.departureAtMs
  return {
    times: cumulativeMinutes.map(minutes =>
      train.departureAtMs + (minutes / totalMinutes) * durationMs
    ),
    routeFractions: cumulativeMinutes.map(minutes => minutes / totalMinutes),
  }
}

function canonicalProgressStopCode(stopCode: string, routeCodes: string[]): string {
  return normalizePlatformCode(stopCode.trim().toUpperCase(), routeCodes)
}

function effectiveTimes(
  train: SharedTrackedTrain,
  model: ScheduleModel,
  progress: GtfsTripProgress | undefined
): number[] {
  if (!progress || model.times.length !== train.stops.length) return model.times
  const routeCodes = train.stops.map(stop => stop.code)
  const updates = new Map<string, number>()
  for (const stop of progress.stops) {
    updates.set(canonicalProgressStopCode(stop.stopCode, routeCodes), stop.timeMs)
  }

  const candidate = model.times.map((scheduled, index) => updates.get(routeCodes[index]) ?? scheduled)
  for (let index = 1; index < candidate.length; index++) {
    if (candidate[index] <= candidate[index - 1]) return model.times
  }
  return candidate
}

function segmentAt(nowMs: number, times: number[]): { previousIndex: number; nextIndex: number; ratio: number } {
  if (times.length < 2) {
    return { previousIndex: 0, nextIndex: 0, ratio: nowMs >= times[0] ? 1 : 0 }
  }
  if (nowMs <= times[0]) return { previousIndex: 0, nextIndex: 1, ratio: 0 }
  const last = times.length - 1
  if (nowMs >= times[last]) return { previousIndex: last, nextIndex: last, ratio: 1 }

  for (let index = 1; index < times.length; index++) {
    if (nowMs <= times[index]) {
      return {
        previousIndex: index - 1,
        nextIndex: index,
        ratio: clamp((nowMs - times[index - 1]) / (times[index] - times[index - 1])),
      }
    }
  }
  return { previousIndex: last, nextIndex: last, ratio: 1 }
}

function stopStatus(train: SharedTrackedTrain, index: number, times: number[]): LiveTrackerStopStatus | null {
  const station = train.stops[index]
  if (!station) return null
  return {
    code: station.code,
    name: station.name,
    expectedAtMs: Number.isFinite(times[index]) ? Math.round(times[index]) : null,
  }
}

function interpolatePosition(
  train: SharedTrackedTrain,
  segment: ReturnType<typeof segmentAt>,
  map: MetroMapData,
  source: 'trip_update' | 'schedule'
): LiveTrackerPosition | null {
  const points = new Map(map.stations.map(station => [station.code, station]))
  const previous = points.get(train.stops[segment.previousIndex]?.code)
  const next = points.get(train.stops[segment.nextIndex]?.code)
  if (!previous && !next) return null
  if (!previous || !next || segment.previousIndex === segment.nextIndex) {
    const point = previous ?? next!
    return { lat: point.lat, lon: point.lon, bearing: null, source }
  }
  return {
    lat: previous.lat + (next.lat - previous.lat) * segment.ratio,
    lon: previous.lon + (next.lon - previous.lon) * segment.ratio,
    bearing: null,
    source,
  }
}

function vehicleStopIndex(vehicle: RailVehiclePosition, train: SharedTrackedTrain): number {
  if (!vehicle.stopCode) return -1
  const routeCodes = train.stops.map(stop => stop.code)
  return routeCodes.indexOf(canonicalProgressStopCode(vehicle.stopCode, routeCodes))
}

function vehicleHasPassedDestination(
  vehicle: RailVehiclePosition,
  train: SharedTrackedTrain,
  tripProgress: GtfsTripProgress | undefined
): boolean {
  const destinationCode = train.to.code

  // GTFS stop sequences are the strongest signal when both feeds refer to the
  // same trip. A greater current sequence means the destination stop was passed.
  if (
    tripProgress
    && vehicle.currentStopSequence != null
    && normalizeId(vehicle.tripId) === normalizeId(tripProgress.tripId)
  ) {
    const routeCodes = train.stops.map(stop => stop.code)
    const destinationProgress = tripProgress.stops.find(stop =>
      canonicalProgressStopCode(stop.stopCode, routeCodes) === destinationCode
    )
    if (destinationProgress && vehicle.currentStopSequence > destinationProgress.sequence) {
      return true
    }
  }

  // Vehicle feeds can omit a usable sequence. In that case, compare its current
  // stop with the selected travel direction on the canonical line path.
  if (!vehicle.stopCode) return false
  return LINE_PATHS[train.line].some(path => {
    const fromCode = normalizePlatformCode(train.from.code, path)
    const toCode = normalizePlatformCode(destinationCode, path)
    const vehicleCode = normalizePlatformCode(vehicle.stopCode!, path)
    const fromIndex = path.indexOf(fromCode)
    const toIndex = path.indexOf(toCode)
    const vehicleIndex = path.indexOf(vehicleCode)
    if (fromIndex < 0 || toIndex < 0 || vehicleIndex < 0 || fromIndex === toIndex) return false
    return fromIndex < toIndex ? vehicleIndex > toIndex : vehicleIndex < toIndex
  })
}

function phaseFor(
  nowMs: number,
  departureAtMs: number,
  arrivalAtMs: number,
  vehicle: RailVehiclePosition | undefined,
  vehicleIsFresh: boolean,
  vehiclePassedDestination: boolean,
  vehicleStop: number,
  nextIndex: number,
  lastIndex: number
): LiveTrackerPhase {
  if (vehicle && vehicleIsFresh) {
    if (vehiclePassedDestination) return 'arrived'
    if (vehicle.currentStatus === 'STOPPED_AT') {
      return vehicleStop === lastIndex ? 'arrived' : 'at_station'
    }
    if (vehicleStop === lastIndex || nextIndex === lastIndex) return 'arriving'
    return 'in_transit'
  }
  if (nowMs < departureAtMs) return 'not_started'
  if (nowMs >= arrivalAtMs) return 'arrived'
  if (nextIndex === lastIndex && arrivalAtMs - nowMs <= 2 * 60_000) return 'arriving'
  return 'in_transit'
}

function expiredStatus(train: SharedTrackedTrain, trip: SharedTripPayload, nowMs: number): LiveTrackedTrainStatus {
  return {
    id: train.id,
    leg: train.leg,
    line: train.line,
    toward: train.toward,
    tripId: train.tripId ?? null,
    vehicleId: train.vehicleId ?? train.trainId ?? train.trainNumber ?? null,
    from: train.from,
    to: train.to,
    routeStationCodes: train.stops.map(stop => stop.code),
    phase: 'ended',
    previousStop: { code: train.to.code, name: train.to.name, expectedAtMs: train.arrivalAtMs },
    nextStop: null,
    eta: null,
    freshness: {
      updatedAtMs: trip.sharedAtMs,
      ageMs: Math.max(0, nowMs - trip.sharedAtMs),
      isStale: true,
    },
    position: null,
    progress: 1,
    ended: true,
  }
}

function statusForTrain(
  train: SharedTrackedTrain,
  trip: SharedTripPayload,
  nowMs: number,
  positions: RailVehiclePosition[],
  tripUpdates: any[],
  map: MetroMapData
): LiveTrackedTrainStatus {
  const vehicle = findMatchingVehicle(train, positions)
  const tripProgress = train.tripId
    ? getGTFSTripProgress(tripUpdates, train.tripId, nowMs)
    : undefined
  const schedule = buildScheduleModel(train)
  const times = effectiveTimes(train, schedule, tripProgress)
  let segment = segmentAt(nowMs, times)

  const stopIndex = vehicle ? vehicleStopIndex(vehicle, train) : -1
  if (stopIndex >= 0) {
    if (vehicle?.currentStatus === 'STOPPED_AT') {
      segment = {
        previousIndex: stopIndex,
        nextIndex: Math.min(train.stops.length - 1, stopIndex + 1),
        ratio: 0,
      }
    } else if (stopIndex > 0) {
      const timedSegment = segmentAt(nowMs, times)
      segment = {
        previousIndex: stopIndex - 1,
        nextIndex: stopIndex,
        ratio: timedSegment.nextIndex === stopIndex ? timedSegment.ratio : 0.75,
      }
    }
  }

  const lastIndex = train.stops.length - 1
  const routeFractions = schedule.routeFractions
  const previousFraction = routeFractions[segment.previousIndex] ?? 0
  const nextFraction = routeFractions[segment.nextIndex] ?? previousFraction
  const progress = clamp(previousFraction + (nextFraction - previousFraction) * segment.ratio)
  const arrivalAtMs = Math.round(times[lastIndex] ?? train.arrivalAtMs)
  const vehicleAgeMs = vehicle?.timestampMs == null
    ? 0
    : Math.max(0, nowMs - vehicle.timestampMs)
  const vehicleIsFresh = !!vehicle && vehicleAgeMs <= LIVE_STALE_AFTER_MS
  const vehiclePassedDestination = vehicle
    ? vehicleHasPassedDestination(vehicle, train, tripProgress)
    : false
  const phase = phaseFor(
    nowMs,
    times[0] ?? train.departureAtMs,
    arrivalAtMs,
    vehicle,
    vehicleIsFresh,
    vehiclePassedDestination,
    stopIndex,
    segment.nextIndex,
    lastIndex
  )
  const ended = phase === 'arrived' || phase === 'ended'

  const freshnessAtMs = vehicle?.timestampMs ?? (tripProgress ? nowMs : trip.sharedAtMs)
  const ageMs = Math.max(0, nowMs - freshnessAtMs)
  const position: LiveTrackerPosition | null = vehicle
    ? {
        lat: vehicle.latitude,
        lon: vehicle.longitude,
        bearing: vehicle.bearing ?? null,
        source: 'vehicle',
      }
    : interpolatePosition(train, segment, map, tripProgress ? 'trip_update' : 'schedule')

  return {
    id: train.id,
    leg: train.leg,
    line: train.line,
    toward: train.toward,
    tripId: vehicle?.tripId ?? train.tripId ?? null,
    vehicleId: vehicle?.vehicleId
      ?? vehicle?.vehicleLabel
      ?? train.vehicleId
      ?? train.trainId
      ?? train.trainNumber
      ?? null,
    from: train.from,
    to: train.to,
    routeStationCodes: train.stops.map(stop => stop.code),
    phase,
    previousStop: nowMs < times[0] ? null : stopStatus(train, segment.previousIndex, times),
    nextStop: ended ? null : stopStatus(train, segment.nextIndex, times),
    eta: ended ? null : {
      arrivalAtMs,
      minutes: Math.max(0, Math.ceil((arrivalAtMs - nowMs) / 60_000)),
    },
    freshness: {
      updatedAtMs: freshnessAtMs,
      ageMs,
      isStale: !vehicle && !tripProgress ? true : ageMs > LIVE_STALE_AFTER_MS,
    },
    position,
    progress,
    ended,
  }
}

/** Resolve one signed v3 tracking snapshot into a small, polling-friendly status. */
export async function getLiveTrackerResponse(
  trip: SharedTripPayload,
  dependencies: LiveTrackerDependencies = {}
): Promise<LiveTrackerResponse | null> {
  if (!trip.tracking) return null
  const now = dependencies.now ?? Date.now
  const nowMs = now()
  const { tracking } = trip
  const expired = nowMs >= tracking.expiresAtMs

  if (expired) {
    return {
      updatedAtMs: nowMs,
      expiresAtMs: tracking.expiresAtMs,
      expired: true,
      ended: true,
      trains: tracking.trains.map(train => expiredStatus(train, trip, nowMs)),
    }
  }

  const apiKey = dependencies.apiKey ?? process.env.WMATA_API_KEY
  const fetchVehiclePositions = dependencies.fetchVehiclePositions ?? fetchGTFSVehiclePositions
  const fetchTripUpdates = dependencies.fetchTripUpdates ?? fetchGTFSTripUpdates
  const getMapData = dependencies.getMapData ?? getMetroMapData
  const [positions, tripUpdates, map] = await Promise.all([
    apiKey ? fetchVehiclePositions(apiKey).catch(() => []) : Promise.resolve([]),
    apiKey ? fetchTripUpdates(apiKey).catch(() => []) : Promise.resolve([]),
    getMapData(),
  ])
  const trains = tracking.trains.map(train =>
    statusForTrain(train, trip, nowMs, positions, tripUpdates, map)
  )

  return {
    updatedAtMs: nowMs,
    expiresAtMs: tracking.expiresAtMs,
    expired: false,
    ended: trains.every(train => train.ended),
    trains,
  }
}
