import assert from 'node:assert/strict'
import {
  getIncidents,
  parseLinesAffected,
  resetIncidentsCache,
  expireIncidentsCache,
  getIncidentsStats,
} from './incidents.js'

const RAIL_PAYLOAD = {
  Incidents: [
    {
      IncidentID: 'ABC123',
      Description: 'Red Line: single tracking btwn Takoma & Silver Spring.',
      IncidentType: 'Delay',
      LinesAffected: 'RD;',
      DateUpdated: '2026-07-07T09:00:00',
    },
  ],
}

const ELEVATOR_PAYLOAD = {
  ElevatorIncidents: [
    {
      UnitType: 'ELEVATOR',
      StationCode: 'A01',
      StationName: 'Metro Center',
      LocationDescription: 'Elevator between mezzanine and platform',
      SymptomDescription: 'Service Call',
      DateOutOfServ: '2026-07-07T08:00:00',
    },
  ],
}

function makeFetch(overrides: { failRail?: boolean; failAll?: boolean } = {}) {
  let calls = 0
  const fetchFn = async (url: string) => {
    calls++
    const isRail = url.includes('/Incidents') && !url.includes('Elevator')
    if (overrides.failAll || (overrides.failRail && isRail)) {
      return { ok: false, status: 500, json: async () => ({}) }
    }
    return {
      ok: true,
      status: 200,
      json: async () => (isRail ? RAIL_PAYLOAD : ELEVATOR_PAYLOAD),
    }
  }
  return { fetchFn: fetchFn as any, getCalls: () => calls }
}

function linesAffectedParsingHandlesWmataFormats() {
  assert.deepEqual(parseLinesAffected('RD;'), ['RD'])
  assert.deepEqual(parseLinesAffected('BL; OR; SV;'), ['BL', 'OR', 'SV'])
  assert.deepEqual(parseLinesAffected('RED'), ['RD'])
  assert.deepEqual(parseLinesAffected(''), [])
  assert.deepEqual(parseLinesAffected(undefined), [])
  assert.deepEqual(parseLinesAffected('RD; RD;'), ['RD'])
  console.log('✓ parseLinesAffected handles WMATA separator/name variants')
}

async function fetchesAndParsesBothFeeds() {
  resetIncidentsCache()
  const { fetchFn, getCalls } = makeFetch()

  const result = await getIncidents('test-key', fetchFn)

  assert.equal(getCalls(), 2)
  assert.equal(result.railIncidents.length, 1)
  assert.equal(result.railIncidents[0].incidentId, 'ABC123')
  assert.deepEqual(result.railIncidents[0].linesAffected, ['RD'])
  assert.equal(result.elevatorIncidents.length, 1)
  assert.equal(result.elevatorIncidents[0].stationCode, 'A01')
  assert.equal(result.elevatorIncidents[0].unitType, 'ELEVATOR')
  assert.ok(Number.isFinite(Date.parse(result.meta.fetchedAt)))
  console.log('✓ getIncidents fetches and parses rail + elevator feeds')
}

async function cacheHitWithinTtlSkipsUpstream() {
  resetIncidentsCache()
  const { fetchFn, getCalls } = makeFetch()

  await getIncidents('test-key', fetchFn)
  const before = getCalls()
  await getIncidents('test-key', fetchFn)

  assert.equal(getCalls(), before)
  assert.equal(getIncidentsStats().cacheHits, 1)
  console.log('✓ second call within TTL served from cache (no upstream calls)')
}

async function parallelCallsCoalesceToOneUpstreamRequest() {
  resetIncidentsCache()
  const { fetchFn, getCalls } = makeFetch()

  const [a, b, c] = await Promise.all([
    getIncidents('test-key', fetchFn),
    getIncidents('test-key', fetchFn),
    getIncidents('test-key', fetchFn),
  ])

  assert.equal(getCalls(), 2) // one rail + one elevator fetch total
  assert.equal(a, b)
  assert.equal(b, c)
  console.log('✓ parallel calls coalesce into a single upstream request')
}

async function staleCacheServedWhenUpstreamFails() {
  resetIncidentsCache()
  const good = makeFetch()
  const seeded = await getIncidents('test-key', good.fetchFn)

  expireIncidentsCache()
  const bad = makeFetch({ failAll: true })
  const result = await getIncidents('test-key', bad.fetchFn)

  assert.deepEqual(result.railIncidents, seeded.railIncidents)
  assert.deepEqual(result.elevatorIncidents, seeded.elevatorIncidents)
  assert.equal(getIncidentsStats().failures, 1)
  console.log('✓ stale cache served when both upstream feeds fail')
}

async function partialFailureKeepsOtherFeedFresh() {
  resetIncidentsCache()
  const { fetchFn } = makeFetch({ failRail: true })

  const result = await getIncidents('test-key', fetchFn)

  assert.deepEqual(result.railIncidents, []) // no prior cache to fall back to
  assert.equal(result.elevatorIncidents.length, 1)
  console.log('✓ one feed failing does not blank the other')
}

async function errorThrownWhenNoCacheAndUpstreamDown() {
  resetIncidentsCache()
  const { fetchFn } = makeFetch({ failAll: true })

  await assert.rejects(() => getIncidents('test-key', fetchFn))
  console.log('✓ throws when upstream is down and no cache exists')
}

linesAffectedParsingHandlesWmataFormats()
await fetchesAndParsesBothFeeds()
await cacheHitWithinTtlSkipsUpstream()
await parallelCallsCoalesceToOneUpstreamRequest()
await staleCacheServedWhenUpstreamFails()
await partialFailureKeepsOtherFeedFresh()
await errorThrownWhenNoCacheAndUpstreamDown()

console.log('incidents tests passed')
