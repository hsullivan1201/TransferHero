import type { BusStop, HybridTrip } from '@transferhero/shared'
import { getBusRoutes, getRouteStopSequences, getStopRoutes, getBusStops, getBusTrips } from './busGtfsLoader.js'
import { queryNearbyStops, getBusStopStations, haversineMeters } from './busStopIndex.js'
import { getNextScheduledDepartures, getScheduledRideMinutes, getNextDeparture } from './busScheduleIndex.js'
import { findTransfer } from './pathfinding.js'
import { calculateRouteTravelTime } from './travelTime.js'
import { getAllExits } from './stationService.js'
import { ALL_STATIONS } from '../data/stations.js'

const SEARCH_RADIUS_M = 400
const WALK_SPEED_MPS = 1.33
const GRID_FACTOR = 1.4
const BUS_MIN_PER_STOP = 1 // DC urban average (~10-12mph, stops every 1-2 blocks)
const MAX_RESULTS = 7
const MAX_SEARCH_STOPS = 5 // check up to 5 Metro-connected stops per route direction
const AVG_METRO_WAIT = 3 // half of typical ~6 min headway
const AVG_BUS_WAIT = 8 // fallback bus wait when no schedule data
const DEFAULT_TRANSFER_WALK = 2 // minutes to walk between platforms

// O(1) station lookup
const STATION_BY_CODE = new Map(ALL_STATIONS.map(s => [s.code, s]))

// Station centroid cache (avg of exit coordinates) for metro time estimates
let stationCentroids: Map<string, { lat: number; lon: number }> | null = null

export function getStationCentroid(stationCode: string): { lat: number; lon: number } | null {
  if (!stationCentroids) {
    stationCentroids = new Map()
    const exitCache = getAllExits()
    for (const [code, exits] of exitCache) {
      const primaryCode = code.split('_')[0]
      if (stationCentroids.has(primaryCode)) continue
      if (exits.length === 0) continue
      const lat = exits.reduce((s, e) => s + e.lat, 0) / exits.length
      const lon = exits.reduce((s, e) => s + e.lon, 0) / exits.length
      stationCentroids.set(primaryCode, { lat, lon })
    }
  }
  return stationCentroids.get(stationCode) || null
}

/**
 * Compute metro ride time + transfer overhead using real pathfinding data.
 * Returns { rideMinutes, transferWalkMinutes, isTransfer }.
 * rideMinutes = total rail time (leg1 + leg2 for transfers, or direct ride).
 * transferWalkMinutes = walk between platforms (0 for direct trips).
 */
function getMetroTimes(fromStation: string, toStation: string): {
  rideMinutes: number
  transferWalkMinutes: number
  isTransfer: boolean
} {
  const transfer = findTransfer(fromStation, toStation, DEFAULT_TRANSFER_WALK)
  if (!transfer) {
    // Shouldn't happen, but fall back to haversine estimate
    const from = getStationCentroid(fromStation)
    const to = getStationCentroid(toStation)
    const fallback = (from && to)
      ? Math.max(3, Math.round(haversineMeters(from.lat, from.lon, to.lat, to.lon) / 1000 * 2.5))
      : 15
    return { rideMinutes: fallback, transferWalkMinutes: 0, isTransfer: false }
  }

  if (transfer.direct && transfer.line) {
    const ride = calculateRouteTravelTime(fromStation, toStation, transfer.line)
    return { rideMinutes: ride, transferWalkMinutes: 0, isTransfer: false }
  }

  // Transfer trip — use pathfinding's precomputed leg times
  const leg1 = transfer.leg1Time ?? (transfer.fromLine
    ? calculateRouteTravelTime(fromStation, transfer.fromPlatform, transfer.fromLine)
    : 10)
  const leg2 = transfer.leg2Time ?? (transfer.toLine
    ? calculateRouteTravelTime(transfer.toPlatform, toStation, transfer.toLine)
    : 10)
  return {
    rideMinutes: leg1 + leg2,
    transferWalkMinutes: DEFAULT_TRANSFER_WALK,
    isTransfer: true,
  }
}

function estimateWalkMinutes(meters: number): number {
  return Math.max(1, Math.round((meters * GRID_FACTOR) / (WALK_SPEED_MPS * 60)))
}

/**
 * Build a lookup: routeId+directionId → headsign (from first matching trip)
 */
function buildHeadsignLookup(): Map<string, string> {
  const lookup = new Map<string, string>()
  for (const trip of getBusTrips().values()) {
    const key = `${trip.routeId}_${trip.directionId}`
    if (!lookup.has(key)) {
      lookup.set(key, trip.headsign)
    }
  }
  return lookup
}

