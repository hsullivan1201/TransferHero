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
const WMATA_REQUEST_TIMEOUT_MS = 8_000
const GTFS_REQUEST_TIMEOUT_MS = 10_000

interface CacheEntry<T> {
  data: T
  ts: number
}

const predictionCache = new Map<string, CacheEntry<Train[]>>()
let gtfsCache: CacheEntry<any[]> | null = null

// In-flight request coalescing so concurrent misses do not stampede upstream.
const pendingPredictionRequests = new Map<string, Promise<Train[]>>()
let pendingGtfsRequest: Promise<any[]> | null = null

// cache stats for logging and bragging
let cacheStats = { predictionHits: 0, predictionMisses: 0, gtfsHits: 0, gtfsMisses: 0 }
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
}

let upstreamStats: WmataUpstreamMutableStats = {
  startedAt: Date.now(),
  predictions: { total: 0, failures: 0, recentTimestamps: [] },
  gtfs: { total: 0, failures: 0, recentTimestamps: [] }
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

function recordUpstreamCall(kind: 'predictions' | 'gtfs'): void {
  const now = Date.now()
  const counter = upstreamStats[kind]
  counter.total++
  counter.recentTimestamps.push(now)
  pruneOldTimestamps(counter, now)
}

function recordUpstreamFailure(kind: 'predictions' | 'gtfs'): void {
  upstreamStats[kind].failures++
}

export function getWmataCacheStats() {
  return { ...cacheStats }
}

export function resetWmataCacheStats() {
  cacheStats = { predictionHits: 0, predictionMisses: 0, gtfsHits: 0, gtfsMisses: 0 }
}

export function getWmataUpstreamStats(): WmataUpstreamStats {
  const now = Date.now()
  pruneOldTimestamps(upstreamStats.predictions, now)
  pruneOldTimestamps(upstreamStats.gtfs, now)

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
    }
  }
}

export function resetWmataUpstreamStats(): void {
  upstreamStats = {
    startedAt: Date.now(),
    predictions: { total: 0, failures: 0, recentTimestamps: [] },
    gtfs: { total: 0, failures: 0, recentTimestamps: [] }
  }
}

// GTFS-RT protobuf schema definition
const GTFS_RT_SCHEMA = {
  nested: {
    transit_realtime: {
      nested: {
        FeedMessage: { fields: { entity: { rule: 'repeated', type: 'FeedEntity', id: 2 } } },
        FeedEntity: { fields: { tripUpdate: { type: 'TripUpdate', id: 3 } } },
        TripUpdate: {
          fields: {
            trip: { type: 'TripDescriptor', id: 1 },
            stopTimeUpdate: { rule: 'repeated', type: 'StopTimeUpdate', id: 2 }
          }
        },
        TripDescriptor: {
          fields: {
            tripId: { type: 'string', id: 1 },
            routeId: { type: 'string', id: 5 }
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
