import assert from 'node:assert/strict'
import type { Line } from '@transferhero/shared'
import { ALL_STATIONS } from '../data/stations.js'
import { findTransfer } from './pathfinding.js'
import { planScheduledTrip, MAX_FUTURE_HOURS } from './scheduledTripPlanner.js'
import type { ScheduledMetroTrain } from './metroScheduleIndex.js'

const LINES: Line[] = ['RD', 'OR', 'SV', 'BL', 'YL', 'GR']

function findRoutePair(direct: boolean): { from: string; to: string } {
  for (const fromStation of ALL_STATIONS) {
    for (const toStation of ALL_STATIONS) {
      if (fromStation.code === toStation.code) continue
      const transfer = findTransfer(fromStation.code, toStation.code, 2)
      if (!transfer) continue
      if (direct && transfer.direct) return { from: fromStation.code, to: toStation.code }
      if (!direct && !transfer.direct) return { from: fromStation.code, to: toStation.code }
    }
  }
  throw new Error(`Unable to find a ${direct ? 'direct' : 'transfer'} route pair`)
}

// deterministic fake schedule: departures every 6 min from startFrom+2,
// cycling through all lines so the planner's line filters keep the right subset
function makeDeps(nowMs: number) {
  const calls: Array<{ station: string; startFrom: number; limit: number }> = []
  return {
    calls,
    deps: {
      getMetroDepartures: (
        stationCode: string,
        terminus: string | string[],
        startFromMinutes = 0,
        limit = 10
      ): ScheduledMetroTrain[] => {
        calls.push({ station: stationCode, startFrom: startFromMinutes, limit })
        const headsign = Array.isArray(terminus) ? terminus[0] ?? 'Terminus' : terminus
        const result: ScheduledMetroTrain[] = []
        for (let i = 0; i < limit * 3; i++) {
          if (result.length >= limit) break
          result.push({
            depSec: 0,
            minutesFromNow: Math.ceil(Math.max(0, startFromMinutes)) + 2 + i * 6,
            tripId: `sched-${stationCode}-${i}`,
            line: LINES[i % LINES.length],
            headsign,
          })
        }
        return result
      },
      getMetroDeparturesBefore: (
        stationCode: string,
        terminus: string | string[],
        endAtMinutes: number,
        limit = 10
      ): ScheduledMetroTrain[] => {
        calls.push({ station: stationCode, startFrom: endAtMinutes, limit })
        const headsign = Array.isArray(terminus) ? terminus[0] ?? 'Terminus' : terminus
        const result: ScheduledMetroTrain[] = []
        for (let i = 0; i < limit * 3; i++) {
          if (result.length >= limit) break
          result.push({
            depSec: 0,
            minutesFromNow: Math.floor(endAtMinutes) - 2 - i * 6,
            tripId: `sched-before-${stationCode}-${i}`,
            line: LINES[i % LINES.length],
            headsign,
          })
        }
        return result
      },
      now: () => nowMs,
    },
  }
}

// Deliberately returns a mixture of trunk and branch lines so the planner must
// apply the route's exact-line filters after querying the schedule index.
function makeKingStreetDeps(nowMs: number) {
  return {
    getMetroDepartures: (
      stationCode: string,
      terminus: string | string[],
      startFromMinutes = 0,
      limit = 10
    ): ScheduledMetroTrain[] => {
      const headsign = Array.isArray(terminus) ? terminus[0] ?? 'Terminus' : terminus
      const lines: Line[] = limit === 1
        ? ['OR']
        : ['YL', 'BL', 'OR', 'SV', 'BL', 'YL', 'SV', 'OR']

      return lines.map((line, index) => ({
        depSec: 0,
        minutesFromNow: Math.ceil(Math.max(0, startFromMinutes)) + 2 + index * 2,
        tripId: `interlined-${stationCode}-${line}-${index}`,
        line,
        headsign,
      }))
    },
    getMetroDeparturesBefore: () => [],
    now: () => nowMs,
  }
}

function makeAliasPlatformDeps(nowMs: number) {
  const calls: Array<{ station: string; startFrom: number; limit: number }> = []
  const linesByPlatform: Partial<Record<string, Line[]>> = {
    D03: ['OR', 'SV'],
    B01: ['RD'],
    C01: ['OR', 'SV'],
  }

  return {
    calls,
    deps: {
      getMetroDepartures: (
        stationCode: string,
        terminus: string | string[],
        startFromMinutes = 0,
        limit = 10
      ): ScheduledMetroTrain[] => {
        calls.push({ station: stationCode, startFrom: startFromMinutes, limit })
        const headsign = Array.isArray(terminus) ? terminus[0] ?? 'Terminus' : terminus
        return (linesByPlatform[stationCode] ?? []).slice(0, limit).map((line, index) => ({
          depSec: 0,
          minutesFromNow: Math.ceil(Math.max(0, startFromMinutes)) + 2 + index * 3,
          tripId: `alias-${stationCode}-${line}-${index}`,
          line,
          headsign,
        }))
      },
      getMetroDeparturesBefore: () => [],
      now: () => nowMs,
    },
  }
}

