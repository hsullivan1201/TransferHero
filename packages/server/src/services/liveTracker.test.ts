import assert from 'node:assert/strict'
import type {
  MetroMapData,
  SharedTrackedTrain,
  SharedTripPayload,
  Station,
  StationExit,
} from '@transferhero/shared'
import { buildMetroMapData } from './metroMap.js'
import { getLiveTrackerResponse } from './liveTracker.js'
import type { RailVehiclePosition } from './wmata.js'

const now = Date.UTC(2026, 6, 18, 18, 0, 0)
const stops: Station[] = [
  { code: 'A03', name: 'Dupont Circle', lines: ['RD'] },
  { code: 'A02', name: 'Farragut North', lines: ['RD'] },
  { code: 'A01', name: 'Metro Center', lines: ['RD', 'OR', 'SV', 'BL'] },
]

const trackedTrain: SharedTrackedTrain = {
  id: 'leg-1-trip-123',
  leg: 1,
  line: 'RD',
  toward: 'Glenmont',
  tripId: 'trip-123',
  from: stops[0],
  to: stops[2],
  stops: [...stops],
  departureAtMs: now - 10 * 60_000,
  arrivalAtMs: now - 60_000,
}

const trip: SharedTripPayload = {
  v: 3,
  origin: stops[0],
  destination: stops[2],
  lines: ['RD'],
  durationMinutes: 9,
  arrivalClock: '1:59 PM',
  routeSummary: 'Red toward Glenmont',
  transferWalkSummary: 'No transfer',
  walkTime: 0,
  accessible: false,
  departAt: null,
  transferName: null,
  legs: [{ kind: 'rail', line: 'RD', toward: 'Glenmont', minutes: 9 }],
  timing: {
    capturedAtMs: now - 12 * 60_000,
    departureAtMs: trackedTrain.departureAtMs,
    arrivalAtMs: trackedTrain.arrivalAtMs,
    source: 'live',
  },
  sharedAtMs: now - 12 * 60_000,
  tracking: { trains: [trackedTrain], expiresAtMs: now + 30 * 60_000 },
}

const map: MetroMapData = {
  generatedAtMs: now,
  stations: stops.map((station, index) => ({
    ...station,
    lat: 38.91 - index * 0.006,
    lon: -77.04 + index * 0.006,
  })),
  paths: [],
}

const freshVehicle: RailVehiclePosition = {
  entityId: 'vehicle-7',
  tripId: 'trip-123',
  vehicleId: 'vehicle-7',
  line: 'RD',
  latitude: 38.901,
  longitude: -77.031,
  bearing: 145,
  stopCode: 'A01',
  currentStatus: 'IN_TRANSIT_TO',
  timestampMs: now - 2_000,
  carriages: [],
}

const vehicleResponse = await getLiveTrackerResponse(trip, {
  now: () => now,
  apiKey: 'test-key',
  fetchVehiclePositions: async () => [freshVehicle],
  fetchTripUpdates: async () => [],
  getMapData: async () => map,
})
assert.ok(vehicleResponse)
assert.equal(vehicleResponse.trains[0].phase, 'arriving')
assert.equal(vehicleResponse.trains[0].ended, false, 'fresh vehicle must override elapsed schedule')
assert.deepEqual(vehicleResponse.trains[0].position, {
  lat: freshVehicle.latitude,
  lon: freshVehicle.longitude,
  bearing: 145,
  source: 'vehicle',
  speedMph: null,
})

const passedDestinationTrain: SharedTrackedTrain = {
  ...trackedTrain,
  id: 'short-leg-trip-123',
  to: stops[1],
  stops: stops.slice(0, 2),
  arrivalAtMs: now - 4 * 60_000,
}
const passedDestinationTrip: SharedTripPayload = {
  ...trip,
  destination: stops[1],
  lines: ['RD'],
  legs: [{ kind: 'rail', line: 'RD', toward: 'Glenmont', minutes: 6 }],
  tracking: {
    trains: [passedDestinationTrain],
    expiresAtMs: now + 20 * 60_000,
  },
}
const passedDestinationResponse = await getLiveTrackerResponse(passedDestinationTrip, {
  now: () => now,
  apiKey: 'test-key',
  fetchVehiclePositions: async () => [{
    ...freshVehicle,
    stopCode: 'A01',
    currentStopSequence: 3,
  }],
  fetchTripUpdates: async () => [{
    tripUpdate: {
      trip: { tripId: 'trip-123', routeId: 'RED' },
      stopTimeUpdate: [
        { stopSequence: 1, stopId: 'PF_A03_1', departure: { time: (now - 10 * 60_000) / 1000 } },
        { stopSequence: 2, stopId: 'PF_A02_1', arrival: { time: (now - 4 * 60_000) / 1000 } },
        { stopSequence: 3, stopId: 'PF_A01_1', arrival: { time: (now - 2 * 60_000) / 1000 } },
      ],
    },
  }],
  getMapData: async () => map,
})
assert.ok(passedDestinationResponse)
assert.equal(passedDestinationResponse.trains[0].phase, 'arrived')
assert.equal(passedDestinationResponse.trains[0].ended, true)
assert.equal(passedDestinationResponse.ended, true)

