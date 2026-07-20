import type {
  LiveTrackedTrainStatus,
  LiveTrackerApproach,
  LiveTrackerConnection,
  LiveTrackerConnectionAlternative,
  LiveTrackerOtherTrain,
  LiveTrackerPhase,
  LiveTrackerPosition,
  LiveTrackerResponse,
  LiveTrackerStopStatus,
  MetroMapData,
  SharedTrackedTrain,
  SharedTripPayload,
  SharedTripTracking,
  Train,
} from '@transferhero/shared'
import type { Station } from '@transferhero/shared'
import { LINE_PATHS } from '../data/lineConfig.js'
import { getAllPlatformCodes, normalizePlatformCode } from '../data/platformCodes.js'
import { calculateRouteTravelTime } from './travelTime.js'
import { getMetroMapData } from './metroMap.js'
import {
  fetchGTFSTripUpdates,
  fetchGTFSVehiclePositions,
  fetchStationPredictions,
  getGTFSTripProgress,
  type GtfsTripProgress,
  type RailVehiclePosition,
} from './wmata.js'

const LIVE_STALE_AFTER_MS = 30_000
const MAX_APPROACH_STOPS = 8

export interface LiveTrackerDependencies {
  now?: () => number
  apiKey?: string
  fetchVehiclePositions?: (apiKey: string) => Promise<RailVehiclePosition[]>
  fetchTripUpdates?: (apiKey: string) => Promise<any[]>
  fetchStationPredictions?: (stationCode: string, apiKey: string) => Promise<Train[]>
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

function resolveSegment(
  train: SharedTrackedTrain,
  nowMs: number,
  times: number[],
  vehicle: RailVehiclePosition | undefined
): { segment: ReturnType<typeof segmentAt>; stopIndex: number } {
  let segment = segmentAt(nowMs, times)
  const stopIndex = vehicle ? vehicleStopIndex(vehicle, train) : -1
  if (stopIndex < 0) return { segment, stopIndex }

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

  return { segment, stopIndex }
}

function trackerPosition(
  train: SharedTrackedTrain,
  segment: ReturnType<typeof segmentAt>,
  map: MetroMapData,
  vehicle: RailVehiclePosition | undefined,
  tripProgress: GtfsTripProgress | undefined
): LiveTrackerPosition | null {
  if (!vehicle) {
    return interpolatePosition(train, segment, map, tripProgress ? 'trip_update' : 'schedule')
  }
  return {
    lat: vehicle.latitude,
    lon: vehicle.longitude,
    bearing: vehicle.bearing ?? null,
    source: 'vehicle',
    speedMph: vehicle.speedMetersPerSecond != null
      ? Math.round(vehicle.speedMetersPerSecond * 2.23694)
      : null,
  }
}

function trackerVehicleId(
  train: SharedTrackedTrain,
  vehicle: RailVehiclePosition | undefined
): string | null {
  return vehicle?.vehicleId
    ?? vehicle?.vehicleLabel
    ?? train.vehicleId
    ?? train.trainId
    ?? train.trainNumber
    ?? null
}

function trackerFreshnessAt(
  nowMs: number,
  vehicle: RailVehiclePosition | undefined
): number {
  if (vehicle?.timestampMs != null) return vehicle.timestampMs
  // Estimated positions are recomputed from the schedule (or trip updates) on
  // every poll, so their freshness is the poll itself. Pinning freshness to the
  // share's capture time made healthy schedule estimates read as ever-staler.
  return nowMs
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

function mapStationInfo(map: MetroMapData, code: string): Station | null {
  for (const candidate of getAllPlatformCodes(code)) {
    const station = map.stations.find(item => item.code === candidate)
    if (station) return { code, name: station.name, lines: station.lines }
  }
  return null
}

/**
 * The bounded window of upstream stations an inbound train covers before the
 * rider's boarding station, in travel order and ending at the trip origin.
 */
function approachWindow(train: SharedTrackedTrain, map: MetroMapData): Station[] | null {
  const secondCode = train.stops[1]?.code
  if (!secondCode) return null
  for (const path of LINE_PATHS[train.line]) {
    const fromIndex = path.indexOf(normalizePlatformCode(train.from.code, path))
    const nextIndex = path.indexOf(normalizePlatformCode(secondCode, path))
    if (fromIndex < 0 || nextIndex < 0 || fromIndex === nextIndex) continue
    const upstreamCodes = nextIndex > fromIndex
      ? path.slice(Math.max(0, fromIndex - MAX_APPROACH_STOPS), fromIndex)
      : path.slice(fromIndex + 1, fromIndex + 1 + MAX_APPROACH_STOPS).reverse()
    if (upstreamCodes.length === 0) return null
    const upstream = upstreamCodes.map(code => mapStationInfo(map, code))
    if (upstream.some(station => station == null)) return null
    return [...(upstream as Station[]), train.from]
  }
  return null
}

interface ApproachResolution {
  approach: LiveTrackerApproach
  position: LiveTrackerPosition | null
}

/**
 * Locate an inbound train inside its approach window by reusing the same
 * schedule/vehicle machinery that tracks the ride itself: the approach is a
 * synthetic leg that ends at the boarding station when the ride begins.
 */
function resolveApproach(
  train: SharedTrackedTrain,
  originDepartureMs: number,
  nowMs: number,
  vehicle: RailVehiclePosition | undefined,
  tripProgress: GtfsTripProgress | undefined,
  map: MetroMapData
): ApproachResolution | null {
  const stops = approachWindow(train, map)
  if (!stops) return null

  let totalMinutes = 0
  try {
    for (let index = 1; index < stops.length; index++) {
      const minutes = calculateRouteTravelTime(stops[index - 1].code, stops[index].code, train.line)
      if (!Number.isFinite(minutes) || minutes <= 0) return null
      totalMinutes += minutes
    }
  } catch {
    return null
  }
  if (totalMinutes <= 0) return null

  const approachTrain: SharedTrackedTrain = {
    ...train,
    to: train.from,
    stops,
    departureAtMs: originDepartureMs - totalMinutes * 60_000,
    arrivalAtMs: originDepartureMs,
  }
  const schedule = buildScheduleModel(approachTrain)
  const times = effectiveTimes(approachTrain, schedule, tripProgress)
  const { segment } = resolveSegment(approachTrain, nowMs, times, vehicle)
  const previousFraction = schedule.routeFractions[segment.previousIndex] ?? 0
  const nextFraction = schedule.routeFractions[segment.nextIndex] ?? previousFraction
  const progress = clamp(previousFraction + (nextFraction - previousFraction) * segment.ratio)

  return {
    approach: {
      stationCodes: stops.map(stop => stop.code),
      previousStop: nowMs < times[0] ? null : stopStatus(approachTrain, segment.previousIndex, times),
      nextStop: stopStatus(approachTrain, segment.nextIndex, times),
      progress,
    },
    position: trackerPosition(approachTrain, segment, map, vehicle, tripProgress),
  }
}

/**
 * Every other live train on the tracked line, both directions. Placement is
 * topological (the station each train is at or approaching plus the stop just
 * behind it), and direction is expressed relative to the rider's train via
 * their matched vehicle's GTFS direction id.
 */
function otherTrainsOnLine(
  train: SharedTrackedTrain,
  positions: RailVehiclePosition[],
  selectedVehicle: RailVehiclePosition | undefined,
  map: MetroMapData,
  nowMs: number
): LiveTrackerOtherTrain[] {
  const linePaths = LINE_PATHS[train.line]
  const secondCode = train.stops[1]?.code
  let riderOrientation: 1 | -1 | null = null
  if (secondCode) {
    for (const path of linePaths) {
      const fromIndex = path.indexOf(normalizePlatformCode(train.from.code, path))
      const nextIndex = path.indexOf(normalizePlatformCode(secondCode, path))
      if (fromIndex < 0 || nextIndex < 0 || fromIndex === nextIndex) continue
      riderOrientation = nextIndex > fromIndex ? 1 : -1
      break
    }
  }
  const riderDirectionId = selectedVehicle?.directionId ?? null

  // The rider's own train must never ride the map twice. Identity matching
  // covers the case where the tracked ids are known but no vehicle was
  // selected (for example while the position is still schedule-estimated).
  const trackedIds = new Set([
    train.tripId,
    train.vehicleId,
    train.trainId,
    train.trainNumber,
    selectedVehicle?.tripId,
    selectedVehicle?.vehicleId,
    selectedVehicle?.vehicleLabel,
    selectedVehicle?.entityId,
  ].map(normalizeId).filter((id): id is string => id != null))

  const output: LiveTrackerOtherTrain[] = []
  for (const position of positions) {
    if (position === selectedVehicle) continue
    if ([position.tripId, position.vehicleId, position.vehicleLabel, position.entityId]
      .map(normalizeId)
      .some(id => id != null && trackedIds.has(id))) continue
    if (position.line !== train.line) continue
    if (!position.stopCode) continue
    if (position.timestampMs != null && nowMs - position.timestampMs > 90_000) continue

    for (const path of linePaths) {
      const code = canonicalProgressStopCode(position.stopCode, path)
      const index = path.indexOf(code)
      if (index < 0) continue

      const sameDirection = riderDirectionId != null && position.directionId != null
        ? position.directionId === riderDirectionId
        : null
      let prevCode: string | null = null
      let toward: string | null = null
      if (sameDirection != null && riderOrientation != null) {
        const orientation = sameDirection ? riderOrientation : -riderOrientation as 1 | -1
        prevCode = path[index - orientation] ?? null
        const terminalCode = orientation === 1 ? path[path.length - 1] : path[0]
        toward = mapStationInfo(map, terminalCode)?.name ?? null
      }

      output.push({
        id: position.entityId || position.vehicleId || `${train.line}-${output.length}`,
        code,
        approaching: position.currentStatus !== 'STOPPED_AT',
        prevCode,
        sameDirection,
        toward,
      })
      break
    }
    if (output.length >= 40) break
  }
  return output
}

function stationNameTokens(name: string): string[] {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/gu, '').split(/[\s-]+/u).filter(Boolean)
}

interface DownstreamTargets {
  codes: Set<string>
  nameTokens: string[][]
}

/**
 * Every station downstream of the connecting train's boarding platform in its
 * travel direction. WMATA predictions point at destinations (terminals and
 * short-turns), all of which lie downstream, so this is the direction filter
 * for "next trains the rider could actually take".
 */
function downstreamTargets(train: SharedTrackedTrain, map: MetroMapData): DownstreamTargets | null {
  const secondCode = train.stops[1]?.code
  if (!secondCode) return null
  for (const path of LINE_PATHS[train.line]) {
    const fromIndex = path.indexOf(normalizePlatformCode(train.from.code, path))
    const nextIndex = path.indexOf(normalizePlatformCode(secondCode, path))
    if (fromIndex < 0 || nextIndex < 0 || fromIndex === nextIndex) continue
    const downstream = nextIndex > fromIndex
      ? path.slice(fromIndex + 1)
      : path.slice(0, fromIndex)
    const codes = new Set<string>()
    const nameTokens: string[][] = []
    for (const code of downstream) {
      for (const alias of getAllPlatformCodes(code)) codes.add(alias.toUpperCase())
      const info = mapStationInfo(map, code)
      if (info) nameTokens.push(stationNameTokens(info.name))
    }
    return codes.size > 0 ? { codes, nameTokens } : null
  }
  return null
}

/**
 * WMATA prediction destinations are exact codes when present, but the names
 * are often abbreviated ("Branch Av", "Mt Vern Sq"), so name matching accepts
 * every prediction token as a prefix of some token of a downstream station.
 */
function predictionIsDownstream(prediction: Train, targets: DownstreamTargets): boolean {
  const code = typeof prediction.DestinationCode === 'string'
    ? prediction.DestinationCode.trim().toUpperCase()
    : ''
  if (code) return targets.codes.has(code)
  const predictionTokens = stationNameTokens(prediction.DestinationName ?? '')
  if (predictionTokens.length === 0) return false
  return targets.nameTokens.some(stationTokens =>
    predictionTokens.every(token => stationTokens.some(stationToken => stationToken.startsWith(token)))
  )
}

function predictionMinutes(min: Train['Min']): number | null {
  if (typeof min === 'number') return Number.isFinite(min) ? min : null
  const normalized = min.trim().toUpperCase()
  if (normalized === 'BRD' || normalized === 'ARR') return 0
  const parsed = Number.parseInt(normalized, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * The live transfer outlook for a two-leg trip: when leg 1 reaches the
 * transfer versus when the tracked connecting train boards, plus the next
 * same-direction departures in case the rider misses it. Gone once the rider
 * is on the connecting train.
 */
async function resolveConnection(
  configs: SharedTrackedTrain[],
  statuses: LiveTrackedTrainStatus[],
  map: MetroMapData,
  apiKey: string | undefined,
  fetchPredictions: (stationCode: string, apiKey: string) => Promise<Train[]>
): Promise<LiveTrackerConnection | null> {
  const firstConfig = configs.find(train => train.leg === 1)
  const secondConfig = configs.find(train => train.leg === 2)
  if (!firstConfig || !secondConfig) return null
  const firstStatus = statuses.find(status => status.id === firstConfig.id)
  const secondStatus = statuses.find(status => status.id === secondConfig.id)
  if (!secondStatus || secondStatus.ended || secondStatus.phase !== 'not_started') return null

  let alternatives: LiveTrackerConnectionAlternative[] = []
  if (apiKey) {
    try {
      const targets = downstreamTargets(secondConfig, map)
      const predictions = await fetchPredictions(secondConfig.from.code, apiKey)
      alternatives = predictions
        .filter(prediction => prediction.Line === secondConfig.line)
        .filter(prediction => !targets || predictionIsDownstream(prediction, targets))
        .flatMap(prediction => {
          const minutes = predictionMinutes(prediction.Min)
          return minutes == null ? [] : [{
            minutes,
            destinationName: prediction.DestinationName ?? secondConfig.toward,
          }]
        })
        .sort((a, b) => a.minutes - b.minutes)
        .slice(0, 3)
    } catch {
      alternatives = []
    }
  }

  return {
    atCode: secondConfig.from.code,
    atName: secondConfig.from.name,
    line: secondConfig.line,
    toward: secondConfig.toward,
    arrivalAtMs: firstStatus && !firstStatus.ended
      ? firstStatus.eta?.arrivalAtMs ?? null
      : null,
    boardsAtMs: secondStatus.nextStop?.expectedAtMs ?? null,
    alternatives,
  }
}

function expiredStatus(train: SharedTrackedTrain, capturedAtMs: number, nowMs: number): LiveTrackedTrainStatus {
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
      updatedAtMs: capturedAtMs,
      ageMs: Math.max(0, nowMs - capturedAtMs),
      isStale: true,
    },
    position: null,
    progress: 1,
    ended: true,
  }
}

function statusForTrain(
  train: SharedTrackedTrain,
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
  const { segment, stopIndex } = resolveSegment(train, nowMs, times, vehicle)

  const lastIndex = train.stops.length - 1
  const routeFractions = schedule.routeFractions
  const previousFraction = routeFractions[segment.previousIndex] ?? 0
  const nextFraction = routeFractions[segment.nextIndex] ?? previousFraction
  const arrivalAtMs = Math.round(times[lastIndex] ?? train.arrivalAtMs)
  const vehicleAgeMs = vehicle?.timestampMs == null
    ? 0
    : Math.max(0, nowMs - vehicle.timestampMs)
  const vehicleIsFresh = !!vehicle && vehicleAgeMs <= LIVE_STALE_AFTER_MS
  const vehiclePassedDestination = vehicle
    ? vehicleHasPassedDestination(vehicle, train, tripProgress)
    : false
  // Before the scheduled departure, a matched vehicle that is not yet at any
  // tracked stop is still inbound to the origin. Riders see that as a train
  // they are waiting to board, not one that is mid-ride.
  const notStarted = nowMs < (times[0] ?? train.departureAtMs)
    && (!vehicleIsFresh || stopIndex < 0)
    && !vehiclePassedDestination
  const phase = notStarted ? 'not_started' : phaseFor(
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
  const progress = notStarted
    ? 0
    : clamp(previousFraction + (nextFraction - previousFraction) * segment.ratio)

  const freshnessAtMs = trackerFreshnessAt(nowMs, vehicle)
  const ageMs = Math.max(0, nowMs - freshnessAtMs)
  const approachResolution = notStarted
    ? resolveApproach(train, Math.round(times[0] ?? train.departureAtMs), nowMs, vehicle, tripProgress, map)
    : null
  const position = approachResolution?.position
    ?? trackerPosition(train, segment, map, vehicle, tripProgress)

  return {
    id: train.id,
    leg: train.leg,
    line: train.line,
    toward: train.toward,
    tripId: vehicle?.tripId ?? train.tripId ?? null,
    vehicleId: trackerVehicleId(train, vehicle),
    from: train.from,
    to: train.to,
    routeStationCodes: train.stops.map(stop => stop.code),
    phase,
    previousStop: notStarted || nowMs < times[0] ? null : stopStatus(train, segment.previousIndex, times),
    nextStop: ended ? null : notStarted ? stopStatus(train, 0, times) : stopStatus(train, segment.nextIndex, times),
    eta: ended ? null : {
      arrivalAtMs,
      minutes: Math.max(0, Math.ceil((arrivalAtMs - nowMs) / 60_000)),
    },
    freshness: {
      updatedAtMs: freshnessAtMs,
      ageMs,
      isStale: ageMs > LIVE_STALE_AFTER_MS,
    },
    position,
    progress,
    approach: approachResolution?.approach ?? null,
    stopExpectedAtMs: times.map(time => (Number.isFinite(time) ? Math.round(time) : null)),
    otherTrains: otherTrainsOnLine(train, positions, vehicle, map, nowMs),
    ended,
  }
}

/**
 * Resolve a bounded set of tracked trains into a polling-friendly status.
 * Works for signed shares and for ad-hoc in-app tracking alike.
 */
export async function resolveTrackingStatus(
  tracking: SharedTripTracking,
  capturedAtMs: number,
  dependencies: LiveTrackerDependencies = {}
): Promise<LiveTrackerResponse> {
  const now = dependencies.now ?? Date.now
  const nowMs = now()
  const expired = nowMs >= tracking.expiresAtMs

  if (expired) {
    return {
      updatedAtMs: nowMs,
      expiresAtMs: tracking.expiresAtMs,
      expired: true,
      ended: true,
      trains: tracking.trains.map(train => expiredStatus(train, capturedAtMs, nowMs)),
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
    statusForTrain(train, nowMs, positions, tripUpdates, map)
  )
  const connection = await resolveConnection(
    tracking.trains,
    trains,
    map,
    apiKey,
    dependencies.fetchStationPredictions ?? fetchStationPredictions
  )

  return {
    updatedAtMs: nowMs,
    expiresAtMs: tracking.expiresAtMs,
    expired: false,
    ended: trains.every(train => train.ended),
    trains,
    connection,
  }
}

/** Resolve one signed v3 tracking snapshot into a small, polling-friendly status. */
export async function getLiveTrackerResponse(
  trip: SharedTripPayload,
  dependencies: LiveTrackerDependencies = {}
): Promise<LiveTrackerResponse | null> {
  if (!trip.tracking) return null
  return resolveTrackingStatus(trip.tracking, trip.sharedAtMs, dependencies)
}