interface BusRouteCandidate {
  routeId: string
  directionId: number
  routeName: string
  headsign: string
  boardStop: BusStop
  alightStop: BusStop
  transferStationCode: string
  boardWalkMeters: number
  alightWalkMeters: number
  stopCount: number
  /** Name of the station exit nearest to the bus stop (for car diagram highlighting) */
  nearestExitName: string
  nearestExitLat: number
  nearestExitLon: number
}

/**
 * Metro→Bus (last mile): User rides Metro, then catches a bus to destination.
 *
 * 1. Find bus stops near destination
 * 2. For each dest stop, check which routes serve it
 * 3. Walk route sequences backwards to find a stop near a Metro station
 * 4. Return viable hybrid trips
 */
export function findMetroBusTrips(
  destLat: number,
  destLon: number,
  originStationCode: string,
  originLat?: number,
  originLon?: number
): HybridTrip[] {
  const routes = getBusRoutes()
  const sequences = getRouteStopSequences()
  const stopRoutesMap = getStopRoutes()
  const busStopStationsMap = getBusStopStations()
  const allStops = getBusStops()
  const headsigns = buildHeadsignLookup()

  const destStops = queryNearbyStops(destLat, destLon, SEARCH_RADIUS_M)
  if (destStops.length === 0) return []

  const candidates: BusRouteCandidate[] = []

  for (const destStop of destStops) {
    const routeIds = stopRoutesMap.get(destStop.stopId)
    if (!routeIds) continue

    for (const routeId of routeIds) {
      const route = routes.get(routeId)
      if (!route) continue

      for (const directionId of [0, 1]) {
        const seqKey = `${routeId}_${directionId}`
        const sequence = sequences.get(seqKey)
        if (!sequence) continue

        const destIdx = sequence.indexOf(destStop.stopId)
        if (destIdx === -1) continue

        // Walk backwards from dest stop to find stops near a Metro station.
        // Check up to MAX_SEARCH_STOPS stops back so we consider multiple
        // boarding points and pick the one with the best total time (walk + ride).
        let found = 0
        for (let i = destIdx - 1; i >= 0 && found < MAX_SEARCH_STOPS; i--) {
          const stopId = sequence[i]
          const nearbyStations = busStopStationsMap.get(stopId)
          if (!nearbyStations || nearbyStations.length === 0) continue

          found++
          for (const { stationCode, walkMeters, exitName, exitLat, exitLon } of nearbyStations) {
            if (stationCode === originStationCode) continue

            const boardStop = allStops.get(stopId)
            if (!boardStop) continue

            candidates.push({
              routeId,
              directionId,
              routeName: route.shortName,
              headsign: headsigns.get(seqKey) || '',
              boardStop,
              alightStop: destStop,
              transferStationCode: stationCode,
              boardWalkMeters: walkMeters,
              alightWalkMeters: Math.round(haversineMeters(destLat, destLon, destStop.lat, destStop.lon)),
              stopCount: destIdx - i,
              nearestExitName: exitName,
              nearestExitLat: exitLat,
              nearestExitLon: exitLon,
            })
          }
        }
      }
    }
  }

  // Outside walk: origin → origin metro station
  const originCentroid = getStationCentroid(originStationCode)
  const outsideWalkMeters = (originLat != null && originLon != null && originCentroid)
    ? haversineMeters(originLat, originLon, originCentroid.lat, originCentroid.lon)
    : 0

  return rankCandidates(candidates, 'metro-bus', originStationCode, outsideWalkMeters)
}

/**
 * Bus→Metro (first mile): User catches a bus, then rides Metro.
 *
 * 1. Find bus stops near origin
 * 2. For each origin stop, check which routes serve it
 * 3. Walk route sequences forward to find a stop near a Metro station
 * 4. Return viable hybrid trips
 */
