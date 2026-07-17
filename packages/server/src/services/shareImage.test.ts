import assert from 'node:assert/strict'
import type { SharedTripPayload } from '@transferhero/shared'
import { renderShareCardPng, renderShareCardSvg } from './shareImage.js'

const now = Date.now()
const trip: SharedTripPayload = {
  v: 2,
  origin: { code: 'A03', name: 'Dupont Circle', lines: ['RD'] },
  destination: { code: 'F05', name: 'Navy Yard-Ballpark', lines: ['GR'] },
  lines: ['RD', 'GR'],
  durationMinutes: 19,
  arrivalClock: '1:23 PM',
  routeSummary: 'Red to Green · transfer at Gallery Place',
  transferWalkSummary: '2 min transfer walk',
  walkTime: 2,
  accessible: false,
  departAt: null,
  transferName: 'Gallery Place',
  legs: [
    { kind: 'rail', line: 'RD', minutes: 5, toward: 'Glenmont' },
    { kind: 'transfer', minutes: 2, stationName: 'Gallery Place' },
    { kind: 'rail', line: 'GR', minutes: 7, toward: 'Branch Ave' },
  ],
  timing: {
    capturedAtMs: now,
    departureAtMs: now + 3 * 60_000,
    arrivalAtMs: now + 19 * 60_000,
    source: 'live',
  },
  sharedAtMs: now,
}

const svg = renderShareCardSvg({
  ...trip,
  origin: { ...trip.origin, name: 'Safe & useful <trip>' },
})
assert.ok(svg.includes('Safe &amp; useful &lt;trip&gt;'))
assert.ok(!svg.includes('<trip>'))
assert.ok(svg.includes('OPEN TRIP DETAILS'))
assert.ok(!svg.includes('Open for current trains'))
assert.ok(!svg.includes('ELEVATOR-AWARE'))
assert.ok(!svg.includes('STATUS AS OF'))

const destinationWalkOnlySvg = renderShareCardSvg({
  ...trip,
  lines: ['RD'],
  transferName: null,
  legs: [
    { kind: 'rail', line: 'RD', minutes: 12, toward: 'Glenmont' },
    { kind: 'walk', minutes: 5 },
  ],
})
assert.ok(destinationWalkOnlySvg.includes('>TRAIN</text>'))
assert.equal(destinationWalkOnlySvg.match(/5 min walk/gu)?.length, 1)

const png = renderShareCardPng(trip)
assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
assert.equal(png.readUInt32BE(16), 1200)
assert.equal(png.readUInt32BE(20), 630)
assert.ok(png.byteLength < 500_000)

console.log('share image tests passed')
