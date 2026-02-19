import protobuf from 'protobufjs'
import type { BusPrediction, BusAgencyId } from '@transferhero/shared'
import { getBusDb, stripAgencyPrefix } from './busGtfsLoader.js'
import { fetchWithTimeout } from '../utils/http.js'

// GTFS-RT protobuf schema (same as wmata.ts, extended with vehicle)
const GTFS_RT_SCHEMA = {
  nested: {
    transit_realtime: {
      nested: {
        FeedMessage: { fields: { entity: { rule: 'repeated', type: 'FeedEntity', id: 2 } } },
        FeedEntity: { fields: { tripUpdate: { type: 'TripUpdate', id: 3 } } },
        TripUpdate: {
          fields: {
            trip: { type: 'TripDescriptor', id: 1 },
            stopTimeUpdate: { rule: 'repeated', type: 'StopTimeUpdate', id: 2 },
            vehicle: { type: 'VehicleDescriptor', id: 3 },
          }
        },
        TripDescriptor: {
          fields: {
            tripId: { type: 'string', id: 1 },
            routeId: { type: 'string', id: 5 },
          }
        },
        VehicleDescriptor: {
          fields: {
            id: { type: 'string', id: 1 },
            label: { type: 'string', id: 2 },
          }
        },
        StopTimeUpdate: {
          fields: {
            stopSequence: { type: 'uint32', id: 1 },
            arrival: { type: 'StopEvent', id: 2 },
            departure: { type: 'StopEvent', id: 3 },
            stopId: { type: 'string', id: 4 },
          }
        },
        StopEvent: { fields: { time: { type: 'int64', id: 2 } } },
      }
    }
  }
}

let protoRoot: protobuf.Root | null = null

function initProto(): protobuf.Root {
  if (protoRoot) return protoRoot
  protoRoot = protobuf.Root.fromJSON(GTFS_RT_SCHEMA)
  return protoRoot
}

// Per-agency feed cache (30s TTL)
const FEED_TTL = 30_000
const GTFS_RT_TIMEOUT_MS = 8_000

interface FeedCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entities: any[]
  ts: number
}

const feedCache = new Map<string, FeedCacheEntry>()
const pendingFeedRequests = new Map<string, Promise<any[]>>()

interface TripInfo {
  routeId: string
  headsign: string
}

interface RawPrediction {
  rawTripId: string
  fallbackRouteId: string
  minutes: number
  vehicleId?: string
}

/**
 * Fetch and cache the GTFS-RT TripUpdates feed for an agency.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchFeed(agencyId: BusAgencyId, url: string, headers?: Record<string, string>): Promise<any[]> {
  const now = Date.now()
  const cached = feedCache.get(agencyId)
  if (cached && (now - cached.ts) < FEED_TTL) {
    return cached.entities
  }

  const pending = pendingFeedRequests.get(agencyId)
  if (pending) return pending

  const request = (async () => {
    try {
      const root = initProto()
      const FeedMessage = root.lookupType('transit_realtime.FeedMessage')

      const response = await fetchWithTimeout(url, {
        timeoutMs: GTFS_RT_TIMEOUT_MS,
        headers: headers || {}
      })
      if (!response.ok) {
        console.warn(`[GTFS-RT:${agencyId}] Feed fetch failed: ${response.status}`)
        return cached?.entities ?? []
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const message = FeedMessage.decode(new Uint8Array(buffer))
      const obj = FeedMessage.toObject(message, { longs: Number })

      const entities = obj.entity || []
      feedCache.set(agencyId, { entities, ts: Date.now() })
      return entities
    } catch (err) {
      console.warn(`[GTFS-RT:${agencyId}] Feed fetch failed:`, err)
      return cached?.entities ?? []
    } finally {
      pendingFeedRequests.delete(agencyId)
    }
  })()

  pendingFeedRequests.set(agencyId, request)
  return request
}

function loadTripInfoMap(agencyId: BusAgencyId, rawTripIds: Set<string>): Map<string, TripInfo> {
  const tripInfoByRawId = new Map<string, TripInfo>()
  const busDb = getBusDb()
  if (!busDb || rawTripIds.size === 0) return tripInfoByRawId

  const namespacedTripIds = Array.from(rawTripIds).map(raw => `${agencyId}:${raw}`)
  const placeholders = namespacedTripIds.map(() => '?').join(',')
  const rows = busDb.prepare(
    `SELECT trip_id, route_id, headsign FROM trips WHERE trip_id IN (${placeholders})`
  ).all(...namespacedTripIds) as { trip_id: string; route_id: string; headsign: string }[]

  for (const row of rows) {
    tripInfoByRawId.set(stripAgencyPrefix(row.trip_id), {
      routeId: row.route_id,
      headsign: row.headsign,
    })
  }

  return tripInfoByRawId
}

/**
 * Fetch GTFS-RT bus predictions for a specific stop from an agency's TripUpdates feed.
 *
 * @param agencyId - The agency identifier (e.g. 'art')
 * @param stopId - The namespaced stop ID (e.g. 'art:12345')
 * @param url - The GTFS-RT TripUpdates feed URL
 * @param headers - Optional HTTP headers (e.g. API keys)
 */
export async function fetchGtfsRtBusPredictions(
  agencyId: BusAgencyId,
  stopId: string,
  url: string,
  headers?: Record<string, string>,
): Promise<BusPrediction[]> {
  try {
    const entities = await fetchFeed(agencyId, url, headers)
    const rawStopId = stripAgencyPrefix(stopId)
    if (!rawStopId) return []

    const nowSec = Math.floor(Date.now() / 1000)
    const rawPredictions: RawPrediction[] = []
    const rawTripIds = new Set<string>()

    for (const entity of entities) {
      const tu = entity.tripUpdate
      if (!tu?.stopTimeUpdate) continue

      const rawTripId = String(tu.trip?.tripId || '')
      const fallbackRouteId = tu.trip?.routeId ? `${agencyId}:${tu.trip.routeId}` : ''
      const vehicleId = tu.vehicle?.id || tu.vehicle?.label || undefined

      for (const stu of tu.stopTimeUpdate) {
        if (stu.stopId !== rawStopId) continue

        const arrivalTime = stu.arrival?.time ?? stu.departure?.time
        if (!arrivalTime) continue

        const minutes = Math.round((Number(arrivalTime) - nowSec) / 60)
        if (minutes < -1 || minutes > 120) continue // skip past/far-future

        rawPredictions.push({
          rawTripId,
          fallbackRouteId,
          minutes: Math.max(0, minutes),
          vehicleId,
        })

        if (rawTripId) rawTripIds.add(rawTripId)
      }
    }

    const tripInfoByRawId = loadTripInfoMap(agencyId, rawTripIds)

    const predictions: BusPrediction[] = rawPredictions.map(row => {
      const tripInfo = row.rawTripId ? tripInfoByRawId.get(row.rawTripId) : undefined
      return {
        routeId: tripInfo?.routeId || row.fallbackRouteId,
        directionText: tripInfo?.headsign || '',
        minutes: row.minutes,
        vehicleId: row.vehicleId,
        agencyId,
      }
    })

    predictions.sort((a, b) => a.minutes - b.minutes)
    return predictions
  } catch (err) {
    console.warn(`[GTFS-RT:${agencyId}] Prediction fetch failed for stop ${stopId}:`, err)
    return []
  }
}
