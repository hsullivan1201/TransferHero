import type { Train, Line } from '@transferhero/shared'
import { getTrainMinutes, ensureArray, normalizeDestination, getDisplayName } from '@transferhero/shared'
import protobuf from 'protobufjs'
import fetch from 'node-fetch'
import { findStationByCode } from '../data/stations.js'

// cached protobuf root so we don't rebuild it every call
let protoRoot: protobuf.Root | null = null

// wmata api cache layer — keeps us from spamming their servers every second
const PREDICTION_TTL = 15_000  // 15 seconds
const GTFS_TTL = 10_000        // 10 seconds

interface CacheEntry<T> {
  data: T
  ts: number
}

const predictionCache = new Map<string, CacheEntry<Train[]>>()
let gtfsCache: CacheEntry<any[]> | null = null

// cache stats for logging and bragging
let cacheStats = { predictionHits: 0, predictionMisses: 0, gtfsHits: 0, gtfsMisses: 0 }

export function getWmataCacheStats() {
  return { ...cacheStats }
}

export function resetWmataCacheStats() {
  cacheStats = { predictionHits: 0, predictionMisses: 0, gtfsHits: 0, gtfsMisses: 0 }
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

/**
 * Initialize protobuf schema
 */
async function initProto(): Promise<protobuf.Root> {
  if (protoRoot) return protoRoot
  protoRoot = protobuf.Root.fromJSON(GTFS_RT_SCHEMA)
  return protoRoot
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

  cacheStats.predictionMisses++
  const url = `https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${stationCode}`

  const response = await fetch(url, {
    headers: { 'api_key': apiKey }
  })

  if (!response.ok) {
    throw new Error(`WMATA API error: ${response.status}`)
  }

  const data = await response.json() as { Trains?: Train[] }
  const trains = data.Trains || []

  // stash in cache
  predictionCache.set(key, { data: trains, ts: now })

  return trains
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

  cacheStats.gtfsMisses++

  try {
    const root = await initProto()
    const response = await fetch('https://api.wmata.com/gtfs/rail-gtfsrt-tripupdates.pb', {
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
    gtfsCache = { data: entities, ts: now }

    return entities
  } catch (e) {
    console.error('[GTFS] Fetch Error:', e)
    return []
  }
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

  entities.forEach(entity => {
    if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) return

    const trip = entity.tripUpdate.trip
    const updates = entity.tripUpdate.stopTimeUpdate

    // find the stop update (pf_x_y friendly)
    const stopUpdate = updates.find((u: any) => {
      if (!u.stopId) return false
      const parts = u.stopId.split('_')
      const extractedCode = (parts[0] === 'PF') ? parts[1] : parts[0]
      return extractedCode === target
    })

    if (!stopUpdate) return

    const event = stopUpdate.departure || stopUpdate.arrival
    if (!event || !event.time) return

    const time = parseInt(event.time)
    const minutesUntil = Math.floor((time - now) / 60)

    // skip trains that already ghosted
    if (minutesUntil < -1) return

    // pull static trip info if we have it
    const staticInfo = staticTrips[trip.tripId]
    
    // map routeId to line code (GTFS yells "ORANGE", we need "OR")
    const ROUTE_TO_LINE: Record<string, Line> = {
      'ORANGE': 'OR', 'OR': 'OR',
      'SILVER': 'SV', 'SV': 'SV',
      'BLUE': 'BL', 'BL': 'BL',
      'RED': 'RD', 'RD': 'RD',
      'YELLOW': 'YL', 'YL': 'YL',
      'GREEN': 'GR', 'GR': 'GR',
    }
    const rawLine = staticInfo ? staticInfo.line : (trip.routeId || '')
    const line = ROUTE_TO_LINE[rawLine.toUpperCase()] || rawLine as Line
    const destName = staticInfo ? staticInfo.headsign : 'Check Board'

    // filter by allowed lines if provided
    if (allowedLines && allowedLines.length > 0) {
      if (!allowedLines.includes(line)) return
    }

    // filter by terminus/destination
    const normalizedDest = normalizeDestination(destName)
    const normalizedTermini = ensureArray(terminusList).map(t => normalizeDestination(t))

    const matchesTerminus = normalizedTermini.some(term => {
      if (normalizedDest === term) return true
      if (normalizedDest.includes(term) || term.includes(normalizedDest)) return true
      const destFirst = normalizedDest.split(/[\s\-\/]/)[0]
      const termFirst = term.split(/[\s\-\/]/)[0]
      return destFirst === termFirst
    })

    if (!matchesTerminus) return

    relevantTrains.push({
      Line: line as Line,
      DestinationName: getDisplayName(destName),
      Min: minutesUntil <= 0 ? 'ARR' : minutesUntil.toString(),
      Car: '8',
      _gtfs: true,
      _scheduled: false,
      _tripId: trip.tripId
    })
  })

  // dedupe the pile
  const uniqueTrains: Train[] = []
  const seen = new Set<string>()
  relevantTrains.forEach(t => {
    const key = `${t.Line}_${t.Min}_${t.DestinationName}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueTrains.push(t)
    }
  })

  return uniqueTrains
}

interface ArrivalData {
  minutes: number
  timestamp: number  // unix timestamp in ms because dates are hard
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
  const now = Date.now() / 1000
  const target = destinationCode.trim().toUpperCase()

  for (const entity of entities) {
    if (!entity.tripUpdate || !entity.tripUpdate.trip) continue
    if (entity.tripUpdate.trip.tripId !== tripId) continue

    const updates = entity.tripUpdate.stopTimeUpdate || []
    for (const update of updates) {
      if (!update.stopId) continue
      // pf_x_y safe parsing
      const parts = update.stopId.split('_')
      const extractedCode = (parts[0] === 'PF') ? parts[1] : parts[0]

      if (extractedCode === target) {
        const event = update.arrival || update.departure
        if (event?.time) {
          const time = parseInt(event.time)
          return {
            minutes: Math.floor((time - now) / 60),
                timestamp: time * 1000  // convert to milliseconds
          }
        }
      }
    }
  }
  return undefined
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
    if (arrivalData) {
      // prefer the exact GTFS-RT timestamp for clock time
      const arrivalDate = new Date(arrivalData.timestamp)
      return {
        ...train,
        _destArrivalMin: arrivalData.minutes,
        _destArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        _destArrivalTimestamp: arrivalData.timestamp
      }
    }
    return train
  })
}

/**
 * Fetch predictions at destination and match to origin trains
 * WMATA realtime is preferred for displayed times, GTFS-RT used as fallback
 * 
 * @param prefetchedPredictions - Optional pre-fetched predictions to avoid redundant API calls
 */
export async function fetchDestinationArrivals(
  originTrains: Train[],
  destinationCode: string,
  apiKey: string,
  gtfsEntities?: any[],
  prefetchedPredictions?: Train[]
): Promise<Train[]> {
  // reuse prefetched predictions if we have them; otherwise fetch (cache helps)
  const destPredictions = prefetchedPredictions ?? await fetchStationPredictions(destinationCode, apiKey)

  return originTrains.map(train => {
    const originMin = getTrainMinutes(train.Min)

    // prefer WMATA realtime at destination first
    // match by line + destination within a sane travel window
    const minTravelTime = 2  // at least 2 minutes between any two stations
    const maxTravelTime = 45 // cap it so we don't pair nonsense trips

    const matchingTrains = destPredictions.filter(destTrain => {
      if (destTrain.Line !== train.Line) return false
      // must share the same destination name/direction
      if (normalizeDestination(destTrain.DestinationName) !== normalizeDestination(train.DestinationName)) return false

      const destMin = getTrainMinutes(destTrain.Min)
      const impliedTravelTime = destMin - originMin

      // arrival must be after departure with a reasonable travel time
      return impliedTravelTime >= minTravelTime && impliedTravelTime <= maxTravelTime
    })

    if (matchingTrains.length > 0) {
      // sort by arrival time and grab the first
      matchingTrains.sort((a, b) => getTrainMinutes(a.Min) - getTrainMinutes(b.Min))
      const matched = matchingTrains[0]
      const destArrivalMin = getTrainMinutes(matched.Min)

      const arrivalTimestamp = Date.now() + (destArrivalMin * 60 * 1000)
      const arrivalDate = new Date(arrivalTimestamp)

      return {
        ...train,
        _destArrivalMin: destArrivalMin,
        _destArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        _destArrivalTimestamp: arrivalTimestamp,
        _realtimeSource: 'wmata' as const
      }
    }

    // fallback: use GTFS-RT tripId if WMATA didn't have a match
    if (gtfsEntities && train._tripId) {
      const arrivalData = getArrivalAtStation(gtfsEntities, train._tripId, destinationCode)
      if (arrivalData) {
        const arrivalDate = new Date(arrivalData.timestamp)
        return {
          ...train,
          _destArrivalMin: arrivalData.minutes,
          _destArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          _destArrivalTimestamp: arrivalData.timestamp,
          _realtimeSource: 'gtfs-rt' as const
        }
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

  const terminusList = ensureArray(terminus)
  const normalizedTermini = terminusList.map(t => normalizeDestination(t))

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
 * Extract station code from GTFS stop ID (handles pf_x_y format)
 */
function extractStationCode(stopId: string): string {
  const parts = stopId.split('_')
  return (parts[0] === 'PF') ? parts[1] : parts[0]
}

/**
 * find trains that already left the origin by spotting them at the transfer station
 */
export function findDepartedTrains(
  originCode: string,
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
  const terminusList = ensureArray(terminus)
  const normalizedTermini = terminusList.map(t => normalizeDestination(t))

  for (const entity of gtfsEntities) {
    if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue

    const trip = entity.tripUpdate.trip
    const updates = entity.tripUpdate.stopTimeUpdate

    // grab static trip info if available
    const staticInfo = staticTrips[trip.tripId]
    
    // map routeId to line code (GTFS shouts "ORANGE", we want "OR")
    const ROUTE_TO_LINE: Record<string, Line> = {
      'ORANGE': 'OR', 'OR': 'OR',
      'SILVER': 'SV', 'SV': 'SV',
      'BLUE': 'BL', 'BL': 'BL',
      'RED': 'RD', 'RD': 'RD',
      'YELLOW': 'YL', 'YL': 'YL',
      'GREEN': 'GR', 'GR': 'GR',
    }
    const rawTripLine = staticInfo ? staticInfo.line : (trip.routeId || '')
    const tripLine = ROUTE_TO_LINE[rawTripLine.toUpperCase()] || rawTripLine as Line

    // filter by line
    if (tripLine !== line) continue

    // filter by terminus/direction
    const tripDestination = staticInfo ? staticInfo.headsign : ''
    if (tripDestination && normalizedTermini.length > 0) {
      const normalizedDest = normalizeDestination(tripDestination)
      const matchesTerminus = normalizedTermini.some(term => {
        if (normalizedDest === term) return true
        if (normalizedDest.includes(term) || term.includes(normalizedDest)) return true
        const destFirst = normalizedDest.split(/[\s\-\/]/)[0]
        const termFirst = term.split(/[\s\-\/]/)[0]
        return destFirst === termFirst
      })
      if (!matchesTerminus) continue
    }

    // find stop update for the transfer station
    const transferUpdate = updates.find((u: any) => {
      if (!u.stopId) return false
      return extractStationCode(u.stopId) === targetTransfer
    })

    if (!transferUpdate) continue

    const event = transferUpdate.arrival || transferUpdate.departure
    if (!event?.time) continue

    const arrivalAtTransferSec = parseInt(event.time)
    const arrivalAtTransferMin = Math.floor((arrivalAtTransferSec - now) / 60)

    // back into departure time: arrival at transfer minus travel time
    const departureFromOriginSec = arrivalAtTransferSec - (leg1TravelTime * 60)
    const departedMinAgo = Math.floor((now - departureFromOriginSec) / 60)

    // include only trains that actually left (and not ages ago)
    if (departedMinAgo <= 0 || departedMinAgo > 30) continue

    // find the next stop with an arrival time in the future
    let nextStopName: string | undefined
    for (const update of updates) {
      if (!update.stopId) continue
      const stopEvent = update.arrival || update.departure
      if (!stopEvent?.time) continue
      
      const stopTime = parseInt(stopEvent.time)
      // first stop in the future wins
      if (stopTime > now) {
        const nextStopCode = extractStationCode(update.stopId)
        const nextStation = findStationByCode(nextStopCode)
        nextStopName = nextStation?.name
        break
      }
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
      _transferArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
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
    const aMin = typeof a.Min === 'number' ? a.Min : parseInt(String(a.Min))
    const bMin = typeof b.Min === 'number' ? b.Min : parseInt(String(b.Min))
    return bMin - aMin
  })

  return uniqueTrains
}