function rejectsPastDepartures() {
  const nowMs = Date.now()
  const { deps } = makeDeps(nowMs)
  const route = findRoutePair(true)

  assert.throws(
    () => planScheduledTrip({ ...route, walkTime: 2, accessible: false, departAtMs: nowMs - 10 * 60_000 }, deps),
    /past/
  )
  console.log('✓ rejects departAt in the past')
}

function rejectsDeparturesBeyondServiceDay() {
  const nowMs = Date.now()
  const { deps } = makeDeps(nowMs)
  const route = findRoutePair(true)

  assert.throws(
    () => planScheduledTrip({ ...route, walkTime: 2, accessible: false, departAtMs: nowMs + (MAX_FUTURE_HOURS + 1) * 3_600_000 }, deps),
    /service day/
  )
  console.log('✓ rejects departAt beyond the current service day window')
}

function directTripReturnsScheduledTrainsFromOffset() {
  const nowMs = Date.now()
  const { deps } = makeDeps(nowMs)
  const route = findRoutePair(true)
  const offsetMin = 120
  const departAtMs = nowMs + offsetMin * 60_000

  const payload = planScheduledTrip({ ...route, walkTime: 2, accessible: false, departAtMs }, deps)

  assert.equal(payload.trip.isDirect, true)
  assert.equal(payload.meta.scheduleOnly, true)
  assert.equal(payload.meta.plannedFor, new Date(departAtMs).toISOString())
  const trains = payload.trip.leg1.trains
  assert.ok(trains.length > 0)
  let prevMin = -Infinity
  for (const train of trains) {
    assert.equal(train._scheduled, true)
    const min = Number(train.Min)
    assert.ok(min >= offsetMin, `train Min ${min} should be >= offset ${offsetMin}`)
    assert.ok(min >= prevMin, 'trains should be in departure order')
    prevMin = min
    assert.ok(train._destArrivalTimestamp > departAtMs)
  }
  console.log('✓ direct trip returns only scheduled trains at/after the requested departure')
}

function transferTripIncludesInlineCatchableLeg2() {
  const nowMs = Date.now()
  const { deps } = makeDeps(nowMs)
  const route = findRoutePair(false)
  const offsetMin = 90
  const departAtMs = nowMs + offsetMin * 60_000

  const payload = planScheduledTrip({ ...route, walkTime: 2, accessible: false, departAtMs }, deps)

  assert.equal(payload.trip.isDirect, false)
  assert.ok(payload.trip.transfer?.name)

  const leg1 = payload.trip.leg1.trains
  assert.ok(leg1.length > 0)
  for (const train of leg1) {
    assert.equal(train._scheduled, true)
    assert.equal(typeof train._transferArrivalMin, 'number')
    assert.ok(train._transferArrivalMin > Number(train.Min), 'transfer arrival must be after departure')
  }

  const leg2 = payload.trip.leg2.trains
  assert.ok(leg2.length > 0)
  for (const train of leg2) {
    assert.equal(train._scheduled, true)
    assert.equal(typeof train._waitTime, 'number')
    assert.ok(train._canCatch)
    assert.ok(train._waitTime >= -3)
    assert.ok(train._arrivalClock)
  }
  console.log('✓ transfer trip includes inline catchable leg2 trains from the schedule')
}

