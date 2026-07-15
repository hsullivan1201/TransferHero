import assert from 'node:assert/strict'
import {
  findClosestDoor,
  getDirectTripCarPosition,
  getDoorRecommendation,
  getTransferCarPosition,
} from './carPositionService.js'

function exactDoorGeometryIsTrainOriented() {
  assert.deepEqual(
    findClosestDoor(5),
    { car: 1, door: 2, doorX: 5, distance: 0 },
    'the middle physical doorway should be identified exactly'
  )

  const track1 = getDoorRecommendation(2.25, 'track1')
  const track2 = getDoorRecommendation(2.25, 'track2')
  assert.deepEqual(
    { car: track1.car, door: track1.door },
    { car: 1, door: 1 },
    'track 1 should preserve front-to-back orientation'
  )
  assert.deepEqual(
    { car: track2.car, door: track2.door },
    { car: 8, door: 3 },
    'track 2 should mirror both the car and within-car door order'
  )
}

function accessibleTransferPrefersElevator() {
  const result = getTransferCarPosition(
    'F01',       // transfer station (Gallery Place lower - incoming YL)
    'YL',        // incoming line
    'RD',        // outgoing line
    'Greenbelt', // incoming destination (direction for track)
    'B35',       // final destination (NoMa-Gallaudet U)
    'Glenmont',  // outgoing destination (direction for track)
    true         // accessible mode
  )

  assert.equal(result.leg1.details?.exitType, 'elevator')
  assert.ok(result.leg1.legend.toLowerCase().includes('elevator'), 'leg1 legend should call out the elevator transfer')

  const leg2Elevator = result.leg2.exits?.find(e => e.type === 'elevator')
  assert.ok(leg2Elevator, 'leg2 exits should include an elevator in accessible mode')

  console.log('✓ accessible transfer prefers elevator for leg1 and keeps elevator exits for leg2')
}

function platformMarkersRemainCompleteAndOriented() {
  const standard = getDirectTripCarPosition('B03', 'RD', 'Glenmont', false)
  const accessible = getDirectTripCarPosition('B03', 'RD', 'Glenmont', true)

  assert.deepEqual(
    standard.platformMarkers,
    accessible.platformMarkers,
    'accessibility should change the primary recommendation, not hide physical platform markers'
  )
  assert.ok(standard.platformMarkers?.some(marker => marker.type === 'elevator'))
  assert.ok(standard.platformMarkers?.some(marker => marker.type === 'escalator'))
  assert.ok(standard.platformMarkers?.some(marker => marker.type === 'stairs'))

  const massAve = standard.platformMarkers?.find(marker => marker.description === 'Mass Ave')
  assert.equal(massAve?.trainXPosition, 55, 'track 2 should mirror x=17 into the train frame')

  const farEndMarkers = standard.platformMarkers?.filter(marker => marker.xPosition === 71)
  assert.equal(farEndMarkers?.length, 2, 'same-position elevator and escalator markers must both survive')
  assert.ok(farEndMarkers?.every(marker => marker.trainXPosition === 1))

  const transfer = getTransferCarPosition(
    'A01',
    'OR',
    'RD',
    'New Carrollton',
    'B03',
    'Glenmont',
    false
  )
  assert.ok(transfer.leg1.platformMarkers?.length, 'first-leg transfer diagrams need incoming-platform markers')
  assert.ok(transfer.leg2.platformMarkers?.length, 'second-leg diagrams need destination-platform markers')

  console.log('✓ platform markers stay complete, distinct, and train-oriented')
}

accessibleTransferPrefersElevator()
exactDoorGeometryIsTrainOriented()
platformMarkersRemainCompleteAndOriented()

console.log('carPositionService tests passed')
