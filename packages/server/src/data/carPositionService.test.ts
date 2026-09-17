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

function terminalArrivalsUseTheInboundOrientation() {
  // Expected front-to-back positions from the source terminal diagrams. Both
  // platform faces point into the terminal, regardless of the arrival track.
  const cases = [
    { code: 'C15', line: 'YL', destination: 'Huntington', car: 6, door: 3 },
    { code: 'F11', line: 'GR', destination: 'Branch Ave', car: 6, door: 1 },
    { code: 'G05', line: 'BL', destination: 'Largo', car: 6, door: 2 },
    { code: 'G05', line: 'SV', destination: 'Downtown Largo', car: 6, door: 2 },
    { code: 'B11', line: 'RD', destination: 'Glenmont', car: 5, door: 3 },
    { code: 'E10', line: 'GR', destination: 'Greenbelt', car: 3, door: 3 },
    { code: 'D13', line: 'OR', destination: 'New Carrollton', car: 6, door: 2 },
    { code: 'N12', line: 'SV', destination: 'Ashburn', car: 5, door: 3 },
    { code: 'J03', line: 'BL', destination: 'Franconia-Springfield', car: 4, door: 2 },
    { code: 'A15', line: 'RD', destination: 'Shady Grove', car: 5, door: 1 },
    { code: 'K08', line: 'OR', destination: 'Vienna', car: 7, door: 1 },
  ]

  for (const { code, line, destination, car, door } of cases) {
    const result = getDirectTripCarPosition(code, line, destination)
    assert.equal(result.boardCar, car, `${destination}: boarding advice must use arrival orientation`)
    assert.equal(result.exitCar, car, `${destination}: car numbering must stay fixed during the ride`)
    assert.equal(result.details?.doorRecommendation?.car, car, `${destination}: door and car advice must agree`)
    assert.equal(result.details?.doorRecommendation?.door, door, `${destination}: door order must follow arrival direction`)
  }

  console.log('✓ all ten terminal stations use inbound car and door orientation')
}

function huntingtonExitsAndMarkersUseArrivalOrientation() {
  for (const accessible of [false, true]) {
    const result = getDirectTripCarPosition('C15', 'YL', 'Huntington', accessible)
    assert.equal(result.boardCar, 6)
    assert.equal(result.details?.exitType, accessible ? 'elevator' : 'escalator')
    assert.equal(result.details?.trainXPosition, accessible ? 46 : 53)
    assert.equal(result.details?.doorRecommendation?.door, accessible ? 1 : 3)

    for (const options of [result.exits, result.allExits, result.platformMarkers]) {
      assert.ok(options?.length, 'every rendered exit collection must be populated')
      const kingsHighway = options.find(exit => exit.xPosition === 71)
      assert.equal(kingsHighway?.car, 1, 'Kings Highway remains a distinct exit at the front')
      assert.equal(kingsHighway?.trainXPosition, 1)
      for (const exit of options) {
        assert.equal(exit.doorRecommendation?.car, exit.car, 'exit markers and door advice must agree')
      }
    }
    const huntingtonAve = result.platformMarkers?.find(exit => exit.exitLabel === 1)
    assert.equal(huntingtonAve?.car, 6)
    assert.equal(huntingtonAve?.xPosition, 19, 'physical exit coordinates must not change')
    assert.equal(huntingtonAve?.trainXPosition, 53)
    assert.equal(huntingtonAve?.doorRecommendation?.door, 3)

    const transfer = getTransferCarPosition('D03', 'OR', 'YL', 'New Carrollton', 'C15', 'Huntington', accessible)
    assert.equal(transfer.leg2.boardCar, result.boardCar)
    assert.equal(transfer.leg2.exitCar, result.exitCar)
    assert.deepEqual(transfer.leg2.details, result.details)
    assert.deepEqual(transfer.leg2.exits, result.exits)
    assert.deepEqual(transfer.leg2.allExits, result.allExits)
    assert.deepEqual(transfer.leg2.platformMarkers, result.platformMarkers)
  }

  console.log('✓ Huntington direct and transfer guidance keeps all exits, doors, and accessibility markers oriented on arrival')
}

function nonTerminalTripsKeepDirectionSpecificAdvice() {
  const southbound = getDirectTripCarPosition('C14', 'YL', 'Huntington')
  const northbound = getDirectTripCarPosition('C14', 'YL', 'Mt Vernon Sq')
  assert.equal(southbound.boardCar, 4)
  assert.equal(northbound.boardCar, 5)
  assert.equal(getDirectTripCarPosition('E01', 'YL', 'Mt Vernon Sq').boardCar, 7,
    'a short-turn destination on a through platform must still use its destination mapping')

  console.log('✓ through stations retain direction-specific advice, including short turns')
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
terminalArrivalsUseTheInboundOrientation()
huntingtonExitsAndMarkersUseArrivalOrientation()
nonTerminalTripsKeepDirectionSpecificAdvice()
platformMarkersRemainCompleteAndOriented()

console.log('carPositionService tests passed')
