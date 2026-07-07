import assert from 'node:assert/strict'
import type { Train } from '@transferhero/shared'
import {
  parseUpdatesToTrains,
  getArrivalAtStation,
  fetchDestinationArrivals,
  findDepartedTrains,
  getWmataUpstreamStats,
  resetWmataUpstreamStats,
} from './wmata.js'

function makeEntity(tripId: string, routeId: string, stops: Array<{ stopId: string; timeSec: number; seq: number }>) {
  return {
    tripUpdate: {
      trip: { tripId, routeId },
      stopTimeUpdate: stops.map((s) => ({
        stopId: s.stopId,
        stopSequence: s.seq,
        departure: { time: String(s.timeSec) },
      })),
    }
  }
}

function parseUpdatesUsesStationIndexAndFiltersCorrectly() {
  const nowSec = Math.floor(Date.now() / 1000)
  const entities = [
    makeEntity('t1', 'RD', [
      { stopId: 'PF_A01_1', timeSec: nowSec + 180, seq: 1 },
      { stopId: 'PF_B01_1', timeSec: nowSec + 540, seq: 2 },
    ]),
    makeEntity('t2', 'BL', [
      { stopId: 'PF_A01_1', timeSec: nowSec + 210, seq: 1 },
    ]),
  ]

  const trains = parseUpdatesToTrains(
    entities,
    'A01',
    ['Shady Grove'],
    {
      t1: { line: 'RD', headsign: 'Shady Grove' },
      t2: { line: 'BL', headsign: 'Largo Town Center' },
    },
    ['RD']
  )

  assert.equal(trains.length, 1)
  assert.equal(trains[0]._tripId, 't1')
  assert.equal(trains[0].Line, 'RD')
  console.log('✓ parseUpdatesToTrains filters by station/terminus/line using indexed GTFS data')
}

async function destinationArrivalPrefersGtfsTripMatch() {
  const nowSec = Math.floor(Date.now() / 1000)
  const entities = [
    makeEntity('trip-gtfs', 'RD', [
      { stopId: 'PF_A01_1', timeSec: nowSec + 120, seq: 1 },
      { stopId: 'PF_B01_1', timeSec: nowSec + 600, seq: 2 },
    ]),
  ]

  const arrival = getArrivalAtStation(entities, 'trip-gtfs', 'B01')
  assert.ok(arrival)
  assert.ok((arrival?.minutes ?? -1) >= 9)

  const originTrains: Train[] = [{
    Line: 'RD',
    DestinationName: 'Glenmont',
    Min: '2',
    Car: '8',
    _tripId: 'trip-gtfs',
  }]

  const enriched = await fetchDestinationArrivals(
    originTrains,
    'B01',
    'unused-api-key',
    entities,
    [],
    10
  )

  assert.equal(enriched.length, 1)
  assert.equal(enriched[0]._realtimeSource, 'gtfs-rt')
  assert.ok(enriched[0]._destArrivalTimestamp)
  console.log('✓ fetchDestinationArrivals prefers exact GTFS trip match when available')
}

function findDepartedTrainsUsesIndexedStationLookup() {
  const nowSec = Math.floor(Date.now() / 1000)
  const entities = [
    makeEntity('departed-1', 'RD', [
      { stopId: 'PF_A01_1', timeSec: nowSec - 240, seq: 1 },
      { stopId: 'PF_B01_1', timeSec: nowSec + 60, seq: 2 },
      { stopId: 'PF_B02_1', timeSec: nowSec + 300, seq: 3 },
    ]),
  ]

  const departed = findDepartedTrains(
    'B01',
    'RD',
    5,
    entities,
    { 'departed-1': { line: 'RD', headsign: 'Glenmont' } },
    ['Glenmont']
  )

  assert.equal(departed.length, 1)
  assert.equal(departed[0]._tripId, 'departed-1')
  assert.equal(departed[0]._departed, true)
  assert.ok(departed[0]._nextStop)
  console.log('✓ findDepartedTrains returns departed trains with next-stop metadata from indexed GTFS data')
}

function upstreamStatsExposeRollingCallCounters() {
  resetWmataUpstreamStats()
  const stats = getWmataUpstreamStats()

  assert.ok(Number.isFinite(Date.parse(stats.startedAt)))
  assert.equal(stats.predictions.callsTotal, 0)
  assert.equal(stats.predictions.callsLastMinute, 0)
  assert.equal(stats.predictions.callsLastFiveMinutes, 0)
  assert.equal(stats.predictions.failures, 0)
  assert.equal(stats.gtfs.callsTotal, 0)
  assert.equal(stats.gtfs.callsLastMinute, 0)
  assert.equal(stats.gtfs.callsLastFiveMinutes, 0)
  assert.equal(stats.gtfs.failures, 0)
  console.log('✓ WMATA upstream stats expose rolling counters with zeroed baseline')
}

parseUpdatesUsesStationIndexAndFiltersCorrectly()
await destinationArrivalPrefersGtfsTripMatch()
findDepartedTrainsUsesIndexedStationLookup()
upstreamStatsExposeRollingCallCounters()

console.log('wmata tests passed')
