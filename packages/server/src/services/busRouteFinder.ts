import type { BusStop, HybridTrip } from '@transferhero/shared'
import { getBusRoutes, getRouteStopSequences, getStopRoutes, getBusStops, getBusTrips } from './busGtfsLoader.js'
import { queryNearbyStops, getBusStopStations, haversineMeters } from './busStopIndex.js'
import { getAllExits } from './stationService.js'
import { ALL_STATIONS } from '../data/stations.js'

const SEARCH_RADIUS_M = 400
const WALK_SPEED_MPS = 1.33
const GRID_FACTOR = 1.4
const BUS_MIN_PER_STOP = 2 // rough DC average
const MAX_RESULTS = 5
const MAX_SEARCH_STOPS = 5 // check up to 5 Metro-connected stops per route direction
const METRO_MIN_PER_KM = 2.5 // avg ~24 km/h including stops, dwell, transfers

// O(1) station lookup
const STATION_BY_CODE = new Map(ALL_STATIONS.map(s => [s.code, s]))

// Station centroid cache (avg of exit coordinates) for metro time estimates
let stationCentroids: Map<string, { lat: number; lon: number }> | null = null

function getStationCentroid(stationCode: string): { lat: number; lon: number } | null {
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

function estimateMetroMinutes(fromStation: string, toStation: string): number {
  const from = getStationCentroid(fromStation)
  const to = getStationCentroid(toStation)
  if (!from || !to) return 15 // safe fallback
  const distKm = haversineMeters(from.lat, from.lon, to.lat, to.lon) / 1000
  return Math.max(3, Math.round(distKm * METRO_MIN_PER_KM))
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
          for (const { stationCode, walkMeters, exitName } of nearbyStations) {
            if (stationCode === originStationCode) continue

            const boardStop = allStops.get(stopId)
            if (!boardStop) continue

            candidates.push({
              routeId,
              routeName: route.shortName,
              headsign: headsigns.get(seqKey) || '',
              boardStop,
              alightStop: destStop,
              transferStationCode: stationCode,
              boardWalkMeters: walkMeters,
              alightWalkMeters: Math.round(haversineMeters(destLat, destLon, destStop.lat, destStop.lon)),
              stopCount: destIdx - i,
              nearestExitName: exitName,
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
          for (const { stationCode, walkMeters, exitName } of nearbyStations) {
            if (stationCode === destStationCode) continue
            // Skip if the origin is already within walking distance (~1km) of
            // this station — bussing to a station you can walk to is irrational
            if (getOriginToStation(stationCode) < 1000) continue

            const alightStop = allStops.get(stopId)
            if (!alightStop) continue

            candidates.push({
              routeId,
              routeName: route.shortName,
              headsign: headsigns.get(seqKey) || '',
              boardStop: originStop,
              alightStop,
              transferStationCode: stationCode,
              boardWalkMeters: Math.round(haversineMeters(originLat, originLon, originStop.lat, originStop.lon)),
              alightWalkMeters: walkMeters,
              stopCount: i - originIdx,
              nearestExitName: exitName,
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
  // Deduplicate by route + transfer station — always board at the stop
  // closest to the Metro exit. Walking further to catch the bus 1 stop
  // later is never faster: the bus covers that distance quicker than you
  // can walk it, and you're walking in the bus's direction of travel.
  const metroWalkMeters = (c: BusRouteCandidate) =>
    pattern === 'metro-bus' ? c.boardWalkMeters : c.alightWalkMeters

  const candidateScore = (c: BusRouteCandidate) => metroWalkMeters(c)

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

    const metroTimeMinutes = estimateMetroMinutes(metroFrom, metroTo)
    const outsideWalkMinutes = estimateWalkMinutes(outsideWalkMeters)
    const totalTimeMinutes = boardWalkMinutes + busRideMinutes + alightWalkMinutes + metroTimeMinutes + outsideWalkMinutes

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
      },
      totalTimeMinutes,
    })
  }

  trips.sort((a, b) => a.totalTimeMinutes - b.totalTimeMinutes)
  return trips.slice(0, MAX_RESULTS)
}
