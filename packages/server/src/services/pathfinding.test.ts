import assert from 'node:assert/strict'
import type { Line, Transfer, TransferAlternative, TransferResult } from '@transferhero/shared'
import { LINE_PATHS } from '../data/lineConfig.js'
import { getAllPlatformCodes, getPlatformForLine, normalizePlatformCode } from '../data/platformCodes.js'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'
import { TRAVEL_TIMES } from '../data/travelTimes.js'
import {
  getInterlinedLinesForLeg,
  getLineSegmentsForLeg,
  getStopsBeyondDestination,
  lineCanServeLeg,
} from './lineHelpers.js'
import {
  evaluateTransferRoute,
  findAllPossibleTransfers,
  findTransfer,
  getAllTerminiForStation,
} from './pathfinding.js'
import { calculateRouteTravelTime, getTerminus } from './travelTime.js'

const ALL_LINES: Line[] = ['RD', 'OR', 'SV', 'BL', 'YL', 'GR']

function hasMeasuredEdge(fromCode: string, toCode: string): boolean {
  const fromCodes = getAllPlatformCodes(fromCode)
  const toCodes = getAllPlatformCodes(toCode)

  return fromCodes.some(from => toCodes.some(to => {
    const forward = TRAVEL_TIMES[`${from}_${to}`]
    const reverse = TRAVEL_TIMES[`${to}_${from}`]
    return (Number.isFinite(forward) && forward > 0)
      || (Number.isFinite(reverse) && reverse > 0)
  }))
}

function assertsTopologyInvariants() {
  for (const line of ALL_LINES) {
    const paths = LINE_PATHS[line]
    assert.ok(paths.length > 0, `${line} must have at least one revenue-service path`)

    for (const path of paths) {
      assert.ok(path.length > 1, `${line} paths must contain at least two stations`)
      assert.equal(new Set(path).size, path.length, `${line} path must not repeat a station`)

      for (const code of path) {
        const station = findStationByCode(code)
        assert.ok(station, `${line} path references unknown station ${code}`)
        assert.ok(
          station.lines.includes(line),
          `${station.name} (${code}) is on the ${line} path but omits ${line} in station metadata`
        )
      }

      for (let index = 0; index < path.length - 1; index += 1) {
        const from = path[index]
        const to = path[index + 1]
        assert.ok(hasMeasuredEdge(from, to), `${line} edge ${from} → ${to} has no measured travel time`)
        assert.ok(
          Number.isFinite(calculateRouteTravelTime(from, to, line)),
          `${line} edge ${from} → ${to} must be traversable`
        )
      }
    }
  }

  for (const station of ALL_STATIONS) {
    for (const line of station.lines) {
      const platformCode = getPlatformForLine(station.code, line)
      const appearsOnLine = LINE_PATHS[line].some(path => {
        const normalized = normalizePlatformCode(platformCode, path)
        return path.includes(normalized)
      })
      assert.ok(
        appearsOnLine,
        `${station.name} (${station.code}) claims ${line}, but no ${line} path serves its platform`
      )
    }
  }

  console.log('✓ line paths, station metadata, and measured adjacent edges agree')
}

function assertsExactInterlineMatrix() {
  const cases: Array<{
    plannedLine: Line
    from: string
    to: string
    expected: Line[]
  }> = [
    { plannedLine: 'RD', from: 'A15', to: 'B11', expected: ['RD'] },
    { plannedLine: 'OR', from: 'K08', to: 'K05', expected: ['OR'] },
    { plannedLine: 'OR', from: 'K05', to: 'C05', expected: ['OR', 'SV'] },
    { plannedLine: 'SV', from: 'N12', to: 'K05', expected: ['SV'] },
    { plannedLine: 'OR', from: 'K05', to: 'D08', expected: ['OR', 'SV'] },
    { plannedLine: 'BL', from: 'C05', to: 'D08', expected: ['OR', 'SV', 'BL'] },
    { plannedLine: 'BL', from: 'J03', to: 'C13', expected: ['BL'] },
    { plannedLine: 'BL', from: 'C13', to: 'C07', expected: ['BL', 'YL'] },
    { plannedLine: 'BL', from: 'C13', to: 'C05', expected: ['BL'] },
    { plannedLine: 'YL', from: 'C13', to: 'F03', expected: ['YL'] },
    { plannedLine: 'YL', from: 'F03', to: 'E10', expected: ['YL', 'GR'] },
    { plannedLine: 'GR', from: 'F11', to: 'F03', expected: ['GR'] },
    { plannedLine: 'SV', from: 'D08', to: 'G05', expected: ['SV', 'BL'] },
    { plannedLine: 'SV', from: 'D08', to: 'D13', expected: ['OR', 'SV'] },
    { plannedLine: 'SV', from: 'G05', to: 'D13', expected: [] },
  ]

  for (const testCase of cases) {
    assert.deepEqual(
      getInterlinedLinesForLeg(
        testCase.plannedLine,
        ALL_LINES,
        testCase.from,
        testCase.to
      ),
      testCase.expected,
      `${testCase.plannedLine} ${testCase.from} → ${testCase.to} interline set`
    )
  }

  console.log('✓ exact-track interline matrix excludes diverging and disconnected branches')
}