const conflictingLineResponse = await getLiveTrackerResponse({
  ...trip,
  tracking: {
    trains: [{
      ...trackedTrain,
      departureAtMs: now - 2 * 60_000,
      arrivalAtMs: now + 2 * 60_000,
    }],
    expiresAtMs: now + 32 * 60_000,
  },
}, {
  now: () => now,
  apiKey: 'test-key',
  fetchVehiclePositions: async () => [{ ...freshVehicle, line: 'BL' }],
  fetchTripUpdates: async () => [],
  getMapData: async () => map,
})
assert.ok(conflictingLineResponse)
assert.equal(conflictingLineResponse.trains[0].position?.source, 'schedule')
assert.equal(conflictingLineResponse.trains[0].phase, 'in_transit')

const delayedArrival = now + 8 * 60_000
const tripUpdateResponse = await getLiveTrackerResponse(trip, {
  now: () => now,
  apiKey: 'test-key',
  fetchVehiclePositions: async () => [],
  fetchTripUpdates: async () => [{
    tripUpdate: {
      trip: { tripId: 'trip-123', routeId: 'RED' },
      stopTimeUpdate: [
        { stopSequence: 1, stopId: 'PF_A03_1', departure: { time: (now - 10 * 60_000) / 1000 } },
        { stopSequence: 2, stopId: 'PF_A02_1', arrival: { time: (now + 2 * 60_000) / 1000 } },
        { stopSequence: 3, stopId: 'PF_A01_1', arrival: { time: delayedArrival / 1000 } },
      ],
    },
  }],
  getMapData: async () => map,
})
assert.ok(tripUpdateResponse)
assert.equal(tripUpdateResponse.trains[0].position?.source, 'trip_update')
assert.equal(tripUpdateResponse.trains[0].eta?.arrivalAtMs, delayedArrival)
assert.equal(tripUpdateResponse.trains[0].phase, 'in_transit')

const scheduleTrip: SharedTripPayload = {
  ...trip,
  sharedAtMs: now - 20 * 60_000,
  tracking: {
    trains: [{
      ...trackedTrain,
      departureAtMs: now - 2 * 60_000,
      arrivalAtMs: now + 2 * 60_000,
    }],
    expiresAtMs: now + 32 * 60_000,
  },
}
const scheduleResponse = await getLiveTrackerResponse(scheduleTrip, {
  now: () => now,
  getMapData: async () => map,
})
assert.ok(scheduleResponse)
assert.equal(scheduleResponse.trains[0].position?.source, 'schedule')
// Schedule estimates are recomputed every poll: fresh, just not vehicle-live.
assert.equal(scheduleResponse.trains[0].freshness.isStale, false)
assert.equal(scheduleResponse.trains[0].freshness.updatedAtMs, now)
assert.equal(scheduleResponse.trains[0].progress, 0.5)

let upstreamCalls = 0
const expiredResponse = await getLiveTrackerResponse({
  ...trip,
  tracking: { trains: [trackedTrain], expiresAtMs: now - 1 },
}, {
  now: () => now,
  apiKey: 'test-key',
  fetchVehiclePositions: async () => { upstreamCalls++; return [] },
  fetchTripUpdates: async () => { upstreamCalls++; return [] },
  getMapData: async () => { upstreamCalls++; return map },
})
assert.ok(expiredResponse)
assert.equal(expiredResponse.expired, true)
assert.equal(expiredResponse.ended, true)
assert.equal(upstreamCalls, 0, 'expired trackers must not poll or load live dependencies')

const exits = new Map<string, StationExit[]>([
  ['A01_C01', [{ id: 'mc-1', name: 'Metro Center', lat: 38.9, lon: -77.03, isAccessible: true }]],
  ['B01_F01', [{ id: 'gp-1', name: 'Gallery Place', lat: 38.898, lon: -77.021, isAccessible: true }]],
])
const metroMap = buildMetroMapData({ exits, now: () => now })
assert.equal(metroMap.generatedAtMs, now)
assert.equal(metroMap.stations.filter(station => station.code === 'A01').length, 1)
assert.ok(metroMap.stations.some(station => station.code === 'B01'))
assert.ok(metroMap.stations.some(station => station.code === 'F01'))
assert.deepEqual(
  metroMap.stations.find(station => station.code === 'B01'),
  { code: 'B01', name: 'Gallery Place', lines: ['RD', 'YL', 'GR'], lat: 38.898, lon: -77.021 }
)
assert.ok(metroMap.paths.some(path => path.line === 'RD' && path.stationCodes.includes('A01')))

