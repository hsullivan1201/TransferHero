import assert from 'node:assert/strict'
import type { Line } from '@transferhero/shared'
import {
  findClosestDoor,
  findPlatformForLine,
  getDirectTripCarPosition,
  getDoorRecommendation,
  getStation,
  getTrackDirection,
  getTransferCarPosition,
} from './carPositionService.js'
import { LINE_PATHS, TERMINI } from './lineConfig.js'
import { ALL_STATIONS } from './stations.js'

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

function shortTurnsKeepTheirDirectionsOrientation() {
  // A terminus missing from a diagram's labels used to fall back to track 1,
  // mirroring every exit for trains headed the other way (e.g. Red Line trains
  // to Fort Totten, Yellow Line trains to Pentagon City or Greenbelt).
  const nameOf = (code: string) => ALL_STATIONS.find(station => station.code === code)!.name
  const indexOf = (path: string[], name: string) => {
    const code = ALL_STATIONS.find(station => station.name === name)?.code
    return code ? path.indexOf(code) : -1
  }
  let checked = 0

  for (const [line, paths] of Object.entries(LINE_PATHS) as [Line, string[][]][]) {
    for (const path of paths) {
      for (let here = 1; here < path.length - 1; here++) {
        const code = path[here]
        const platform = findPlatformForLine(getStation(code)!, line)
        assert.ok(platform, `${line} must have a platform at ${code}`)
        if (platform.platformType.startsWith('terminus')) continue
        const context = { stationCode: code, line }

        const towardA = getTrackDirection(platform, nameOf(path[0]), context)
        const towardB = getTrackDirection(platform, nameOf(path[path.length - 1]), context)
        assert.notEqual(towardA, towardB, `${line} at ${code}: opposite directions must not share a track`)

        for (const [termini, expected, ahead] of [
          [TERMINI[line].toward_a, towardA, (index: number) => index >= 0 && index < here],
          [TERMINI[line].toward_b, towardB, (index: number) => index > here],
        ] as const) {
          for (const terminus of termini) {
            if (!ahead(indexOf(path, terminus))) continue
            assert.equal(
              getTrackDirection(platform, terminus, context),
              expected,
              `${line} at ${code} toward ${terminus} must face the same way as its end of the line`
            )
            checked++
          }
        }
      }
    }
  }

  console.log(`✓ ${checked} short-turn and through destinations keep their direction's orientation`)
}

function yellowLineExtensionStationsHaveOrientedExits() {
  // U Street: 13th & U is the west end, 10th & U the east end.
  const southbound = getDirectTripCarPosition('E03', 'YL', 'Huntington')
  const northbound = getDirectTripCarPosition('E03', 'YL', 'Greenbelt')
  assert.deepEqual(southbound.platformMarkers, getDirectTripCarPosition('E03', 'GR', 'Branch Ave').platformMarkers)
  assert.deepEqual(northbound.platformMarkers, getDirectTripCarPosition('E03', 'GR', 'Greenbelt').platformMarkers)

  const carFor = (result: typeof southbound, description: string, type: string) =>
    result.platformMarkers?.find(marker => marker.description === description && marker.type === type)?.car
  assert.equal(carFor(southbound, '10th & U St', 'escalator'), 2, 'southbound trains lead with the 10th St end')
  assert.equal(carFor(southbound, '13th & U St', 'escalator'), 7)
  assert.equal(carFor(northbound, '10th & U St', 'escalator'), 7, 'northbound trains lead with the 13th St end')
  assert.equal(carFor(northbound, '13th & U St', 'escalator'), 2)

  const fortTotten = getTransferCarPosition('B06', 'RD', 'YL', 'Glenmont', 'E03', 'Huntington')
  assert.notEqual(fortTotten.leg1.confidence, 'low', 'Red to Yellow at Fort Totten needs real transfer guidance')
  assert.deepEqual(fortTotten.leg2.platformMarkers, southbound.platformMarkers)

  console.log('✓ Yellow Line stops north of Mt Vernon Sq get the same oriented exits as Green Line trains')
}

function lEnfantTransfersUseTheConnectingEscalators() {
  // Lower level: the Exit A escalators split by Green/Yellow direction.
  const toBranchAve = getTransferCarPosition('D03', 'BL', 'GR', 'Downtown Largo', 'F06', 'Branch Ave')
  const toGreenbelt = getTransferCarPosition('D03', 'OR', 'GR', 'New Carrollton', 'E03', 'Greenbelt')
  assert.equal(toBranchAve.leg1.details?.xPosition, 38)
  assert.equal(toGreenbelt.leg1.details?.xPosition, 48)
  // A destination the signs don't name still finds the line by its name.
  const toPentagonCity = getTransferCarPosition('D03', 'BL', 'YL', 'Downtown Largo', 'C08', 'Pentagon City')
  assert.match(toPentagonCity.leg1.details?.exitDescription ?? '', /Green\/Yellow Line/)

  // Upper level: each side platform has its own way down to BL/OR/SV, which
  // must beat the "Opposite Platform" escalator.
  for (const incoming of ['Greenbelt', 'Branch Ave']) {
    const transfer = getTransferCarPosition('F03', 'GR', 'OR', incoming, 'D08', 'New Carrollton')
    assert.equal(transfer.leg1.details?.xPosition, 46, `GR toward ${incoming} to OR`)
    assert.match(transfer.leg1.details?.exitDescription ?? '', /BL\/OR\/SV Trains/)
  }

  console.log("✓ L'Enfant Plaza transfers use the escalators to the connecting line")
}

accessibleTransferPrefersElevator()
exactDoorGeometryIsTrainOriented()
lEnfantTransfersUseTheConnectingEscalators()
shortTurnsKeepTheirDirectionsOrientation()
yellowLineExtensionStationsHaveOrientedExits()
terminalArrivalsUseTheInboundOrientation()
huntingtonExitsAndMarkersUseArrivalOrientation()
nonTerminalTripsKeepDirectionSpecificAdvice()
platformMarkersRemainCompleteAndOriented()

console.log('carPositionService tests passed')