export function findBusMetroTrips(
  originLat: number,
  originLon: number,
  destStationCode: string,
  originStationCode?: string,
  destLat?: number,
  destLon?: number
): HybridTrip[] {
  const routes = getBusRoutes()
  const sequences = getRouteStopSequences()
  const stopRoutesMap = getStopRoutes()
  const busStopStationsMap = getBusStopStations()
  const allStops = getBusStops()
  const headsigns = buildHeadsignLookup()

  const originStops = queryNearbyStops(originLat, originLon, SEARCH_RADIUS_M)
  if (originStops.length === 0) return []

  // Pre-compute: how close is the origin to each station's nearest exit?
  // If origin is already walkable to a station, bussing there is pointless.
  const exitCache = getAllExits()
  const originToStationDist = new Map<string, number>()
  function getOriginToStation(stationCode: string): number {
    let dist = originToStationDist.get(stationCode)
    if (dist !== undefined) return dist
    const exits = exitCache.get(stationCode) || []
    dist = exits.length > 0
      ? Math.min(...exits.map(e => haversineMeters(originLat, originLon, e.lat, e.lon)))
      : Infinity
    originToStationDist.set(stationCode, dist)
    return dist
  }

  const candidates: BusRouteCandidate[] = []

  for (const originStop of originStops) {
    const routeIds = stopRoutesMap.get(originStop.stopId)
    if (!routeIds) continue

    for (const routeId of routeIds) {
      const route = routes.get(routeId)
      if (!route) continue

      for (const directionId of [0, 1]) {
        const seqKey = `${routeId}_${directionId}`
        const sequence = sequences.get(seqKey)
        if (!sequence) continue

        const originIdx = sequence.indexOf(originStop.stopId)
        if (originIdx === -1) continue

        // Walk forward from origin stop to find stops near a Metro station.
        // Check up to MAX_SEARCH_STOPS Metro-connected stops so we pick the
        // best total time (walk + ride), not just the first match.
        let found = 0
        for (let i = originIdx + 1; i < sequence.length && found < MAX_SEARCH_STOPS; i++) {
          const stopId = sequence[i]
          const nearbyStations = busStopStationsMap.get(stopId)
          if (!nearbyStations || nearbyStations.length === 0) continue

          found++
          for (const { stationCode, walkMeters, exitName, exitLat, exitLon } of nearbyStations) {
            if (stationCode === destStationCode) continue
            // Skip if the origin is already within walking distance (~1km) of
            // this station — bussing to a station you can walk to is irrational
            if (getOriginToStation(stationCode) < 1000) continue

            const alightStop = allStops.get(stopId)
            if (!alightStop) continue

            candidates.push({
              routeId,
              directionId,
              routeName: route.shortName,
              headsign: headsigns.get(seqKey) || '',
              boardStop: originStop,
              alightStop,
              transferStationCode: stationCode,
              boardWalkMeters: Math.round(haversineMeters(originLat, originLon, originStop.lat, originStop.lon)),
              alightWalkMeters: walkMeters,
              stopCount: i - originIdx,
              nearestExitName: exitName,
              nearestExitLat: exitLat,
              nearestExitLon: exitLon,
            })
          }
        }
      }
    }
  }

  // Outside walk: destination metro station → final destination
  const destCentroid = getStationCentroid(destStationCode)
  const outsideWalkMeters = (destLat != null && destLon != null && destCentroid)
    ? haversineMeters(destCentroid.lat, destCentroid.lon, destLat, destLon)
    : 0

  return rankCandidates(candidates, 'bus-metro', destStationCode, outsideWalkMeters)
}

/**
 * Rank candidates by estimated total time, deduplicate, and cap at MAX_RESULTS
 */
