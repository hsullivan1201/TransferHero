import assert from 'node:assert/strict'
import type { BusStop } from '@transferhero/shared'
import { getMetroTimes, rankCandidates, type BusRouteCandidate } from './busRouteFinder.js'
import { calculateRouteTravelTime } from './travelTime.js'

function makeStop(stopId: string): BusStop {
  return {
    stopId,
    stopCode: stopId.replace(/\D/g, '') || '1000000',
    name: stopId,
    lat: 38.9,
    lon: -77.03,
    agencyId: 'wmata',
  }
}

function makeCandidate(overrides: Partial<BusRouteCandidate> = {}): BusRouteCandidate {
  return {
    routeId: 'wmata:R1',
    directionId: 0,
    routeName: 'R1',
    headsign: 'default',
    boardStop: makeStop('wmata:board'),
    alightStop: makeStop('wmata:alight'),
    transferStationCode: 'A01',
    boardWalkMeters: 120,
    alightWalkMeters: 120,
    stopCount: 3,
    nearestExitName: 'Exit 1',
    nearestExitLat: 38.9,
    nearestExitLon: -77.03,
    ...overrides,
  }
}

function makeDeps(nextByDirection: Record<number, { tripId: string; depSec: number; minutesFromNow: number } | null>) {
  return {
    getStopRoutes: () => new Map<string, Set<string>>(),
    getRouteStopSequences: () => new Map<string, string[]>(),
    getNextScheduledDepartures: () => [],
    getNextDeparture: (_stopId: string, _routeId: string, directionId: number) => nextByDirection[directionId] ?? null,
    getScheduledRideMinutes: () => null,
    getMetroTimes: () => ({ rideMinutes: 10, transferWalkMinutes: 0, isTransfer: false }),
  }
}

function prunesCandidatesWithNoCatchableDeparture() {
  const trips = rankCandidates(
    [
      makeCandidate({ directionId: 0, headsign: 'dir-0' }),
      makeCandidate({ directionId: 1, headsign: 'dir-1' }),
    ],
    'bus-metro',
    'A01',
    0,
    {
      deps: makeDeps({
        0: null,
        1: { tripId: 'trip-1', depSec: 3600, minutesFromNow: 12 },
      }),
      telemetryLabel: 'test-prune',
    }
  )

  assert.equal(trips.length, 1)
  assert.equal(trips[0].busLeg.headsign, 'dir-1')
  console.log('✓ prunes bus candidates with no catchable departure')
}

function dedupesByDirectionAndKeepsBestWalkOption() {
  const trips = rankCandidates(
    [
      makeCandidate({ directionId: 0, headsign: 'dir-0-worse', boardWalkMeters: 300, alightWalkMeters: 260 }),
      makeCandidate({ directionId: 0, headsign: 'dir-0-better', boardWalkMeters: 120, alightWalkMeters: 90 }),
      makeCandidate({ directionId: 1, headsign: 'dir-1', boardWalkMeters: 100, alightWalkMeters: 110 }),
    ],
    'bus-metro',
    'A01',
    0,
    {
      deps: makeDeps({
        0: { tripId: 'trip-0', depSec: 3600, minutesFromNow: 10 },
        1: { tripId: 'trip-1', depSec: 3700, minutesFromNow: 11 },
      }),
      telemetryLabel: 'test-dedupe',
    }
  )

  assert.equal(trips.length, 2)
  const headsigns = new Set(trips.map((trip) => trip.busLeg.headsign))
  assert.equal(headsigns.has('dir-0-better'), true)
  assert.equal(headsigns.has('dir-0-worse'), false)
  assert.equal(headsigns.has('dir-1'), true)
  console.log('✓ dedupes by route+station+direction and keeps best walk candidate')
}

function usesPathTimeForAliasDirectMetroLeg() {
  const expectedRideMinutes = Math.min(
    calculateRouteTravelTime('F03', 'K04', 'OR'),
    calculateRouteTravelTime('F03', 'K04', 'SV')
  )
  assert.ok(Number.isFinite(expectedRideMinutes), 'the aliased direct route must have a measured path time')

  const metro = getMetroTimes('F03', 'K04')

  assert.equal(metro.isTransfer, false)
  assert.equal(metro.transferWalkMinutes, 0)
  assert.equal(metro.rideMinutes, expectedRideMinutes)
  assert.ok(Number.isFinite(metro.rideMinutes), 'bus routing must never rank this Metro leg as Infinity')
  console.log('✓ uses finite path time for an F03 → K04 alias-direct Metro leg')
}

prunesCandidatesWithNoCatchableDeparture()
dedupesByDirectionAndKeepsBestWalkOption()
usesPathTimeForAliasDirectMetroLeg()

console.log('busRouteFinder tests passed')
