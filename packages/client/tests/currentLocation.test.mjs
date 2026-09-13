import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

// Exercise the browser-independent acquisition logic with the workspace's
// existing TypeScript compiler; no browser globals or extra test runtime needed.
const source = await readFile(new URL('../src/utils/currentLocation.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { requestCurrentLocation, locationErrorMessage } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function setup() {
  const requests = []
  const events = []
  const controller = new AbortController()
  const callbacks = {
    onSuccess: position => events.push({ success: position }),
    onError: error => events.push({ error }),
    onFallback: () => events.push({ fallback: true }),
  }
  requestCurrentLocation({
    getCurrentPosition(success, error, options) { requests.push({ success, error, options }) },
  }, controller.signal, callbacks)
  return { requests, events, controller, callbacks }
}

const position = (accuracy = 25) => ({
  coords: { latitude: 38.8977, longitude: -77.0365, accuracy },
  timestamp: Date.now(),
})

test('passes precise coordinates through unchanged and completes only once', () => {
  const { requests, events } = setup()
  const fix = position()
  requests[0].success(fix)
  requests[0].error({ code: 3 })
  requests[0].success(position())
  assert.deepEqual(events, [{ success: fix }])
  assert.equal(requests.length, 1)
})

for (const code of [2, 3]) {
  test(`recovers from error ${code} using one bounded lower-accuracy attempt`, () => {
    const { requests, events } = setup()
    requests[0].error({ code })
    assert.equal(requests.length, 2)
    assert.equal(requests[0].options.enableHighAccuracy, true)
    assert.equal(requests[1].options.enableHighAccuracy, false)
    assert.ok(requests[0].options.timeout + requests[1].options.timeout <= 25_000)
    assert.ok(requests.every(request => request.options.maximumAge <= 30_000))
    const fix = position(150)
    requests[1].success(fix)
    assert.deepEqual(events, [{ fallback: true }, { success: fix }])
  })

  test(`fallback error ${code} ends acquisition without further retries`, () => {
    const { requests, events } = setup()
    requests[0].error({ code: 3 })
    requests[1].error({ code })
    assert.equal(requests.length, 2)
    assert.deepEqual(events, [{ fallback: true }, { error: code === 3 ? 'timeout' : 'unavailable' }])
  })
}

test('permission denial never causes a retry, including during fallback', () => {
  for (const fallback of [false, true]) {
    const { requests, events } = setup()
    if (fallback) requests[0].error({ code: 3 })
    requests.at(-1).error({ code: 1 })
    assert.equal(requests.length, fallback ? 2 : 1)
    assert.deepEqual(events.at(-1), { error: 'denied' })
  }
})

test('rejects broad or invalid accuracy on either attempt', () => {
  for (const fallback of [false, true]) {
    for (const accuracy of [201, 5000, NaN, Infinity, -1]) {
      const { requests, events } = setup()
      if (fallback) requests[0].error({ code: 3 })
      requests.at(-1).success(position(accuracy))
      assert.deepEqual(events.at(-1), { error: 'inaccurate' })
      assert.ok(events.every(event => !event.success))
    }
  }
})

test('rejects malformed coordinates before station resolution', () => {
  for (const coords of [{ latitude: NaN }, { latitude: 91 }, { longitude: Infinity }, { longitude: -181 }]) {
    const { requests, events } = setup()
    const fix = position()
    Object.assign(fix.coords, coords)
    requests[0].success(fix)
    assert.deepEqual(events, [{ error: 'unavailable' }])
  }
})

test('ignores callbacks from the old attempt once fallback starts', () => {
  const { requests, events } = setup()
  requests[0].error({ code: 3 })
  requests[0].success(position())
  requests[0].error({ code: 1 })
  assert.deepEqual(events, [{ fallback: true }])
  requests[1].success(position())
  assert.ok(events.at(-1).success)
})

test('manual selection or unmount aborts callbacks and prevents fallback', () => {
  for (const fallback of [false, true]) {
    const { requests, events, controller } = setup()
    if (fallback) requests[0].error({ code: 3 })
    controller.abort()
    requests.at(-1).success(position())
    requests.at(-1).error({ code: 3 })
    assert.deepEqual(events, fallback ? [{ fallback: true }] : [])
    assert.equal(requests.length, fallback ? 2 : 1)
  }
})

test('handles synchronous browser errors and an already-aborted request', () => {
  const controller = new AbortController()
  const errors = []
  const geolocation = { getCurrentPosition() { throw new Error('provider unavailable') } }
  const callbacks = { onError: error => errors.push(error), onSuccess: assert.fail, onFallback: assert.fail }
  requestCurrentLocation(geolocation, controller.signal, callbacks)
  assert.deepEqual(errors, ['unavailable'])
  controller.abort()
  requestCurrentLocation(geolocation, controller.signal, callbacks)
  assert.equal(errors.length, 1)
})

test('distinguishes errors and supplies iOS device and website permission guidance', () => {
  const denied = locationErrorMessage('denied', true)
  assert.match(denied, /Location Services/)
  assert.match(denied, /Safari Websites or your browser/)
  assert.match(denied, /this website/)
  assert.doesNotMatch(locationErrorMessage('denied', false), /iPhone/)
  assert.equal(new Set(['denied', 'timeout', 'unavailable', 'inaccurate'].map(
    failure => locationErrorMessage(failure, true),
  )).size, 4)
})