function asRouteList(result: TransferResult): Array<TransferResult | TransferAlternative> {
  return [result, ...(result.alternatives ?? [])]
}

function includesRoute(
  routes: Array<TransferResult | TransferAlternative>,
  expected: Partial<Transfer>
): boolean {
  return routes.some(route => Object.entries(expected).every(
    ([key, value]) => route[key as keyof Transfer] === value
  ))
}

function offersBothKingStreetStrategies() {
  const result = findTransfer('C13', 'K04')
  assert.ok(result, 'King St → Ballston must produce a route')
  assert.notEqual(result.direct, true)

  const routes = asRouteList(result)
  assert.ok(
    includesRoute(routes, { station: 'C05', fromLine: 'BL', fromPlatform: 'C05' }),
    'King St → Ballston must offer Blue to Rosslyn'
  )
  assert.ok(
    includesRoute(routes, {
      station: 'D03',
      fromLine: 'YL',
      fromPlatform: 'F03',
      toPlatform: 'D03',
    }),
    "King St → Ballston must retain the Yellow/L'Enfant alternative"
  )
  assert.ok(
    routes.every(route => Number.isFinite(route.leg1Time) && Number.isFinite(route.leg2Time)),
    'displayed alternatives must contain two valid measured legs'
  )

  console.log("✓ King St → Ballston offers Blue/Rosslyn and Yellow/L'Enfant")
}

function routesThroughPhysicalAliasEndpointsDirectly() {
  const cases: Array<{
    from: string
    to: string
    expectedLines: Line[]
  }> = [
    { from: 'A15', to: 'F01', expectedLines: ['RD'] },
    { from: 'A15', to: 'E06', expectedLines: ['RD'] },
    { from: 'K04', to: 'F03', expectedLines: ['OR', 'SV'] },
    { from: 'F03', to: 'K04', expectedLines: ['OR', 'SV'] },
  ]

  for (const testCase of cases) {
    const result = findTransfer(testCase.from, testCase.to)
    assert.ok(result, `${testCase.from} → ${testCase.to} must produce a route`)
    assert.equal(
      result.direct,
      true,
      `${testCase.from} → ${testCase.to} must stay direct across a physical-station alias`
    )
    assert.ok(
      result.line && testCase.expectedLines.includes(result.line),
      `${testCase.from} → ${testCase.to} must use ${testCase.expectedLines.join('/')}`
    )
  }

  for (const line of ['OR', 'SV'] as Line[]) {
    assert.ok(Number.isFinite(calculateRouteTravelTime('K04', 'F03', line)))
    assert.ok(Number.isFinite(calculateRouteTravelTime('F03', 'K04', line)))
  }

  console.log('✓ physical alias endpoints preserve direct routes and their real lines')
}

function offersReverseYellowStrategy() {
  const result = findTransfer('K04', 'C13')
  assert.ok(result, 'Ballston → King St must produce a route')
  assert.notEqual(result.direct, true)

  assert.ok(
    includesRoute(asRouteList(result), {
      station: 'D03',
      fromLine: 'OR',
      toLine: 'YL',
      fromPlatform: 'D03',
      toPlatform: 'F03',
    }),
    "Ballston → King St must retain the Orange/L'Enfant/Yellow alternative"
  )

  console.log("✓ Ballston → King St offers the Orange/L'Enfant/Yellow alternative")
}

function treatsPhysicalAliasesAsTheSameEndpoint() {
  const aliasPairs: Array<[string, string]> = [
    ['B01', 'F01'],
    ['D03', 'F03'],
    ['B06', 'E06'],
  ]

  for (const [canonical, alias] of aliasPairs) {
    assert.equal(
      findTransfer(canonical, alias),
      null,
      `${canonical} → ${alias} is already at the same physical station`
    )
    assert.equal(
      findTransfer(alias, canonical),
      null,
      `${alias} → ${canonical} is already at the same physical station`
    )
  }

  console.log('✓ platform aliases at one physical station do not create circuitous trips')
}

