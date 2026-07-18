import type { Train, Line } from '@transferhero/shared'
import { getTrainMinutes, ensureArray, normalizeDestination, getDisplayName, ROUTE_TO_LINE } from '@transferhero/shared'
import protobuf from 'protobufjs'
import { findStationByCode } from '../data/stations.js'
import { fetchWithTimeout } from '../utils/http.js'

// cached protobuf root so we don't rebuild it every call
let protoRoot: protobuf.Root | null = null

// wmata api cache layer — keeps us from spamming their servers every second
const PREDICTION_TTL = 15_000  // 15 seconds
const GTFS_TTL = 10_000        // 10 seconds
const VEHICLE_POSITION_TTL = 5_000 // position feeds update quickly; cap upstream at 12 calls/minute
const WMATA_REQUEST_TIMEOUT_MS = 8_000
const GTFS_REQUEST_TIMEOUT_MS = 10_000
const RAIL_VEHICLE_POSITIONS_URL = 'https://api.wmata.com/gtfs/rail-gtfsrt-vehiclepositions.pb'

interface CacheEntry<T> {
  data: T
  ts: number
}

const predictionCache = new Map<string, CacheEntry<Train[]>>()
let gtfsCache: CacheEntry<any[]> | null = null
let vehiclePositionCache: CacheEntry<RailVehiclePosition[]> | null = null

// In-flight request coalescing so concurrent misses do not stampede upstream.
const pendingPredictionRequests = new Map<string, Promise<Train[]>>()
let pendingGtfsRequest: Promise<any[]> | null = null
let pendingVehiclePositionRequest: Promise<RailVehiclePosition[]> | null = null

// cache stats for logging and bragging
let cacheStats = {
  predictionHits: 0,
  predictionMisses: 0,
  gtfsHits: 0,
  gtfsMisses: 0,
  vehiclePositionHits: 0,
  vehiclePositionMisses: 0
}
const ONE_MINUTE_MS = 60_000
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS

interface RollingRequestCounter {
  total: number
  failures: number
  recentTimestamps: number[]
}

interface WmataUpstreamMutableStats {
  startedAt: number
  predictions: RollingRequestCounter
  gtfs: RollingRequestCounter
  vehiclePositions: RollingRequestCounter
}

export interface WmataUpstreamStats {
  startedAt: string
  predictions: {
    callsTotal: number
    callsLastMinute: number
    callsLastFiveMinutes: number
    failures: number
  }
  gtfs: {
    callsTotal: number
    callsLastMinute: number
    callsLastFiveMinutes: number
    failures: number
  }
  vehiclePositions: {
    callsTotal: number
    callsLastMinute: number
    callsLastFiveMinutes: number
    failures: number
  }
}

let upstreamStats: WmataUpstreamMutableStats = {
  startedAt: Date.now(),
  predictions: { total: 0, failures: 0, recentTimestamps: [] },
  gtfs: { total: 0, failures: 0, recentTimestamps: [] },
  vehiclePositions: { total: 0, failures: 0, recentTimestamps: [] }
}

function pruneOldTimestamps(counter: RollingRequestCounter, now: number): void {
  const cutoff = now - FIVE_MINUTES_MS
  while (counter.recentTimestamps.length > 0 && counter.recentTimestamps[0] < cutoff) {
    counter.recentTimestamps.shift()
  }
}

function countCallsInWindow(counter: RollingRequestCounter, now: number, windowMs: number): number {
  const cutoff = now - windowMs
  let index = 0
  while (index < counter.recentTimestamps.length && counter.recentTimestamps[index] < cutoff) {
    index++
  }
  return counter.recentTimestamps.length - index
}

function recordUpstreamCall(kind: 'predictions' | 'gtfs' | 'vehiclePositions'): void {
  const now = Date.now()
  const counter = upstreamStats[kind]
  counter.total++
  counter.recentTimestamps.push(now)
  pruneOldTimestamps(counter, now)
}

function recordUpstreamFailure(kind: 'predictions' | 'gtfs' | 'vehiclePositions'): void {
  upstreamStats[kind].failures++
}

export function getWmataCacheStats() {
  return { ...cacheStats }
}

export function resetWmataCacheStats() {
  cacheStats = {
    predictionHits: 0,
    predictionMisses: 0,
    gtfsHits: 0,
    gtfsMisses: 0,
    vehiclePositionHits: 0,
    vehiclePositionMisses: 0
  }
}

export function getWmataUpstreamStats(): WmataUpstreamStats {
  const now = Date.now()
  pruneOldTimestamps(upstreamStats.predictions, now)
  pruneOldTimestamps(upstreamStats.gtfs, now)
  pruneOldTimestamps(upstreamStats.vehiclePositions, now)

  return {
    startedAt: new Date(upstreamStats.startedAt).toISOString(),
    predictions: {
      callsTotal: upstreamStats.predictions.total,
      callsLastMinute: countCallsInWindow(upstreamStats.predictions, now, ONE_MINUTE_MS),
      callsLastFiveMinutes: countCallsInWindow(upstreamStats.predictions, now, FIVE_MINUTES_MS),
      failures: upstreamStats.predictions.failures
    },
    gtfs: {
      callsTotal: upstreamStats.gtfs.total,
      callsLastMinute: countCallsInWindow(upstreamStats.gtfs, now, ONE_MINUTE_MS),
      callsLastFiveMinutes: countCallsInWindow(upstreamStats.gtfs, now, FIVE_MINUTES_MS),
      failures: upstreamStats.gtfs.failures
    },
    vehiclePositions: {
      callsTotal: upstreamStats.vehiclePositions.total,
      callsLastMinute: countCallsInWindow(upstreamStats.vehiclePositions, now, ONE_MINUTE_MS),
      callsLastFiveMinutes: countCallsInWindow(upstreamStats.vehiclePositions, now, FIVE_MINUTES_MS),
      failures: upstreamStats.vehiclePositions.failures
    }
  }
}

