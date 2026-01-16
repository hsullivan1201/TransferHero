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
  console.log('✓ dedupes gtfs trains when a wmata prediction is nearby')
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
  console.log('✓ dedupes gtfs when same line within one minute even if dest differs')
}

dedupesGtfsAgainstApi()
keepsGtfsWhenFarApart()
dedupesWhenGtfsHasCheckBoardHeadSign()
dedupesWhenTimesAreWithinOneMinuteDifferentDest()

console.log('trainMerger tests passed')

