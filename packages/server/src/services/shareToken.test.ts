import assert from 'node:assert/strict'
import type { SharedTripPayload } from '@transferhero/shared'
import { createShareToken, decodeShareToken } from './shareToken.js'

const secret = 'test-secret-that-is-long-enough-for-hmac-validation'
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

const token = createShareToken(trip, secret)
assert.deepEqual(decodeShareToken(token, secret), trip)
assert.equal(decodeShareToken(`${token.slice(0, -1)}x`, secret), null)
assert.equal(decodeShareToken(token, `${secret}-different`), null)
assert.equal(decodeShareToken('not-a-token', secret), null)
assert.ok(token.length < 2_000, `expected a message-safe token, received ${token.length} characters`)

console.log('share token tests passed')