export function resetWmataUpstreamStats(): void {
  upstreamStats = {
    startedAt: Date.now(),
    predictions: { total: 0, failures: 0, recentTimestamps: [] },
    gtfs: { total: 0, failures: 0, recentTimestamps: [] },
    vehiclePositions: { total: 0, failures: 0, recentTimestamps: [] }
  }
}

// GTFS-RT protobuf schema definition
const GTFS_RT_SCHEMA = {
  nested: {
    transit_realtime: {
      nested: {
        FeedMessage: { fields: { entity: { rule: 'repeated', type: 'FeedEntity', id: 2 } } },
        FeedEntity: {
          fields: {
            id: { type: 'string', id: 1 },
            tripUpdate: { type: 'TripUpdate', id: 3 },
            vehicle: { type: 'VehiclePosition', id: 4 }
          }
        },
        TripUpdate: {
          fields: {
            trip: { type: 'TripDescriptor', id: 1 },
            stopTimeUpdate: { rule: 'repeated', type: 'StopTimeUpdate', id: 2 },
            vehicle: { type: 'VehicleDescriptor', id: 3 }
          }
        },
        TripDescriptor: {
          fields: {
            tripId: { type: 'string', id: 1 },
            startTime: { type: 'string', id: 2 },
            startDate: { type: 'string', id: 3 },
            routeId: { type: 'string', id: 5 },
            directionId: { type: 'uint32', id: 6 }
          }
        },
        VehicleDescriptor: {
          fields: {
            id: { type: 'string', id: 1 },
            label: { type: 'string', id: 2 }
          }
        },
        Position: {
          fields: {
            latitude: { type: 'float', id: 1 },
            longitude: { type: 'float', id: 2 },
            bearing: { type: 'float', id: 3 },
            odometer: { type: 'double', id: 4 },
            speed: { type: 'float', id: 5 }
          }
        },
        VehiclePosition: {
          fields: {
            trip: { type: 'TripDescriptor', id: 1 },
            position: { type: 'Position', id: 2 },
            currentStopSequence: { type: 'uint32', id: 3 },
            currentStatus: { type: 'VehicleStopStatus', id: 4 },
            timestamp: { type: 'uint64', id: 5 },
            congestionLevel: { type: 'CongestionLevel', id: 6 },
            stopId: { type: 'string', id: 7 },
            vehicle: { type: 'VehicleDescriptor', id: 8 },
            occupancyStatus: { type: 'OccupancyStatus', id: 9 },
            occupancyPercentage: { type: 'uint32', id: 10 },
            multiCarriageDetails: { rule: 'repeated', type: 'CarriageDetails', id: 11 }
          },
          nested: {
            VehicleStopStatus: {
              values: { INCOMING_AT: 0, STOPPED_AT: 1, IN_TRANSIT_TO: 2 }
            },
            CongestionLevel: {
              values: {
                UNKNOWN_CONGESTION_LEVEL: 0,
                RUNNING_SMOOTHLY: 1,
                STOP_AND_GO: 2,
                CONGESTION: 3,
                SEVERE_CONGESTION: 4
              }
            },
            OccupancyStatus: {
              values: {
                EMPTY: 0,
                MANY_SEATS_AVAILABLE: 1,
                FEW_SEATS_AVAILABLE: 2,
                STANDING_ROOM_ONLY: 3,
                CRUSHED_STANDING_ROOM_ONLY: 4,
                FULL: 5,
                NOT_ACCEPTING_PASSENGERS: 6,
                NO_DATA_AVAILABLE: 7,
                NOT_BOARDABLE: 8
              }
            },
            CarriageDetails: {
              fields: {
                id: { type: 'string', id: 1 },
                label: { type: 'string', id: 2 },
                occupancyStatus: { type: 'OccupancyStatus', id: 3 },
                occupancyPercentage: { type: 'int32', id: 4 },
                carriageSequence: { type: 'uint32', id: 5 }
              }
            }
          }
        },
        StopTimeUpdate: {
          fields: {
            stopSequence: { type: 'uint32', id: 1 },
            arrival: { type: 'StopEvent', id: 2 },
            departure: { type: 'StopEvent', id: 3 },
            stopId: { type: 'string', id: 4 }
          }
        },
        StopEvent: { fields: { time: { type: 'int64', id: 2 } } }
      }
    }
  }
}

export type RailVehicleStopStatus = 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO'

