import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import type { SharedTripPayload } from '@transferhero/shared'
import { createApp } from '../app.js'

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

const app = createApp({ isProduction: false })
const server = app.listen(0, '127.0.0.1')

try {
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  process.env.PUBLIC_BASE_URL = baseUrl

  const created = await fetch(`${baseUrl}/api/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trip }),
  })
  assert.equal(created.status, 201)
  const body = await created.json() as { token: string; url: string }
  assert.match(body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u)
  assert.equal(body.url, `${baseUrl}/t/${body.token}`)

  const htmlResponse = await fetch(body.url, { headers: { 'User-Agent': 'Twitterbot/1.0' } })
  assert.equal(htmlResponse.status, 200)
  assert.match(htmlResponse.headers.get('content-type') ?? '', /^text\/html/u)
  const html = await htmlResponse.text()
  assert.ok(html.includes('property="og:image"'))
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'))
  assert.ok(html.includes(`${body.url}/card.png`))
  assert.ok(html.includes('name="robots" content="noindex,noarchive"'))

  const imageResponse = await fetch(`${body.url}/card.png`)
  assert.equal(imageResponse.status, 200)
  assert.equal(imageResponse.headers.get('content-type'), 'image/png')
  assert.equal(imageResponse.headers.get('cross-origin-resource-policy'), 'cross-origin')
  const png = Buffer.from(await imageResponse.arrayBuffer())
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)

  const resolved = await fetch(`${baseUrl}/api/shares/${body.token}`)
  assert.equal(resolved.status, 200)
  const resolvedBody = await resolved.json() as { trip: SharedTripPayload }
  assert.equal(resolvedBody.trip.origin.code, 'A03')
  assert.equal(resolvedBody.trip.destination.code, 'F05')

  const tampered = `${body.token.slice(0, -1)}x`
  assert.equal((await fetch(`${baseUrl}/t/${tampered}`)).status, 404)
  console.log('share routes integration tests passed')
} finally {
  if (server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}