// --- Two-leg transfer: connection outlook + rider's own train never ghosts.
const greenStops: Station[] = [
  { code: 'F01', name: 'Gallery Place', lines: ['GR', 'YL'] },
  { code: 'F02', name: 'Archives', lines: ['GR', 'YL'] },
  { code: 'F03', name: 'L’Enfant Plaza', lines: ['GR', 'YL'] },
]
const transferMap: MetroMapData = {
  generatedAtMs: now,
  stations: [
    ...map.stations,
    { code: 'B01', name: 'Gallery Place', lines: ['RD'], lat: 38.898, lon: -77.021 },
    ...greenStops.map((station, index) => ({
      ...station,
      lat: 38.898 - index * 0.005,
      lon: -77.021 - index * 0.002,
    })),
    { code: 'F11', name: 'Branch Ave', lines: ['GR'], lat: 38.826, lon: -76.912 },
  ],
  paths: [],
}
const legOne: SharedTrackedTrain = {
  ...trackedTrain,
  id: 'leg-1',
  to: { code: 'B01', name: 'Gallery Place', lines: ['RD'] },
  stops: [...stops, { code: 'B01', name: 'Gallery Place', lines: ['RD'] }],
  departureAtMs: now - 8 * 60_000,
  arrivalAtMs: now + 2 * 60_000,
}
const legTwo: SharedTrackedTrain = {
  id: 'leg-2',
  leg: 2,
  line: 'GR',
  toward: 'Branch Ave',
  tripId: 'trip-456',
  from: greenStops[0],
  to: greenStops[2],
  stops: [...greenStops],
  departureAtMs: now + 6 * 60_000,
  arrivalAtMs: now + 12 * 60_000,
}
const riderTwinVehicle: RailVehiclePosition = {
  ...freshVehicle,
  entityId: 'vehicle-twin',
  vehicleId: 'vehicle-twin',
  tripId: 'trip-123',
  stopCode: 'A02',
}
const strangerVehicle: RailVehiclePosition = {
  ...freshVehicle,
  entityId: 'vehicle-stranger',
  vehicleId: 'vehicle-stranger',
  tripId: 'trip-777',
  stopCode: 'A02',
}
const transferResponse = await getLiveTrackerResponse({
  ...trip,
  destination: greenStops[2],
  transferName: 'Gallery Place',
  tracking: { trains: [legOne, legTwo], expiresAtMs: now + 60 * 60_000 },
}, {
  now: () => now,
  apiKey: 'test-key',
  fetchVehiclePositions: async () => [freshVehicle, riderTwinVehicle, strangerVehicle],
  fetchTripUpdates: async () => [],
  fetchStationPredictions: async stationCode => {
    assert.equal(stationCode, 'F01')
    return [
      { Line: 'GR', DestinationName: 'Branch Ave', Min: 'BRD', Car: '8' },
      // WMATA abbreviates prediction names; the filter must still match.
      { Line: 'GR', DestinationName: 'Branch Av', DestinationCode: null, Min: '7', Car: '8' },
      { Line: 'GR', DestinationName: 'Greenbelt', Min: '3', Car: '8' },
      { Line: 'YL', DestinationName: 'Branch Ave', Min: '2', Car: '6' },
    ]
  },
  getMapData: async () => transferMap,
})
assert.ok(transferResponse)
assert.ok(transferResponse.connection, 'two-leg trips expose a connection outlook')
assert.equal(transferResponse.connection?.atCode, 'F01')
assert.equal(transferResponse.connection?.line, 'GR')
assert.equal(transferResponse.connection?.toward, 'Branch Ave')
assert.equal(
  transferResponse.connection?.boardsAtMs,
  transferResponse.trains[1].nextStop?.expectedAtMs
)
assert.deepEqual(
  transferResponse.connection?.alternatives,
  [
    { minutes: 0, destinationName: 'Branch Ave' },
    { minutes: 7, destinationName: 'Branch Av' },
  ],
  'alternatives keep only same-line, same-direction departures'
)
const legOneGhosts = transferResponse.trains[0].otherTrains ?? []
assert.ok(
  !legOneGhosts.some(ghost => ghost.id === 'vehicle-twin'),
  'the tracked trip id never rides the map as a ghost'
)
assert.ok(
  legOneGhosts.some(ghost => ghost.id === 'vehicle-stranger'),
  'unrelated same-line trains still ghost'
)

console.log('live tracker tests passed')