function kingStreetBranchRoutesFilterLeg1AndExposeLenfantAlternative() {
  const nowMs = Date.UTC(2026, 6, 17, 15, 0, 0)
  const deps = makeKingStreetDeps(nowMs)
  const input = {
    from: 'C13',
    to: 'K04',
    walkTime: 2,
    accessible: false,
    departAtMs: nowMs,
  }

  const viaRosslyn = planScheduledTrip(input, deps)

  assert.equal(viaRosslyn.trip.transfer.station, 'C05')
  assert.equal(viaRosslyn.trip.transfer.name, 'Rosslyn')
  assert.ok(viaRosslyn.trip.leg1.trains.length > 0)
  assert.ok(
    viaRosslyn.trip.leg1.trains.every((train: { Line: Line }) => train.Line === 'BL'),
    'the Rosslyn route must not offer Yellow Line trains from King St'
  )
  assert.ok(
    viaRosslyn.trip.transfer.alternatives.some(
      (alternative: { station: string; name: string }) =>
        alternative.station === 'D03' && alternative.name === "L'Enfant Plaza"
    ),
    "the transfer choices should include the Yellow Line route via L'Enfant Plaza"
  )

  const viaLenfant = planScheduledTrip({ ...input, transferStation: 'D03' }, deps)

  assert.equal(viaLenfant.trip.transfer.station, 'D03')
  assert.equal(viaLenfant.trip.transfer.name, "L'Enfant Plaza")
  assert.ok(viaLenfant.trip.leg1.trains.length > 0)
  assert.ok(
    viaLenfant.trip.leg1.trains.every((train: { Line: Line }) => train.Line === 'YL'),
    "the L'Enfant Plaza route must offer only Yellow Line trains from King St"
  )
  console.log('✓ King St branch routes filter trains and include the L\'Enfant alternative')
}

function directAliasOriginsQueryTheLineSpecificPlatform() {
  const nowMs = Date.UTC(2026, 6, 17, 15, 0, 0)

  const lenfant = makeAliasPlatformDeps(nowMs)
  const lenfantTrip = planScheduledTrip({
    from: 'F03',
    to: 'K04',
    walkTime: 2,
    accessible: false,
    departAtMs: nowMs + 30 * 60_000,
  }, lenfant.deps)

  assert.equal(lenfantTrip.trip.isDirect, true)
  assert.deepEqual(lenfant.calls.map(call => call.station), ['D03'])
  assert.ok(lenfantTrip.trip.leg1.trains.length > 0)
  assert.ok(
    lenfantTrip.trip.leg1.trains.every(
      (train: { Line: Line }) => train.Line === 'OR' || train.Line === 'SV'
    ),
    "F03 to K04 should include only Orange/Silver trains queried at L'Enfant's D03 platform"
  )

  const galleryPlace = makeAliasPlatformDeps(nowMs)
  const galleryPlaceTrip = planScheduledTrip({
    from: 'F01',
    to: 'A15',
    walkTime: 2,
    accessible: false,
    departAtMs: nowMs + 30 * 60_000,
  }, galleryPlace.deps)

  assert.equal(galleryPlaceTrip.trip.isDirect, true)
  assert.deepEqual(galleryPlace.calls.map(call => call.station), ['B01'])
  assert.ok(galleryPlaceTrip.trip.leg1.trains.length > 0)
  assert.ok(
    galleryPlaceTrip.trip.leg1.trains.every((train: { Line: Line }) => train.Line === 'RD'),
    'F01 to A15 should include only Red trains queried at Gallery Place B01'
  )
  console.log('✓ direct alias origins query their line-specific platforms')
}

function transferAliasOriginQueriesTheFirstLegPlatform() {
  const nowMs = Date.UTC(2026, 6, 17, 15, 0, 0)
  const { calls, deps } = makeAliasPlatformDeps(nowMs)
  const payload = planScheduledTrip({
    from: 'F01',
    to: 'K04',
    walkTime: 2,
    accessible: false,
    departAtMs: nowMs + 30 * 60_000,
  }, deps)

  assert.equal(payload.trip.isDirect, false)
  assert.equal(payload.trip.transfer.name, 'Metro Center')
  assert.equal(calls[0]?.station, 'B01')
  assert.ok(payload.trip.leg1.trains.length > 0)
  assert.ok(
    payload.trip.leg1.trains.every((train: { Line: Line }) => train.Line === 'RD'),
    'the F01 transfer route should query and offer Red trains from B01'
  )
  console.log('✓ transfer alias origin queries its first-leg platform')
}

function leaveAtStartsAfterTheOriginWalk() {
  const nowMs = Date.UTC(2026, 6, 17, 15, 0, 0)
  const { calls, deps } = makeDeps(nowMs)
  const route = findRoutePair(true)
  const requestedOffset = 60
  const originWalkMinutes = 11
  const departAtMs = nowMs + requestedOffset * 60_000

  const payload = planScheduledTrip({
    ...route,
    walkTime: 2,
    accessible: false,
    departAtMs,
    originWalkMinutes,
  }, deps)

  assert.equal(payload.meta.planningMode, 'departAt')
  assert.equal(payload.meta.plannedFor, new Date(departAtMs).toISOString())
  assert.ok(calls.length > 0)
  assert.ok(
    calls.every(call => call.startFrom === requestedOffset + originWalkMinutes),
    'every origin-platform lookup should begin only after the rider reaches the station'
  )
  assert.ok(
    payload.trip.leg1.trains.every((train: { Min: string }) => Number(train.Min) >= requestedOffset + originWalkMinutes)
  )
  console.log('✓ leave-at keeps the requested door time and searches after the origin walk')
}