function rankCandidates(
  candidates: BusRouteCandidate[],
  pattern: 'metro-bus' | 'bus-metro',
  knownStationCode: string,
  outsideWalkMeters: number = 0
): HybridTrip[] {
  // Deduplicate by route + transfer station — keep the candidate with
  // the least total walking. Within the same route, the bus ride between
  // stops is essentially free (you're already on the bus), so only the
  // walks to/from the bus matter. Real ride time comes from GTFS later.
  const candidateScore = (c: BusRouteCandidate) =>
    c.boardWalkMeters + c.alightWalkMeters

  const best = new Map<string, BusRouteCandidate>()
  for (const c of candidates) {
    const key = `${c.routeId}_${c.transferStationCode}`
    const existing = best.get(key)
    if (!existing || candidateScore(c) < candidateScore(existing)) {
      best.set(key, c)
    }
  }

  const trips: HybridTrip[] = []
  for (const c of best.values()) {
    const boardWalkMinutes = estimateWalkMinutes(c.boardWalkMeters)
    const alightWalkMinutes = estimateWalkMinutes(c.alightWalkMeters)
    const busRideMinutes = c.stopCount * BUS_MIN_PER_STOP

    const metroFrom = pattern === 'metro-bus' ? knownStationCode : c.transferStationCode
    const metroTo = pattern === 'metro-bus' ? c.transferStationCode : knownStationCode

    const metro = getMetroTimes(metroFrom, metroTo)
    const metroTimeMinutes = metro.rideMinutes + metro.transferWalkMinutes
    const outsideWalkMinutes = estimateWalkMinutes(outsideWalkMeters)

    // Compute realistic end-to-end time using GTFS schedules.
    // Sequence the journey step by step so wait times are based on
    // when the user actually arrives at each stop.
    //
    // metro-bus: originWalk → metroWait → metroRide(+transfer) → busStopWalk → busWait → busRide → destWalk
    // bus-metro: busStopWalk → busWait → busRide → metroWalk → metroWait → metroRide(+transfer) → destWalk

    // Estimate when user arrives at the bus boarding stop (minutes from now)
    let arrivalAtBusStopMin: number
    if (pattern === 'metro-bus') {
      arrivalAtBusStopMin = outsideWalkMinutes + AVG_METRO_WAIT + metroTimeMinutes + boardWalkMinutes
    } else {
      arrivalAtBusStopMin = boardWalkMinutes
    }

    // Find next bus after the user arrives at the stop
    const nextBus = getNextDeparture(c.boardStop.stopId, c.routeId, c.directionId, arrivalAtBusStopMin)

    let scheduledRideMinutes: number | undefined
    let busWaitMinutes = AVG_BUS_WAIT // fallback if no schedule data
    if (nextBus) {
      busWaitMinutes = Math.max(0, nextBus.minutesFromNow - arrivalAtBusStopMin)
      const rideMin = getScheduledRideMinutes(nextBus.tripId, c.boardStop.stopId, c.alightStop.stopId)
      if (rideMin != null) scheduledRideMinutes = rideMin
    }

    const effectiveRideMinutes = scheduledRideMinutes ?? busRideMinutes

    // Find variant routes that also serve both board and alight stops
    // (e.g. D5X express variant of D50 at the same stops)
    const variantRoutes = new Set<string>()
    const stopRoutesMap = getStopRoutes()
    const boardRoutes = stopRoutesMap.get(c.boardStop.stopId)
    const alightRoutes = stopRoutesMap.get(c.alightStop.stopId)
    if (boardRoutes && alightRoutes) {
      for (const candidateRoute of boardRoutes) {
        if (candidateRoute === c.routeId || !alightRoutes.has(candidateRoute)) continue
        // Verify stop order in GTFS sequence
        const sequences = getRouteStopSequences()
        for (const dir of [0, 1]) {
          const seq = sequences.get(`${candidateRoute}_${dir}`)
          if (!seq) continue
          const bIdx = seq.indexOf(c.boardStop.stopId)
          const aIdx = seq.indexOf(c.alightStop.stopId)
          if (bIdx !== -1 && aIdx !== -1 && bIdx < aIdx) {
            variantRoutes.add(candidateRoute)
            break
          }
        }
      }
    }

    // Build scheduled departures list starting from now (not arrival time)
    // so the client can show both trip-card badges and detail-view scheduled
    // buses after RT predictions. We send 5 to ensure enough survive dedup.
    const scheduledDepartures = getNextScheduledDepartures(
      c.boardStop.stopId, c.routeId, c.directionId, 5, 0,
      variantRoutes.size > 0 ? variantRoutes : undefined
    )

    let totalTimeMinutes: number
    if (pattern === 'metro-bus') {
      totalTimeMinutes = outsideWalkMinutes + AVG_METRO_WAIT + metroTimeMinutes
        + boardWalkMinutes + busWaitMinutes + effectiveRideMinutes + alightWalkMinutes
    } else {
      totalTimeMinutes = boardWalkMinutes + busWaitMinutes + effectiveRideMinutes
        + alightWalkMinutes + AVG_METRO_WAIT + metroTimeMinutes + outsideWalkMinutes
    }

    trips.push({
      pattern,
      metroFrom,
      metroTo,
      metroTimeMinutes,
      busLeg: {
        routeId: c.routeId,
        routeName: c.routeName,
        headsign: c.headsign,
        boardStop: c.boardStop,
        alightStop: c.alightStop,
        boardWalkMinutes,
        boardWalkMeters: c.boardWalkMeters,
        alightWalkMinutes,
        alightWalkMeters: c.alightWalkMeters,
        estimatedRideMinutes: busRideMinutes,
        predictions: [],
        nearestExitName: c.nearestExitName,
        nearestExitLat: c.nearestExitLat,
        nearestExitLon: c.nearestExitLon,
        scheduledDepartures: scheduledDepartures.length > 0 ? scheduledDepartures : undefined,
        scheduledRideMinutes,
        scheduledWaitMinutes: nextBus ? busWaitMinutes : undefined,
      },
      totalTimeMinutes,
    })
  }

  trips.sort((a, b) => a.totalTimeMinutes - b.totalTimeMinutes)
  return trips.slice(0, MAX_RESULTS)
}
