import { ROUTE_TO_LINE, type Line } from '@transferhero/shared'
import protobuf from 'protobufjs'
import { fetchWithTimeout } from '../utils/http.js'

const VEHICLE_POSITION_TTL = 5_000
const GTFS_REQUEST_TIMEOUT_MS = 10_000
const RAIL_VEHICLE_POSITIONS_URL = 'https://api.wmata.com/gtfs/rail-gtfsrt-vehiclepositions.pb'
const ONE_MINUTE_MS = 60_000
const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS

const VEHICLE_POSITION_SCHEMA = {
  nested: {
    transit_realtime: {
      nested: {
        FeedMessage: { fields: { entity: { rule: 'repeated', type: 'FeedEntity', id: 2 } } },
        FeedEntity: {
          fields: {
            id: { type: 'string', id: 1 },
            vehicle: { type: 'VehiclePosition', id: 4 },
          },
        },
        TripDescriptor: {
          fields: {
            tripId: { type: 'string', id: 1 },
            startTime: { type: 'string', id: 2 },
            startDate: { type: 'string', id: 3 },
            routeId: { type: 'string', id: 5 },
            directionId: { type: 'uint32', id: 6 },
          },
        },
        VehicleDescriptor: {
          fields: {
            id: { type: 'string', id: 1 },
            label: { type: 'string', id: 2 },
          },
        },
        Position: {
          fields: {
            latitude: { type: 'float', id: 1 },
            longitude: { type: 'float', id: 2 },
            bearing: { type: 'float', id: 3 },
            odometer: { type: 'double', id: 4 },
            speed: { type: 'float', id: 5 },
          },
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
            multiCarriageDetails: { rule: 'repeated', type: 'CarriageDetails', id: 11 },
          },
          nested: {
            VehicleStopStatus: {
              values: { INCOMING_AT: 0, STOPPED_AT: 1, IN_TRANSIT_TO: 2 },
            },
            CongestionLevel: {
              values: {
                UNKNOWN_CONGESTION_LEVEL: 0,
                RUNNING_SMOOTHLY: 1,
                STOP_AND_GO: 2,
                CONGESTION: 3,
                SEVERE_CONGESTION: 4,
              },
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
                NOT_BOARDABLE: 8,
              },
            },
            CarriageDetails: {
              fields: {
                id: { type: 'string', id: 1 },
                label: { type: 'string', id: 2 },
                occupancyStatus: { type: 'OccupancyStatus', id: 3 },
                occupancyPercentage: { type: 'int32', id: 4 },
                carriageSequence: { type: 'uint32', id: 5 },
              },
            },
          },
        },
      },
    },
  },
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

export interface VehiclePositionUpstreamStats {
  callsTotal: number
  callsLastMinute: number
  callsLastFiveMinutes: number
  failures: number
}

interface CacheEntry {
  data: RailVehiclePosition[]
  ts: number
}

interface RollingRequestCounter {
  total: number
  failures: number
  recentTimestamps: number[]
}

let protoRoot: protobuf.Root | null = null
let vehiclePositionCache: CacheEntry | null = null
let pendingVehiclePositionRequest: Promise<RailVehiclePosition[]> | null = null
let cacheStats = { vehiclePositionHits: 0, vehiclePositionMisses: 0 }
let upstreamStats: RollingRequestCounter = { total: 0, failures: 0, recentTimestamps: [] }

function initProto(): protobuf.Root {
  if (protoRoot) return protoRoot
  protoRoot = protobuf.Root.fromJSON(VEHICLE_POSITION_SCHEMA)
  return protoRoot
}

function extractStationCode(stopId: string): string {
  const parts = stopId.split('_')
  return parts[0] === 'PF' ? parts[1] : parts[0]
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
  'IN_TRANSIT_TO',
]
const VEHICLE_STOP_STATUS_BY_NUMBER: Record<number, RailVehicleStopStatus> = {
  0: 'INCOMING_AT',
  1: 'STOPPED_AT',
  2: 'IN_TRANSIT_TO',
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
  'NOT_BOARDABLE',
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
  8: 'NOT_BOARDABLE',
}