export type RailVehicleOccupancyStatus =
  | 'EMPTY'
  | 'MANY_SEATS_AVAILABLE'
  | 'FEW_SEATS_AVAILABLE'
  | 'STANDING_ROOM_ONLY'
  | 'CRUSHED_STANDING_ROOM_ONLY'
  | 'FULL'
  | 'NOT_ACCEPTING_PASSENGERS'
  | 'NO_DATA_AVAILABLE'
  | 'NOT_BOARDABLE'

export type RailVehicleCongestionLevel =
  | 'UNKNOWN_CONGESTION_LEVEL'
  | 'RUNNING_SMOOTHLY'
  | 'STOP_AND_GO'
  | 'CONGESTION'
  | 'SEVERE_CONGESTION'

export interface RailCarriageDetails {
  id?: string
  label?: string
  occupancyStatus?: RailVehicleOccupancyStatus
  occupancyPercentage?: number
  carriageSequence?: number
}

/** Normalized position from WMATA's rail GTFS-RT VehiclePositions feed. */
export interface RailVehiclePosition {
  entityId: string
  tripId?: string
  routeId?: string
  line?: Line
  directionId?: number
  startTime?: string
  startDate?: string
  vehicleId?: string
  vehicleLabel?: string
  latitude: number
  longitude: number
  bearing?: number
  odometerMeters?: number
  speedMetersPerSecond?: number
  currentStopSequence?: number
  stopId?: string
  stopCode?: string
  currentStatus: RailVehicleStopStatus
  /** Unix timestamp in milliseconds. */
  timestampMs?: number
  congestionLevel?: RailVehicleCongestionLevel
  occupancyStatus?: RailVehicleOccupancyStatus
  occupancyPercentage?: number
  carriages: RailCarriageDetails[]
}

export type WmataVehiclePositionFetcher = (
  url: string,
  options: { timeoutMs: number; headers: Record<string, string> }
) => Promise<{
  ok: boolean
  status: number
  arrayBuffer: () => Promise<ArrayBuffer>
}>

export interface WmataVehiclePositionDependencies {
  fetcher?: WmataVehiclePositionFetcher
  now?: () => number
}

interface ArrivalData {
  minutes: number
  timestamp: number  // unix timestamp in ms because dates are hard
}

interface GtfsStopEvent {
  stopCode: string
  timeSec: number
  sequence: number
}

interface IndexedTripUpdate {
  tripId: string
  routeId: string
  stopEvents: GtfsStopEvent[]
  stopByCode: Map<string, GtfsStopEvent>
}

interface GtfsIndex {
  byTripId: Map<string, IndexedTripUpdate>
  byStation: Map<string, IndexedTripUpdate[]>
}

export interface GtfsTripProgressStop {
  stopCode: string
  timeMs: number
  sequence: number
}

export interface GtfsTripProgress {
  tripId: string
  routeId: string
  stops: GtfsTripProgressStop[]
  previousStop?: GtfsTripProgressStop
  nextStop?: GtfsTripProgressStop
}

// Per-entity-array memoized index. WeakMap avoids leaks across cache rotations.
const gtfsIndexCache = new WeakMap<any[], GtfsIndex>()

/**
 * Initialize protobuf schema
 */
async function initProto(): Promise<protobuf.Root> {
  if (protoRoot) return protoRoot
  protoRoot = protobuf.Root.fromJSON(GTFS_RT_SCHEMA)
  return protoRoot
}

/**
 * Extract station code from GTFS stop ID (handles pf_x_y format)
 */
