import assert from 'node:assert/strict'
import type { Train } from '@transferhero/shared'
import { mergeTrainData } from './trainMerger.js'

const apiTrain = (overrides: Partial<Train> = {}): Train => ({
  Line: 'RD',
  DestinationName: 'Vienna',
  Min: '4',
  Car: '8',
  ...overrides
})

const gtfsTrain = (overrides: Partial<Train> = {}): Train => ({
  Line: 'RD',
  DestinationName: 'Vienna/Fairfax-GMU',
  Min: '5',
  Car: '8',
  _gtfs: true,
  _scheduled: false,
  _tripId: 'trip-1',
  ...overrides
})

function dedupesGtfsAgainstApi() {
  const result = mergeTrainData({
    apiTrains: [apiTrain()],
    gtfsTrains: [gtfsTrain()],
    gtfsThreshold: 3
  })

  assert.equal(result.length, 1)
  assert.equal(result[0]._gtfs, undefined)
  assert.equal(result[0]._tripId, 'trip-1')
  console.log('✓ dedupes gtfs trains when a wmata prediction is nearby')
}

function preservesApiPredictionWhileAddingGtfsTripId() {
  const source = apiTrain({
    TrainId: 'wmata-42',
    TrainNumber: '042',
    DestinationName: 'Vienna/Fairfax-GMU',
    Min: '4',
  })
  const result = mergeTrainData({
    apiTrains: [source],
    gtfsTrains: [gtfsTrain({ _tripId: 'gtfs-trip-42', Min: '5' })],
    gtfsThreshold: 3,
  })

  assert.equal(result.length, 1)
  assert.equal(result[0].TrainId, 'wmata-42')
  assert.equal(result[0].TrainNumber, '042')
  assert.equal(result[0].Min, '4')
  assert.equal(result[0]._tripId, 'gtfs-trip-42')
  assert.equal(source._tripId, undefined, 'source prediction must not be mutated')
  console.log('✓ enriches the WMATA winner with the matching GTFS trip id')
}

function keepsGtfsWhenFarApart() {
  const result = mergeTrainData({
    apiTrains: [apiTrain({ Min: '2' })],
    gtfsTrains: [gtfsTrain({ Min: '10', _tripId: 'trip-2' })],
    gtfsThreshold: 3
  })

  assert.equal(result.length, 2)
  const gtfs = result.find(t => t._gtfs)
  assert.ok(gtfs)
  assert.equal(gtfs?.Min, '10')
  console.log('✓ keeps gtfs trains when no nearby api prediction exists')
}

function dedupesWhenGtfsHasCheckBoardHeadSign() {
  const result = mergeTrainData({
    apiTrains: [apiTrain({ Min: 'ARR' })],
    gtfsTrains: [gtfsTrain({ Min: '1', DestinationName: 'Check Board (GTFS)', _tripId: 'trip-3' })],
    gtfsThreshold: 3
  })

  assert.equal(result.length, 1)
  assert.equal(result[0]._gtfs, undefined)
  console.log('✓ dedupes gtfs when destination is Check Board and times align')
}

function dedupesWhenTimesAreWithinOneMinuteDifferentDest() {
  const result = mergeTrainData({
    apiTrains: [apiTrain({ Min: '2', DestinationName: 'Shady Grove' })],
    gtfsTrains: [gtfsTrain({ Min: '3', DestinationName: 'Glenmont', _tripId: 'trip-4' })],
    gtfsThreshold: 3
  })

  assert.equal(result.length, 1)
  assert.equal(result[0]._gtfs, undefined)
  assert.equal(result[0]._tripId, undefined)
  console.log('✓ dedupes gtfs when same line within one minute even if dest differs')
}

function preservesNearSimultaneousScheduledTrainOnAnotherLine() {
  const result = mergeTrainData({
    apiTrains: [apiTrain({ Line: 'BL', DestinationName: 'Downtown Largo', Min: '4' })],
    gtfsTrains: [],
    scheduledTrains: [apiTrain({ Line: 'YL', DestinationName: 'Greenbelt', Min: '5' })],
  })

  assert.deepEqual(result.map(train => train.Line), ['BL', 'YL'])
  console.log('✓ keeps near-simultaneous scheduled trains on different interlined services')
}

function assignsDenseGtfsIdentitiesOneToOne() {
  const result = mergeTrainData({
    apiTrains: [
      apiTrain({ Min: '2', DestinationName: 'Vienna/Fairfax-GMU' }),
      apiTrain({ Min: '4', DestinationName: 'Vienna/Fairfax-GMU' }),
    ],
    gtfsTrains: [
      gtfsTrain({ Min: '3', _tripId: 'dense-trip-1' }),
      gtfsTrain({ Min: '5', _tripId: 'dense-trip-2' }),
    ],
    gtfsThreshold: 3,
  })

  assert.equal(result.length, 2)
  assert.deepEqual(result.map(train => train._tripId), ['dense-trip-1', 'dense-trip-2'])
  console.log('✓ assigns dense-service GTFS trip ids one-to-one in train order')
}

function maximizesIdentityMatchesBeforeDistance() {
  const result = mergeTrainData({
    apiTrains: [
      apiTrain({ Min: '0', DestinationName: 'Vienna/Fairfax-GMU' }),
      apiTrain({ Min: '4', DestinationName: 'Vienna/Fairfax-GMU' }),
    ],
    gtfsTrains: [
      gtfsTrain({ Min: '3', _tripId: 'edge-trip-1' }),
      gtfsTrain({ Min: '6', _tripId: 'edge-trip-2' }),
    ],
    gtfsThreshold: 3,
  })

  assert.deepEqual(result.slice(0, 2).map(train => train._tripId), ['edge-trip-1', 'edge-trip-2'])
  console.log('✓ preserves the maximum number of stable identities at threshold edges')
}

dedupesGtfsAgainstApi()
preservesApiPredictionWhileAddingGtfsTripId()
keepsGtfsWhenFarApart()
dedupesWhenGtfsHasCheckBoardHeadSign()
dedupesWhenTimesAreWithinOneMinuteDifferentDest()
preservesNearSimultaneousScheduledTrainOnAnotherLine()
assignsDenseGtfsIdentitiesOneToOne()
maximizesIdentityMatchesBeforeDistance()

console.log('trainMerger tests passed')
