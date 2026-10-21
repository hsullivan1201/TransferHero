import assert from 'node:assert/strict'
import type { SharedTripPayload } from '@transferhero/shared'
import { renderSharePage } from './sharePage.js'

const now = Date.now()
// `$\`` and `$&` survive escapeHtml, so they would act as String#replace
// substitution patterns if user text were passed as a replacement string.
const patterns = '$`$&'
const trip: SharedTripPayload = {
  v: 2,
  origin: { code: 'A03', name: `Dupont ${patterns}`, lines: ['RD'] },
  destination: { code: 'F05', name: 'Navy Yard-Ballpark', lines: ['GR'] },
  lines: ['RD', 'GR'],
  durationMinutes: 19,
  arrivalClock: '1:23 PM',
  routeSummary: `Red to Green ${patterns.repeat(50)}`,
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

const html = renderSharePage(trip, 'abcdefghijklmnop', 'https://transferhero.example')
assert.equal(html.match(/<html/giu)?.length, 1)
assert.equal(html.match(/<title>/giu)?.length, 1)
assert.equal(html.match(/<\/head>/giu)?.length, 1)
assert.ok(html.includes('<title>Dupont $`$&amp; to Navy Yard-Ballpark'))
assert.ok(html.includes(`Red to Green ${'$`$&amp;'.repeat(50)}`))
assert.ok(html.length < 20_000, `share page grew to ${html.length} bytes`)

console.log('share page tests passed')