function suppressesAmbiguousStopsBeyondSilverTrunk() {
  const cases: Array<{
    to: string
    limit: number
    expected: string[]
  }> = [
    { to: 'D06', limit: 4, expected: ['D07', 'D08'] },
    { to: 'D07', limit: 3, expected: ['D08'] },
    { to: 'D08', limit: 3, expected: [] },
  ]

  for (const testCase of cases) {
    assert.deepEqual(
      getStopsBeyondDestination('SV', 'C05', testCase.to, testCase.limit).map(station => station.code),
      testCase.expected,
      `Silver stops beyond ${testCase.to} must end before choosing an east branch`
    )
  }

  console.log('✓ Silver trunk previews stop at the branch divergence')
}

function rejectsYellowToRosslyn() {
  assert.equal(lineCanServeLeg('YL', 'C13', 'C05'), false)
  assert.deepEqual(getLineSegmentsForLeg('YL', 'C13', 'C05'), [])
  assert.equal(calculateRouteTravelTime('C13', 'C05', 'YL'), Number.POSITIVE_INFINITY)

  const impossibleTransfer: Transfer = {
    station: 'C05',
    name: 'Rosslyn',
    fromPlatform: 'C05',
    toPlatform: 'C05',
    fromLine: 'YL',
    toLine: 'OR',
  }
  const evaluated = evaluateTransferRoute('C13', 'K04', impossibleTransfer)
  assert.equal(evaluated.leg1Time, Number.POSITIVE_INFINITY)
  assert.equal(evaluated.totalTime, Number.POSITIVE_INFINITY)

  const generated = findAllPossibleTransfers('C13', 'K04')
  assert.equal(
    generated.some(transfer => transfer.station === 'C05' && transfer.fromLine === 'YL'),
    false,
    'pathfinding must never synthesize Yellow to Rosslyn'
  )

  console.log('✓ Yellow cannot serve King St → Rosslyn or leak into generated transfers')
}

function treatsSilverBranchesAsDisconnected() {
  assert.equal(lineCanServeLeg('SV', 'G05', 'D13'), false)
  assert.deepEqual(getLineSegmentsForLeg('SV', 'G05', 'D13'), [])
  assert.equal(calculateRouteTravelTime('G05', 'D13', 'SV'), Number.POSITIVE_INFINITY)

  const result = findTransfer('G05', 'D13')
  assert.ok(result, 'Largo → New Carrollton must still be routable with a transfer')
  assert.notEqual(result.direct, true, 'sharing Silver metadata cannot make separate branches direct')
  assert.ok(
    asRouteList(result).every(route => Number.isFinite(route.leg1Time) && Number.isFinite(route.leg2Time)),
    'Silver branch alternatives must contain valid legs'
  )

  console.log('✓ separate Silver termini require a transfer despite shared line metadata')
}

function returnsRouteSpecificTermini() {
  assert.deepEqual(getTerminus('SV', 'D08', 'G05'), ['Downtown Largo'])
  assert.deepEqual(getTerminus('SV', 'D08', 'D13'), ['New Carrollton'])
  assert.deepEqual(getTerminus('SV', 'G05', 'D13'), [])

  const kingStreet = findStationByCode('C13')
  assert.ok(kingStreet)
  assert.deepEqual(
    getAllTerminiForStation(kingStreet, 'C13', 'C05', 'BL'),
    ['Downtown Largo'],
    'the Blue route to Rosslyn must not include Yellow termini'
  )
  assert.deepEqual(
    getAllTerminiForStation(kingStreet, 'C13', 'F03', 'YL'),
    ['Mt Vernon Sq', 'Greenbelt'],
    "the Yellow route to L'Enfant must not include Blue termini"
  )

  console.log('✓ termini are filtered to the selected revenue-service path')
}

assertsTopologyInvariants()
assertsExactInterlineMatrix()
offersBothKingStreetStrategies()
routesThroughPhysicalAliasEndpointsDirectly()
offersReverseYellowStrategy()
treatsPhysicalAliasesAsTheSameEndpoint()
suppressesAmbiguousStopsBeyondSilverTrunk()
rejectsYellowToRosslyn()
treatsSilverBranchesAsDisconnected()
returnsRouteSpecificTermini()

console.log('pathfinding tests passed')
