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

interface TripInfo {
  routeId: string
  headsign: string
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
  feedCache.set(agencyId, { entities, ts: now })
  return entities
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
    const nowSec = Math.floor(Date.now() / 1000)

    // Lookup trip info from SQLite for route_id and headsign
    const busDb = getBusDb()
    const tripInfoCache = new Map<string, TripInfo | null>()

    function getTripInfo(rawTripId: string): TripInfo | null {
      if (tripInfoCache.has(rawTripId)) return tripInfoCache.get(rawTripId)!
      if (!busDb) { tripInfoCache.set(rawTripId, null); return null }
      const namespacedTripId = `${agencyId}:${rawTripId}`
      const row = busDb.prepare(
        'SELECT route_id, headsign FROM trips WHERE trip_id = ?'
      ).get(namespacedTripId) as { route_id: string; headsign: string } | undefined
      const info = row ? { routeId: row.route_id, headsign: row.headsign } : null
      tripInfoCache.set(rawTripId, info)
      return info
    }

    const predictions: BusPrediction[] = []

    for (const entity of entities) {
      const tu = entity.tripUpdate
      if (!tu?.stopTimeUpdate) continue

      for (const stu of tu.stopTimeUpdate) {
        if (stu.stopId !== rawStopId) continue

        const arrivalTime = stu.arrival?.time ?? stu.departure?.time
        if (!arrivalTime) continue

        const minutes = Math.round((Number(arrivalTime) - nowSec) / 60)
        if (minutes < -1 || minutes > 120) continue // skip past/far-future

        const rawTripId = tu.trip?.tripId || ''
        const tripInfo = getTripInfo(rawTripId)
        const vehicleId = tu.vehicle?.id || tu.vehicle?.label || undefined

        predictions.push({
          routeId: tripInfo?.routeId || (tu.trip?.routeId ? `${agencyId}:${tu.trip.routeId}` : ''),
          directionText: tripInfo?.headsign || '',
          minutes: Math.max(0, minutes),
          vehicleId,
          agencyId,
        })
      }
    }

    predictions.sort((a, b) => a.minutes - b.minutes)
    return predictions
  } catch (err) {
    console.warn(`[GTFS-RT:${agencyId}] Prediction fetch failed for stop ${stopId}:`, err)
    return []
  }
}