const CONGESTION_LEVELS: readonly RailVehicleCongestionLevel[] = [
  'UNKNOWN_CONGESTION_LEVEL',
  'RUNNING_SMOOTHLY',
  'STOP_AND_GO',
  'CONGESTION',
  'SEVERE_CONGESTION',
]
const CONGESTION_LEVEL_BY_NUMBER: Record<number, RailVehicleCongestionLevel> = {
  0: 'UNKNOWN_CONGESTION_LEVEL',
  1: 'RUNNING_SMOOTHLY',
  2: 'STOP_AND_GO',
  3: 'CONGESTION',
  4: 'SEVERE_CONGESTION',
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

const MAX_PLAUSIBLE_RAIL_SPEED_MPS = 36 // ≈ 80 mph
const MIN_SPEED_SAMPLE_GAP_MS = 4_000
const MAX_SPEED_SAMPLE_GAP_MS = 120_000

interface SpeedSample {
  latitude: number
  longitude: number
  timestampMs: number
  speedMetersPerSecond?: number
}

const speedHistory = new Map<string, SpeedSample>()

function haversineMeters(a: SpeedSample, b: RailVehiclePosition): number {
  const toRadians = (value: number) => value * Math.PI / 180
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * sinLon * sinLon
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * WMATA leaves GTFS-RT `position.speed` empty, so estimate it from the
 * distance between each vehicle's consecutive GPS fixes. Estimates outside
 * plausible rail speeds (bad fixes, teleports) are dropped rather than shown.
 */
export function deriveVehicleSpeeds(positions: RailVehiclePosition[], nowMs: number): void {
  for (const position of positions) {
    const key = position.vehicleId ?? position.vehicleLabel ?? position.entityId
    if (!key || position.timestampMs == null) continue
    const previous = speedHistory.get(key)

    if (position.speedMetersPerSecond == null && previous) {
      const gapMs = position.timestampMs - previous.timestampMs
      if (gapMs === 0) {
        // Same fix as last time; carry the previous estimate forward.
        position.speedMetersPerSecond = previous.speedMetersPerSecond
      } else if (gapMs >= MIN_SPEED_SAMPLE_GAP_MS && gapMs <= MAX_SPEED_SAMPLE_GAP_MS) {
        const speed = haversineMeters(previous, position) / (gapMs / 1000)
        if (speed <= MAX_PLAUSIBLE_RAIL_SPEED_MPS) position.speedMetersPerSecond = speed
      }
    }

    if (!previous || position.timestampMs > previous.timestampMs) {
      speedHistory.set(key, {
        latitude: position.latitude,
        longitude: position.longitude,
        timestampMs: position.timestampMs,
        speedMetersPerSecond: position.speedMetersPerSecond,
      })
    }
  }

  for (const [key, sample] of speedHistory) {
    if (nowMs - sample.timestampMs > FIVE_MINUTES_MS) speedHistory.delete(key)
  }
}

/** Normalize decoded entities, excluding entries without usable WGS-84 coordinates. */
export function parseGTFSVehiclePositions(entities: any[]): RailVehiclePosition[] {
  const positions: RailVehiclePosition[] = []

  for (const entity of entities) {
    const vehiclePosition = entity?.vehicle
    const rawPosition = vehiclePosition?.position
    if (!rawPosition) continue

    const latitude = optionalFiniteNumber(rawPosition.latitude)
    const longitude = optionalFiniteNumber(rawPosition.longitude)
    if (
      latitude === undefined || longitude === undefined
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
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
        carriageSequence: optionalFiniteNumber(carriage?.carriageSequence),
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
      carriages,
    })
  }

  return positions
}

function pruneOldTimestamps(now: number): void {
  const cutoff = now - FIVE_MINUTES_MS
  while (upstreamStats.recentTimestamps.length > 0 && upstreamStats.recentTimestamps[0] < cutoff) {
    upstreamStats.recentTimestamps.shift()
  }
}

function callsInWindow(now: number, windowMs: number): number {
  const cutoff = now - windowMs
  let index = 0
  while (
    index < upstreamStats.recentTimestamps.length
    && upstreamStats.recentTimestamps[index] < cutoff
  ) index++
  return upstreamStats.recentTimestamps.length - index
}

function recordUpstreamCall(): void {
  const now = Date.now()
  upstreamStats.total++
  upstreamStats.recentTimestamps.push(now)
  pruneOldTimestamps(now)
}

export function getVehiclePositionCacheStats() {
  return { ...cacheStats }
}

export function resetVehiclePositionCacheStats(): void {
  cacheStats = { vehiclePositionHits: 0, vehiclePositionMisses: 0 }
}

export function getVehiclePositionUpstreamStats(): VehiclePositionUpstreamStats {
  const now = Date.now()
  pruneOldTimestamps(now)
  return {
    callsTotal: upstreamStats.total,
    callsLastMinute: callsInWindow(now, ONE_MINUTE_MS),
    callsLastFiveMinutes: callsInWindow(now, FIVE_MINUTES_MS),
    failures: upstreamStats.failures,
  }
}

export function resetVehiclePositionUpstreamStats(): void {
  upstreamStats = { total: 0, failures: 0, recentTimestamps: [] }
}

/** Fetch, normalize, cache, and coalesce WMATA rail vehicle positions. */
export async function fetchGTFSVehiclePositions(
  apiKey: string,
  dependencies: WmataVehiclePositionDependencies = {}
): Promise<RailVehiclePosition[]> {
  const now = dependencies.now ?? Date.now
  const cached = vehiclePositionCache

  if (cached && now() - cached.ts < VEHICLE_POSITION_TTL) {
    cacheStats.vehiclePositionHits++
    return cached.data
  }
  if (pendingVehiclePositionRequest) return pendingVehiclePositionRequest

  cacheStats.vehiclePositionMisses++
  const fetcher = dependencies.fetcher ?? fetchWithTimeout
  pendingVehiclePositionRequest = (async () => {
    try {
      recordUpstreamCall()
      const response = await fetcher(RAIL_VEHICLE_POSITIONS_URL, {
        timeoutMs: GTFS_REQUEST_TIMEOUT_MS,
        headers: { api_key: apiKey },
      })
      if (!response.ok) {
        throw new Error(`GTFS-RT vehicle positions fetch error: ${response.status}`)
      }

      const FeedMessage = initProto().lookupType('transit_realtime.FeedMessage')
      const message = FeedMessage.decode(new Uint8Array(await response.arrayBuffer()))
      const object = FeedMessage.toObject(message, { longs: String, enums: String })
      const entities = Array.isArray(object.entity) ? object.entity : []
      const positions = parseGTFSVehiclePositions(entities)
      deriveVehicleSpeeds(positions, now())
      vehiclePositionCache = { data: positions, ts: now() }
      return positions
    } catch (error) {
      upstreamStats.failures++
      console.error('[GTFS] Vehicle positions fetch error:', error)
      return cached?.data ?? []
    } finally {
      pendingVehiclePositionRequest = null
    }
  })()

  return pendingVehiclePositionRequest
}

/** Clears the rail position data cache; primarily useful for isolated tests. */
export function resetWmataVehiclePositionCache(): void {
  vehiclePositionCache = null
}