function extractStationCode(stopId: string): string {
  const parts = stopId.split('_')
  return (parts[0] === 'PF') ? parts[1] : parts[0]
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const VEHICLE_STOP_STATUSES: readonly RailVehicleStopStatus[] = [
  'INCOMING_AT',
  'STOPPED_AT',
  'IN_TRANSIT_TO'
]
const VEHICLE_STOP_STATUS_BY_NUMBER: Record<number, RailVehicleStopStatus> = {
  0: 'INCOMING_AT',
  1: 'STOPPED_AT',
  2: 'IN_TRANSIT_TO'
}

const OCCUPANCY_STATUSES: readonly RailVehicleOccupancyStatus[] = [
  'EMPTY',
  'MANY_SEATS_AVAILABLE',
  'FEW_SEATS_AVAILABLE',
  'STANDING_ROOM_ONLY',
  'CRUSHED_STANDING_ROOM_ONLY',
  'FULL',
  'NOT_ACCEPTING_PASSENGERS',
  'NO_DATA_AVAILABLE',
  'NOT_BOARDABLE'
]
const OCCUPANCY_STATUS_BY_NUMBER: Record<number, RailVehicleOccupancyStatus> = {
  0: 'EMPTY',
  1: 'MANY_SEATS_AVAILABLE',
  2: 'FEW_SEATS_AVAILABLE',
  3: 'STANDING_ROOM_ONLY',
  4: 'CRUSHED_STANDING_ROOM_ONLY',
  5: 'FULL',
  6: 'NOT_ACCEPTING_PASSENGERS',
  7: 'NO_DATA_AVAILABLE',
  8: 'NOT_BOARDABLE'
}

const CONGESTION_LEVELS: readonly RailVehicleCongestionLevel[] = [
  'UNKNOWN_CONGESTION_LEVEL',
  'RUNNING_SMOOTHLY',
  'STOP_AND_GO',
  'CONGESTION',
  'SEVERE_CONGESTION'
]
const CONGESTION_LEVEL_BY_NUMBER: Record<number, RailVehicleCongestionLevel> = {
  0: 'UNKNOWN_CONGESTION_LEVEL',
  1: 'RUNNING_SMOOTHLY',
  2: 'STOP_AND_GO',
  3: 'CONGESTION',
  4: 'SEVERE_CONGESTION'
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  byNumber: Record<number, T>
): T | undefined {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T
  const numericValue = optionalFiniteNumber(value)
  return numericValue === undefined ? undefined : byNumber[numericValue]
}

/**
 * Normalize already-decoded GTFS-RT vehicle entities. Entries without usable WGS-84
 * coordinates are ignored because they cannot be rendered on the live map.
 */
export function parseGTFSVehiclePositions(entities: any[]): RailVehiclePosition[] {
  const positions: RailVehiclePosition[] = []

  for (const entity of entities) {
    const vehiclePosition = entity?.vehicle
    const rawPosition = vehiclePosition?.position
    if (!rawPosition) continue

    const latitude = optionalFiniteNumber(rawPosition.latitude)
    const longitude = optionalFiniteNumber(rawPosition.longitude)
    if (
      latitude === undefined || longitude === undefined ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
    ) continue

    const trip = vehiclePosition.trip
    const vehicle = vehiclePosition.vehicle
    const tripId = optionalString(trip?.tripId)
    const routeId = optionalString(trip?.routeId)
    const vehicleId = optionalString(vehicle?.id)
    const vehicleLabel = optionalString(vehicle?.label)
    const stopId = optionalString(vehiclePosition.stopId)
    const timestampSec = optionalFiniteNumber(vehiclePosition.timestamp)
    const occupancyPercentage = optionalFiniteNumber(vehiclePosition.occupancyPercentage)

    const rawCarriages = Array.isArray(vehiclePosition.multiCarriageDetails)
      ? vehiclePosition.multiCarriageDetails
      : []
    const carriages: RailCarriageDetails[] = rawCarriages.map((carriage: any) => {
      const carriageOccupancyPercentage = optionalFiniteNumber(carriage?.occupancyPercentage)
      return {
        id: optionalString(carriage?.id),
        label: optionalString(carriage?.label),
        occupancyStatus: normalizeEnum(
          carriage?.occupancyStatus,
          OCCUPANCY_STATUSES,
          OCCUPANCY_STATUS_BY_NUMBER
        ),
        occupancyPercentage: carriageOccupancyPercentage !== undefined && carriageOccupancyPercentage >= 0
          ? carriageOccupancyPercentage
          : undefined,
        carriageSequence: optionalFiniteNumber(carriage?.carriageSequence)
      }
    })

    positions.push({
      entityId: optionalString(entity?.id) ?? vehicleId ?? tripId ?? '',
      tripId,
      routeId,
      line: routeId ? ROUTE_TO_LINE[routeId.toUpperCase()] : undefined,
      directionId: optionalFiniteNumber(trip?.directionId),
      startTime: optionalString(trip?.startTime),
      startDate: optionalString(trip?.startDate),
      vehicleId,
      vehicleLabel,
      latitude,
      longitude,
      bearing: optionalFiniteNumber(rawPosition.bearing),
      odometerMeters: optionalFiniteNumber(rawPosition.odometer),
      speedMetersPerSecond: optionalFiniteNumber(rawPosition.speed),
      currentStopSequence: optionalFiniteNumber(vehiclePosition.currentStopSequence),
      stopId,
      stopCode: stopId ? extractStationCode(stopId).trim().toUpperCase() : undefined,
      currentStatus: normalizeEnum(
        vehiclePosition.currentStatus,
        VEHICLE_STOP_STATUSES,
        VEHICLE_STOP_STATUS_BY_NUMBER
      ) ?? 'IN_TRANSIT_TO',
      timestampMs: timestampSec === undefined ? undefined : timestampSec * 1000,
      congestionLevel: normalizeEnum(
        vehiclePosition.congestionLevel,
        CONGESTION_LEVELS,
        CONGESTION_LEVEL_BY_NUMBER
      ),
      occupancyStatus: normalizeEnum(
        vehiclePosition.occupancyStatus,
        OCCUPANCY_STATUSES,
        OCCUPANCY_STATUS_BY_NUMBER
      ),
      occupancyPercentage: occupancyPercentage !== undefined && occupancyPercentage >= 0
        ? occupancyPercentage
        : undefined,
      carriages
    })
  }

  return positions
}

function normalizeTermini(terminus: string | string[]): string[] {
  return ensureArray(terminus).map(t => normalizeDestination(t))
}

function matchesTerminusDestination(normalizedDestination: string, normalizedTermini: string[]): boolean {
  return normalizedTermini.some(term => {
    if (normalizedDestination === term) return true
    if (normalizedDestination.includes(term) || term.includes(normalizedDestination)) return true
    const destFirst = normalizedDestination.split(/[\s\-\/]/)[0]
    const termFirst = term.split(/[\s\-\/]/)[0]
    return destFirst === termFirst
  })
}

function getGtfsIndex(entities: any[]): GtfsIndex {
  const cached = gtfsIndexCache.get(entities)
  if (cached) return cached

  const byTripId = new Map<string, IndexedTripUpdate>()
  const byStation = new Map<string, IndexedTripUpdate[]>()

  for (const entity of entities) {
    const tripUpdate = entity?.tripUpdate
    const trip = tripUpdate?.trip
    const tripId = trip?.tripId
    if (!tripId) continue

    const updates = Array.isArray(tripUpdate?.stopTimeUpdate) ? tripUpdate.stopTimeUpdate : []
    if (updates.length === 0) continue

    const stopEvents: GtfsStopEvent[] = []
    const stopByCode = new Map<string, GtfsStopEvent>()

    for (const update of updates) {
      const stopId = update?.stopId
      if (!stopId) continue

      const event = update.departure ?? update.arrival
      const timeSec = Number.parseInt(String(event?.time ?? ''), 10)
      if (!Number.isFinite(timeSec)) continue

      const stopCode = extractStationCode(String(stopId)).trim().toUpperCase()
      if (!stopCode) continue

      const sequenceRaw = Number.parseInt(String(update?.stopSequence ?? ''), 10)
      const sequence = Number.isFinite(sequenceRaw) ? sequenceRaw : stopEvents.length

      const stopEvent: GtfsStopEvent = { stopCode, timeSec, sequence }
      stopEvents.push(stopEvent)

      // Keep earliest sequence for each stop code to mirror "first match" behavior.
      const existing = stopByCode.get(stopCode)
      if (!existing || stopEvent.sequence < existing.sequence) {
        stopByCode.set(stopCode, stopEvent)
      }
    }

    if (stopEvents.length === 0) continue

    stopEvents.sort((a, b) => {
      if (a.sequence !== b.sequence) return a.sequence - b.sequence
      return a.timeSec - b.timeSec
    })

    const indexedTrip: IndexedTripUpdate = {
      tripId,
      routeId: String(trip?.routeId ?? ''),
      stopEvents,
      stopByCode
    }

    byTripId.set(tripId, indexedTrip)

    for (const stopCode of stopByCode.keys()) {
      const list = byStation.get(stopCode)
      if (list) list.push(indexedTrip)
      else byStation.set(stopCode, [indexedTrip])
    }
  }

  const index: GtfsIndex = { byTripId, byStation }
  gtfsIndexCache.set(entities, index)
  return index
}

/**
 * Fetch station predictions from WMATA API (with caching)
 */
export async function fetchStationPredictions(
  stationCode: string,
  apiKey: string
): Promise<Train[]> {
  const key = stationCode.toUpperCase()
  const now = Date.now()

  // check cache first
  const cached = predictionCache.get(key)
  if (cached && (now - cached.ts) < PREDICTION_TTL) {
    cacheStats.predictionHits++
    return cached.data
  }

  const pending = pendingPredictionRequests.get(key)
  if (pending) {
    return pending
  }

  cacheStats.predictionMisses++
  const url = `https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${stationCode}`

  const request = (async () => {
    try {
      recordUpstreamCall('predictions')
      const response = await fetchWithTimeout(url, {
        timeoutMs: WMATA_REQUEST_TIMEOUT_MS,
        headers: { 'api_key': apiKey }
      })

      if (!response.ok) {
        throw new Error(`WMATA API error: ${response.status}`)
      }

      const data = await response.json() as { Trains?: Train[] }
      const trains = data.Trains || []

      // stash in cache
      predictionCache.set(key, { data: trains, ts: Date.now() })
      return trains
    } catch (error) {
      recordUpstreamFailure('predictions')
      if (cached) {
        console.warn(`[WMATA] prediction fetch failed for ${key}, serving stale cache`, error)
        return cached.data
      }
      throw error
    } finally {
      pendingPredictionRequests.delete(key)
    }
  })()

  pendingPredictionRequests.set(key, request)
  return request
}

/**
 * Fetch GTFS-RT trip updates (with caching)
 */
export async function fetchGTFSTripUpdates(apiKey: string): Promise<any[]> {
  const now = Date.now()

  // check cache first
  if (gtfsCache && (now - gtfsCache.ts) < GTFS_TTL) {
    cacheStats.gtfsHits++
    return gtfsCache.data
  }

  if (pendingGtfsRequest) {
    return pendingGtfsRequest
  }

  cacheStats.gtfsMisses++

  pendingGtfsRequest = (async () => {
    try {
      const root = await initProto()
      recordUpstreamCall('gtfs')
      const response = await fetchWithTimeout('https://api.wmata.com/gtfs/rail-gtfsrt-tripupdates.pb', {
        timeoutMs: GTFS_REQUEST_TIMEOUT_MS,
        headers: { 'api_key': apiKey }
      })

      if (!response.ok) {
        throw new Error(`GTFS-RT fetch error: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      const FeedMessage = root.lookupType('transit_realtime.FeedMessage')
      const message = FeedMessage.decode(new Uint8Array(buffer))
      const object = FeedMessage.toObject(message, { longs: String })

      const entities = object.entity || []

      // stash in cache
      gtfsCache = { data: entities, ts: Date.now() }

      return entities
    } catch (e) {
      recordUpstreamFailure('gtfs')
      console.error('[GTFS] Fetch Error:', e)
      // Stale GTFS is better than nothing when upstream blips.
      return gtfsCache?.data ?? []
    } finally {
      pendingGtfsRequest = null
    }
  })()

  return pendingGtfsRequest
}

/**
 * Fetch WMATA rail GTFS-RT vehicle positions. The normalized result is cached
 * independently from trip updates and concurrent refreshes share one request.
 */
export async function fetchGTFSVehiclePositions(
  apiKey: string,
  dependencies: WmataVehiclePositionDependencies = {}
): Promise<RailVehiclePosition[]> {
  const now = dependencies.now ?? Date.now
  const cached = vehiclePositionCache

  if (cached && (now() - cached.ts) < VEHICLE_POSITION_TTL) {
    cacheStats.vehiclePositionHits++
    return cached.data
  }

  if (pendingVehiclePositionRequest) return pendingVehiclePositionRequest

  cacheStats.vehiclePositionMisses++
  const fetcher = dependencies.fetcher ?? fetchWithTimeout

  pendingVehiclePositionRequest = (async () => {
    try {
      const root = await initProto()
      recordUpstreamCall('vehiclePositions')
      const response = await fetcher(RAIL_VEHICLE_POSITIONS_URL, {
        timeoutMs: GTFS_REQUEST_TIMEOUT_MS,
        headers: { 'api_key': apiKey }
      })

      if (!response.ok) {
        throw new Error(`GTFS-RT vehicle positions fetch error: ${response.status}`)
      }

      const buffer = await response.arrayBuffer()
      const FeedMessage = root.lookupType('transit_realtime.FeedMessage')
      const message = FeedMessage.decode(new Uint8Array(buffer))
      const object = FeedMessage.toObject(message, { longs: String, enums: String })
      const entities = Array.isArray(object.entity) ? object.entity : []
      const positions = parseGTFSVehiclePositions(entities)

      vehiclePositionCache = { data: positions, ts: now() }
      return positions
    } catch (error) {
      recordUpstreamFailure('vehiclePositions')
      console.error('[GTFS] Vehicle positions fetch error:', error)
      // Keep the tracker useful through a brief WMATA outage.
      return cached?.data ?? []
    } finally {
      pendingVehiclePositionRequest = null
    }
  })()

  return pendingVehiclePositionRequest
}

/** Clears the rail position cache; primarily useful for isolated tests. */
export function resetWmataVehiclePositionCache(): void {
  vehiclePositionCache = null
}

/**
 * Parse GTFS-RT entities to train format
 */
export function parseUpdatesToTrains(
  entities: any[],
  stationCode: string,
  terminusList: string[],
  staticTrips: Record<string, { line: string; headsign: string }> = {},
  allowedLines?: Line[]
): Train[] {
  const relevantTrains: Train[] = []
  const now = Date.now() / 1000
  const target = stationCode.trim().toUpperCase()
  const normalizedTermini = normalizeTermini(terminusList)
  const allowedSet = allowedLines && allowedLines.length > 0 ? new Set(allowedLines) : null

  const index = getGtfsIndex(entities)
  const tripsAtStation = index.byStation.get(target) ?? []

  for (const trip of tripsAtStation) {
    const stopEvent = trip.stopByCode.get(target)
    if (!stopEvent) continue

    const minutesUntil = Math.floor((stopEvent.timeSec - now) / 60)

    // skip trains that already ghosted
    if (minutesUntil < -1) continue

    // pull static trip info if we have it
    const staticInfo = staticTrips[trip.tripId]

    const rawLine = staticInfo ? staticInfo.line : (trip.routeId || '')
    const line = ROUTE_TO_LINE[rawLine.toUpperCase()] || rawLine as Line
    const destName = staticInfo ? staticInfo.headsign : 'Check Board'

    // filter by allowed lines if provided
    if (allowedSet && !allowedSet.has(line)) continue

    // filter by terminus/destination
    const normalizedDest = normalizeDestination(destName)
    if (!matchesTerminusDestination(normalizedDest, normalizedTermini)) continue

    relevantTrains.push({
      Line: line as Line,
      DestinationName: getDisplayName(destName),
      Min: minutesUntil <= 0 ? 'ARR' : minutesUntil.toString(),
      Car: '8',
      _gtfs: true,
      _scheduled: false,
      _tripId: trip.tripId
    })
  }

  // dedupe the pile
  const uniqueTrains: Train[] = []
  const seen = new Set<string>()
  for (const t of relevantTrains) {
    const key = `${t.Line}_${t.Min}_${t.DestinationName}`
    if (seen.has(key)) continue
    seen.add(key)
    uniqueTrains.push(t)
  }

  return uniqueTrains
}

/**
 * get arrival time at a destination from GTFS-RT.
 * returns minutes + exact timestamp, or undefined if we can't find it.
 */
export function getArrivalAtStation(
  entities: any[],
  tripId: string,
  destinationCode: string
): ArrivalData | undefined {
  if (!tripId) return undefined

  const now = Date.now() / 1000
  const target = destinationCode.trim().toUpperCase()
  const index = getGtfsIndex(entities)

  const trip = index.byTripId.get(tripId)
  if (!trip) return undefined

  const stopEvent = trip.stopByCode.get(target)
  if (!stopEvent) return undefined

  return {
    minutes: Math.floor((stopEvent.timeSec - now) / 60),
    timestamp: stopEvent.timeSec * 1000  // convert to milliseconds
  }
}

/**
 * Return ordered, normalized stop progress for one GTFS trip update.
 * `previousStop` is the latest timed stop at or before `nowMs`; `nextStop`
 * is the first timed stop after it.
 */
export function getGTFSTripProgress(
  entities: any[],
  tripId: string,
  nowMs: number = Date.now()
): GtfsTripProgress | undefined {
  if (!tripId || !Number.isFinite(nowMs)) return undefined

  const trip = getGtfsIndex(entities).byTripId.get(tripId)
  if (!trip) return undefined

  const stops: GtfsTripProgressStop[] = trip.stopEvents.map(stop => ({
    stopCode: stop.stopCode,
    timeMs: stop.timeSec * 1000,
    sequence: stop.sequence
  }))

  let previousStop: GtfsTripProgressStop | undefined
  let nextStop: GtfsTripProgressStop | undefined

  for (const stop of stops) {
    if (stop.timeMs <= nowMs) previousStop = stop
    else {
      nextStop = stop
      break
    }
  }

  return {
    tripId: trip.tripId,
    routeId: trip.routeId,
    stops,
    previousStop,
    nextStop
  }
}

/**
 * Enrich trains with destination arrival times from GTFS-RT
 */
export function enrichTrainsWithDestinationArrival(
  trains: Train[],
  entities: any[],
  destinationCode: string
): Train[] {
  return trains.map(train => {
    if (!train._tripId) return train

    const arrivalData = getArrivalAtStation(entities, train._tripId, destinationCode)
    if (!arrivalData) return train

    // prefer the exact GTFS-RT timestamp for clock time
    const arrivalDate = new Date(arrivalData.timestamp)
    return {
      ...train,
      _destArrivalMin: arrivalData.minutes,
      _destArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
      _destArrivalTimestamp: arrivalData.timestamp
    }
  })
}

/**
 * Fetch predictions at destination and match to origin trains.
 * GTFS-RT trip ID match is tried first (exact), then WMATA prediction matching.
 *
 * @param prefetchedPredictions - Optional pre-fetched predictions to avoid redundant API calls
 * @param expectedTravelTime - Optional expected travel time in minutes; tightens the WMATA
 *   matching window to [expected-5, expected+10] and sorts by proximity instead of earliest
 */
export async function fetchDestinationArrivals(
  originTrains: Train[],
  destinationCode: string,
  apiKey: string,
  gtfsEntities?: any[],
  prefetchedPredictions?: Train[],
  expectedTravelTime?: number
): Promise<Train[]> {
  // reuse prefetched predictions if we have them; otherwise fetch (cache helps)
  const destPredictions = prefetchedPredictions ?? await fetchStationPredictions(destinationCode, apiKey)

  // Pre-bucket destination predictions to avoid O(origin * destination) filter+sort churn.
  const bucketedDestinations = new Map<string, { train: Train; min: number }[]>()
  for (const destTrain of destPredictions) {
    const key = `${destTrain.Line}|${normalizeDestination(destTrain.DestinationName)}`
    const list = bucketedDestinations.get(key)
    const entry = { train: destTrain, min: getTrainMinutes(destTrain.Min) }
    if (list) list.push(entry)
    else bucketedDestinations.set(key, [entry])
  }

  return originTrains.map(train => {
    const originMin = getTrainMinutes(train.Min)

    // prefer GTFS-RT trip ID match first (exact train tracking, most reliable)
    if (gtfsEntities && train._tripId) {
      const arrivalData = getArrivalAtStation(gtfsEntities, train._tripId, destinationCode)
      if (arrivalData) {
        const arrivalDate = new Date(arrivalData.timestamp)
        return {
          ...train,
          _destArrivalMin: arrivalData.minutes,
          _destArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
          _destArrivalTimestamp: arrivalData.timestamp,
          _realtimeSource: 'gtfs-rt' as const
        }
      }
    }

    // fallback: WMATA realtime matching by line + destination within a travel window
    // when expectedTravelTime is provided, tighten the window (trains can be delayed but rarely early)
    const minTravelTime = expectedTravelTime ? Math.max(2, expectedTravelTime - 5) : 2
    const maxTravelTime = expectedTravelTime ? expectedTravelTime + 10 : 45

    const key = `${train.Line}|${normalizeDestination(train.DestinationName)}`
    const candidates = bucketedDestinations.get(key) ?? []

    let bestMatch: { min: number } | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const candidate of candidates) {
      const impliedTravelTime = candidate.min - originMin
      if (impliedTravelTime < minTravelTime || impliedTravelTime > maxTravelTime) continue

      const score = expectedTravelTime
        ? Math.abs(impliedTravelTime - expectedTravelTime)
        : candidate.min

      if (score < bestScore) {
        bestScore = score
        bestMatch = candidate
      }
    }

    if (bestMatch) {
      const destArrivalMin = bestMatch.min
      const arrivalTimestamp = Date.now() + (destArrivalMin * 60 * 1000)
      const arrivalDate = new Date(arrivalTimestamp)

      return {
        ...train,
        _destArrivalMin: destArrivalMin,
        _destArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
        _destArrivalTimestamp: arrivalTimestamp,
        _realtimeSource: 'wmata' as const
      }
    }

    // no reliable match—leave _destArrivalMin alone and let the fallback math run
    return train
  })
}

/**
 * filter API trains by terminus (and optionally line), normalizing destinations
 */
export function filterApiResponse(
  trains: Train[],
  terminus: string | string[],
  allowedLines?: Line[]
): Train[] {
  if (!trains || trains.length === 0) return []

  const normalizedTermini = normalizeTermini(terminus)

  return trains
    .filter(train => {
      // optionally filter by line
      if (allowedLines && allowedLines.length > 0) {
        if (!allowedLines.includes(train.Line)) return false
      }

      const dest = (train as any).Destination || train.DestinationName || ''
      if (!dest || dest === 'No Passenger' || dest === 'Train' || dest === 'ssenger' || dest === '---') {
        return false
      }

      const normalizedDest = normalizeDestination(dest)
      const normalizedDestName = normalizeDestination(train.DestinationName)

      return normalizedTermini.some(term => {
        if (normalizedDest === term || normalizedDestName === term) return true
        if (normalizedDest.includes(term) || term.includes(normalizedDest) ||
            normalizedDestName.includes(term) || term.includes(normalizedDestName)) return true
        const destFirst = normalizedDest.split(/[\s\-\/]/)[0]
        const termFirst = term.split(/[\s\-\/]/)[0]
        return destFirst === termFirst
      })
    })
    .map(train => ({
      ...train,
      DestinationName: getDisplayName(train.DestinationName)
    }))
}

/**
 * find trains that already left the origin by spotting them at the transfer station
 */
export function findDepartedTrains(
  transferCode: string,
  line: Line,
  leg1TravelTime: number,
  gtfsEntities: any[],
  staticTrips: Record<string, { line: string; headsign: string }> = {},
  terminus: string | string[] = []
): Train[] {
  const departedTrains: Train[] = []
  const now = Date.now() / 1000
  const targetTransfer = transferCode.trim().toUpperCase()
  const normalizedTermini = normalizeTermini(terminus)

  const index = getGtfsIndex(gtfsEntities)
  const candidates = index.byStation.get(targetTransfer) ?? []

  for (const trip of candidates) {
    // grab static trip info if available
    const staticInfo = staticTrips[trip.tripId]

    const rawTripLine = staticInfo ? staticInfo.line : (trip.routeId || '')
    const tripLine = ROUTE_TO_LINE[rawTripLine.toUpperCase()] || rawTripLine as Line

    // filter by line
    if (tripLine !== line) continue

    // filter by terminus/direction
    const tripDestination = staticInfo ? staticInfo.headsign : ''
    if (tripDestination && normalizedTermini.length > 0) {
      const normalizedDest = normalizeDestination(tripDestination)
      if (!matchesTerminusDestination(normalizedDest, normalizedTermini)) continue
    }

    const transferStop = trip.stopByCode.get(targetTransfer)
    if (!transferStop) continue

    const arrivalAtTransferSec = transferStop.timeSec
    const arrivalAtTransferMin = Math.floor((arrivalAtTransferSec - now) / 60)

    // back into departure time: arrival at transfer minus travel time
    const departureFromOriginSec = arrivalAtTransferSec - (leg1TravelTime * 60)
    const departedMinAgo = Math.floor((now - departureFromOriginSec) / 60)

    // include only trains that actually left (and not ages ago)
    if (departedMinAgo <= 0 || departedMinAgo > 30) continue

    // find the next stop with an arrival time in the future
    let nextStopName: string | undefined
    for (const stopEvent of trip.stopEvents) {
      if (stopEvent.timeSec <= now) continue
      const nextStation = findStationByCode(stopEvent.stopCode)
      nextStopName = nextStation?.name
      break
    }

    // destination name
    const destName = staticInfo ? staticInfo.headsign : 'Check Board'

    // arrival time at transfer
    const arrivalTimestamp = arrivalAtTransferSec * 1000
    const arrivalDate = new Date(arrivalTimestamp)

    departedTrains.push({
      Line: tripLine as Line,
      DestinationName: getDisplayName(destName),
      Min: -departedMinAgo, // negative = departed X min ago
      Car: '8',
      _gtfs: true,
      _scheduled: false,
      _tripId: trip.tripId,
      _departed: true,
      _nextStop: nextStopName,
      _transferArrivalMin: arrivalAtTransferMin,
      _transferArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
      _transferArrivalTimestamp: arrivalTimestamp
    })
  }

  // dedupe by tripId
  const uniqueTrains: Train[] = []
  const seen = new Set<string>()
  for (const train of departedTrains) {
    if (train._tripId && !seen.has(train._tripId)) {
      seen.add(train._tripId)
      uniqueTrains.push(train)
    }
  }

  // sort by most recently departed first (least negative Min)
  uniqueTrains.sort((a, b) => {
    const aMin = typeof a.Min === 'number' ? a.Min : parseInt(String(a.Min), 10)
    const bMin = typeof b.Min === 'number' ? b.Min : parseInt(String(b.Min), 10)
    return bMin - aMin
  })

  return uniqueTrains
}
