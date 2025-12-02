import type { Train, Line } from '@transferhero/shared'
import { getTrainMinutes, ensureArray, normalizeDestination, getDisplayName } from '@transferhero/shared'
import protobuf from 'protobufjs'
import fetch from 'node-fetch'
import { findStationByCode } from '../data/stations.js'

// Cached protobuf root
let protoRoot: protobuf.Root | null = null

// GTFS-RT Protobuf schema definition
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
 * Fetch station predictions from WMATA API
 */
export async function fetchStationPredictions(
  stationCode: string,
  apiKey: string
): Promise<Train[]> {
  const url = `https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${stationCode}`

  const response = await fetch(url, {
    headers: { 'api_key': apiKey }
  })

  if (!response.ok) {
    throw new Error(`WMATA API error: ${response.status}`)
  }

  const data = await response.json() as { Trains?: Train[] }
  return data.Trains || []
}

/**
 * Fetch GTFS-RT trip updates
 */
export async function fetchGTFSTripUpdates(apiKey: string): Promise<any[]> {
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

    return object.entity || []
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

    // Find matching stop update (handles pf_x_y format)
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

    // Skip trains that have already departed
    if (minutesUntil < -1) return

    // Get static trip info if available
    const staticInfo = staticTrips[trip.tripId]
    const line = staticInfo ? staticInfo.line : (trip.routeId || '')
    const destName = staticInfo ? staticInfo.headsign : 'Check Board'

    // Filter by allowed lines if specified
    if (allowedLines && allowedLines.length > 0) {
      if (!allowedLines.includes(line as Line)) return
    }

    // Filter by terminus/destination
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

  // Deduplicate
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
  timestamp: number  // Unix timestamp in milliseconds
}

/**
 * Get arrival time at a destination station from GTFS-RT data
 * Returns arrival minutes and exact timestamp, or undefined if not found
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
      // Handle pf_x_y format
      const parts = update.stopId.split('_')
      const extractedCode = (parts[0] === 'PF') ? parts[1] : parts[0]

      if (extractedCode === target) {
        const event = update.arrival || update.departure
        if (event?.time) {
          const time = parseInt(event.time)
          return {
            minutes: Math.floor((time - now) / 60),
            timestamp: time * 1000  // Convert to milliseconds
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
      // Use exact timestamp from GTFS-RT for accurate clock time
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
 */
export async function fetchDestinationArrivals(
  originTrains: Train[],
  destinationCode: string,
  apiKey: string,
  gtfsEntities?: any[]
): Promise<Train[]> {
  // Fetch real-time predictions at destination station
  const destPredictions = await fetchStationPredictions(destinationCode, apiKey)

  return originTrains.map(train => {
    const originMin = getTrainMinutes(train.Min)

    // PREFERRED: Try WMATA realtime at destination first
    // Match by Line + Destination + reasonable travel time window
    const minTravelTime = 2  // Minimum 2 minutes between any two stations
    const maxTravelTime = 45 // Maximum reasonable travel time on metro

    const matchingTrains = destPredictions.filter(destTrain => {
      if (destTrain.Line !== train.Line) return false
      // Must have same destination name (same direction)
      if (normalizeDestination(destTrain.DestinationName) !== normalizeDestination(train.DestinationName)) return false

      const destMin = getTrainMinutes(destTrain.Min)
      const impliedTravelTime = destMin - originMin

      // Destination arrival must be after origin departure with reasonable travel time
      return impliedTravelTime >= minTravelTime && impliedTravelTime <= maxTravelTime
    })

    if (matchingTrains.length > 0) {
      // Sort by arrival time and take the first one
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

    // FALLBACK: Use GTFS-RT tripId for accurate matching if no WMATA match
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

    // No reliable match found - don't set _destArrivalMin, let fallback calculation be used
    return train
  })
}

/**
 * Filter API response trains by terminus and optionally by line
 * Also normalizes destination names to display format
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
      // Filter by line if specified
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
 * Find trains that have already departed the origin station
 * by looking for them arriving at the transfer station
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

    // Get static trip info
    const staticInfo = staticTrips[trip.tripId]
    const tripLine = staticInfo ? staticInfo.line : (trip.routeId || '')

    // Filter by line
    if (tripLine !== line) continue

    // Filter by terminus/direction
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

    // Find stop update for transfer station
    const transferUpdate = updates.find((u: any) => {
      if (!u.stopId) return false
      return extractStationCode(u.stopId) === targetTransfer
    })

    if (!transferUpdate) continue

    const event = transferUpdate.arrival || transferUpdate.departure
    if (!event?.time) continue

    const arrivalAtTransferSec = parseInt(event.time)
    const arrivalAtTransferMin = Math.floor((arrivalAtTransferSec - now) / 60)

    // Calculate when train departed origin: arrival at transfer - travel time
    const departureFromOriginSec = arrivalAtTransferSec - (leg1TravelTime * 60)
    const departedMinAgo = Math.floor((now - departureFromOriginSec) / 60)

    // Only include trains that have actually departed (departed > 0) but not too long ago
    if (departedMinAgo <= 0 || departedMinAgo > 30) continue

    // Get next stop - find the first stop with arrival time in the future
    let nextStopName: string | undefined
    for (const update of updates) {
      if (!update.stopId) continue
      const stopEvent = update.arrival || update.departure
      if (!stopEvent?.time) continue
      
      const stopTime = parseInt(stopEvent.time)
      // This stop is in the future - it's the next stop
      if (stopTime > now) {
        const nextStopCode = extractStationCode(update.stopId)
        const nextStation = findStationByCode(nextStopCode)
        nextStopName = nextStation?.name
        break
      }
    }

    // Get destination name
    const destName = staticInfo ? staticInfo.headsign : 'Check Board'

    // Calculate arrival time at transfer
    const arrivalTimestamp = arrivalAtTransferSec * 1000
    const arrivalDate = new Date(arrivalTimestamp)

    departedTrains.push({
      Line: tripLine as Line,
      DestinationName: getDisplayName(destName),
      Min: -departedMinAgo, // Negative = departed X min ago
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

  // Deduplicate by tripId
  const uniqueTrains: Train[] = []
  const seen = new Set<string>()
  for (const train of departedTrains) {
    if (train._tripId && !seen.has(train._tripId)) {
      seen.add(train._tripId)
      uniqueTrains.push(train)
    }
  }

  // Sort by most recently departed first (least negative Min)
  uniqueTrains.sort((a, b) => {
    const aMin = typeof a.Min === 'number' ? a.Min : parseInt(String(a.Min))
    const bMin = typeof b.Min === 'number' ? b.Min : parseInt(String(b.Min))
    return bMin - aMin
  })

  return uniqueTrains
}
