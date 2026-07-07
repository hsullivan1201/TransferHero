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

rejectsPastDepartures()
rejectsDeparturesBeyondServiceDay()
directTripReturnsScheduledTrainsFromOffset()
transferTripIncludesInlineCatchableLeg2()

console.log('scheduledTripPlanner tests passed')
