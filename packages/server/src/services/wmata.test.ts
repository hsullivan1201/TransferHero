import assert from 'node:assert/strict'
import type { Train } from '@transferhero/shared'
import {
  parseUpdatesToTrains,
  getArrivalAtStation,
  fetchDestinationArrivals,
  fetchGTFSVehiclePositions,
  findDepartedTrains,
  getWmataCacheStats,
  getWmataUpstreamStats,
  getGTFSTripProgress,
  parseGTFSVehiclePositions,
  resetWmataCacheStats,
  resetWmataUpstreamStats,
  resetWmataVehiclePositionCache,
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
  assert.equal(stats.vehiclePositions.callsTotal, 0)
  assert.equal(stats.vehiclePositions.callsLastMinute, 0)
  assert.equal(stats.vehiclePositions.callsLastFiveMinutes, 0)
  assert.equal(stats.vehiclePositions.failures, 0)
  console.log('✓ WMATA upstream stats expose rolling counters with zeroed baseline')
}

function vehiclePositionsAreNormalizedAndTripProgressIsOrdered() {
  const nowMs = Date.now()
  const positions = parseGTFSVehiclePositions([{
    id: 'entity-42',
    vehicle: {
      trip: { tripId: 'trip-42', routeId: 'RED', directionId: 1 },
      vehicle: { id: 'vehicle-42', label: 'Train 42' },
      position: { latitude: 38.9, longitude: -77.03, bearing: 180, speed: 12.5 },
      currentStopSequence: 2,
      currentStatus: 'IN_TRANSIT_TO',
      stopId: 'PF_A01_1',
      timestamp: String(Math.floor(nowMs / 1000)),
      occupancyStatus: 'MANY_SEATS_AVAILABLE',
    },
  }])

  assert.equal(positions.length, 1)
  assert.equal(positions[0].tripId, 'trip-42')
  assert.equal(positions[0].vehicleId, 'vehicle-42')
  assert.equal(positions[0].line, 'RD')
  assert.equal(positions[0].stopCode, 'A01')
  assert.equal(positions[0].latitude, 38.9)
  assert.equal(positions[0].occupancyStatus, 'MANY_SEATS_AVAILABLE')

  const progress = getGTFSTripProgress([
    makeEntity('trip-42', 'RED', [
      { stopId: 'PF_A03_1', timeSec: Math.floor(nowMs / 1000) - 120, seq: 1 },
      { stopId: 'PF_A02_1', timeSec: Math.floor(nowMs / 1000) + 60, seq: 2 },
      { stopId: 'PF_A01_1', timeSec: Math.floor(nowMs / 1000) + 240, seq: 3 },
    ]),
  ], 'trip-42', nowMs)
  assert.ok(progress)
  assert.equal(progress.previousStop?.stopCode, 'A03')
  assert.equal(progress.nextStop?.stopCode, 'A02')
  assert.deepEqual(progress.stops.map(stop => stop.stopCode), ['A03', 'A02', 'A01'])
  console.log('✓ vehicle positions and ordered trip progress are normalized for live tracking')
}

async function vehiclePositionFetchesCoalesceAndCache() {
  resetWmataVehiclePositionCache()
  resetWmataCacheStats()
  let calls = 0
  const dependencies = {
    now: () => 1_000,
    fetcher: async () => {
      calls++
      await Promise.resolve()
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array().buffer as ArrayBuffer,
      }
    },
  }

  await Promise.all([
    fetchGTFSVehiclePositions('test-key', dependencies),
    fetchGTFSVehiclePositions('test-key', dependencies),
  ])
  await fetchGTFSVehiclePositions('test-key', dependencies)

  assert.equal(calls, 1)
  const stats = getWmataCacheStats()
  assert.equal(stats.vehiclePositionMisses, 1)
  assert.equal(stats.vehiclePositionHits, 1)
  console.log('✓ vehicle position fetches coalesce and reuse their dedicated cache')
}

parseUpdatesUsesStationIndexAndFiltersCorrectly()
await destinationArrivalPrefersGtfsTripMatch()
findDepartedTrainsUsesIndexedStationLookup()
upstreamStatsExposeRollingCallCounters()
vehiclePositionsAreNormalizedAndTripProgressIsOrdered()
await vehiclePositionFetchesCoalesceAndCache()

console.log('wmata tests passed')