function directArriveByChoosesLatestOnTimeDeparture() {
  const nowMs = Date.UTC(2026, 6, 17, 15, 0, 0)
  const { deps } = makeDeps(nowMs)
  const route = findRoutePair(true)
  const requestedOffset = 120
  const originWalkMinutes = 11
  const destinationWalkMinutes = 8
  const arriveByMs = nowMs + requestedOffset * 60_000

  const payload = planScheduledTrip({
    ...route,
    walkTime: 2,
    accessible: false,
    arriveByMs,
    originWalkMinutes,
    destinationWalkMinutes,
  }, deps)

  assert.equal(payload.meta.planningMode, 'arriveBy')
  assert.equal(payload.meta.plannedFor, new Date(arriveByMs).toISOString())
  assert.ok(payload.trip.leg1.trains.length > 0)
  let previousDeparture = Infinity
  for (const train of payload.trip.leg1.trains) {
    const departure = Number(train.Min)
    assert.ok(departure >= originWalkMinutes, 'the origin walk must be reachable from now')
    assert.ok(train._destArrivalMin + destinationWalkMinutes <= requestedOffset)
    assert.ok(departure <= previousDeparture, 'arrive-by trains should be latest-first')
    previousDeparture = departure
  }
  console.log('✓ direct arrive-by returns latest-first departures that reach the final place on time')
}

function transferLeaveAtAlsoStartsAfterTheOriginWalk() {
  const nowMs = Date.UTC(2026, 6, 17, 15, 0, 0)
  const { calls, deps } = makeDeps(nowMs)
  const route = findRoutePair(false)
  const requestedOffset = 70
  const originWalkMinutes = 9

  const payload = planScheduledTrip({
    ...route,
    walkTime: 2,
    accessible: false,
    departAtMs: nowMs + requestedOffset * 60_000,
    originWalkMinutes,
  }, deps)

  assert.ok(payload.trip.leg1.trains.length > 0)
  assert.equal(calls[0]?.startFrom, requestedOffset + originWalkMinutes)
  assert.ok(
    payload.trip.leg1.trains.every(
      (train: { Min: string }) => Number(train.Min) >= requestedOffset + originWalkMinutes
    )
  )
  console.log('✓ transfer leave-at also searches first-leg trains after the origin walk')
}

function transferArriveByIncludesTheCompleteConnection() {
  const nowMs = Date.UTC(2026, 6, 17, 15, 0, 0)
  const { deps } = makeDeps(nowMs)
  const route = findRoutePair(false)
  const requestedOffset = 180
  const destinationWalkMinutes = 7

  const payload = planScheduledTrip({
    ...route,
    walkTime: 3,
    accessible: false,
    arriveByMs: nowMs + requestedOffset * 60_000,
    originWalkMinutes: 9,
    destinationWalkMinutes,
  }, deps)

  assert.equal(payload.meta.planningMode, 'arriveBy')
  assert.ok(payload.trip.leg1.trains.length > 0)
  assert.ok(payload.trip.leg2.trains.length > 0)
  assert.ok(
    payload.trip.leg1.trains.every(
      (train: { _destArrivalMin: number }) => train._destArrivalMin + destinationWalkMinutes <= requestedOffset
    )
  )
  assert.ok(
    payload.trip.leg2.trains.every(
      (train: { _totalTime: number }) => train._totalTime + destinationWalkMinutes <= requestedOffset
    )
  )
  console.log('✓ transfer arrive-by keeps only complete schedule-valid connections that meet the deadline')
}

rejectsPastDepartures()
rejectsDeparturesBeyondServiceDay()
directTripReturnsScheduledTrainsFromOffset()
transferTripIncludesInlineCatchableLeg2()
kingStreetBranchRoutesFilterLeg1AndExposeLenfantAlternative()
directAliasOriginsQueryTheLineSpecificPlatform()
transferAliasOriginQueriesTheFirstLegPlatform()
leaveAtStartsAfterTheOriginWalk()
directArriveByChoosesLatestOnTimeDeparture()
transferLeaveAtAlsoStartsAfterTheOriginWalk()
transferArriveByIncludesTheCompleteConnection()

console.log('scheduledTripPlanner tests passed')
