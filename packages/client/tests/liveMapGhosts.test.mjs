import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

async function transpile(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  source = outputText
  for (const [specifier, url] of Object.entries(replacements)) {
    source = source.replaceAll(`'${specifier}'`, `'${url}'`)
  }
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

const schematicUrl = await transpile('../src/data/metroSchematic.ts')
const { SCHEMATIC_STATIONS } = await import(schematicUrl)
const { GHOST_TRACK_OFFSET, placeGhostTrains, visibleGhostTrains } = await import(
  await transpile('../src/components/liveTrainMapGeometry.ts', { '../data/metroSchematic': schematicUrl })
)

const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

test('opposite-direction trains at one station render as two trains', () => {
  const [shady, glenmont] = placeGhostTrains([
    { id: 'shady', code: 'B02', approaching: false, prevCode: 'B03', sameDirection: true },
    { id: 'glenmont', code: 'B02', approaching: false, prevCode: 'B01', sameDirection: false },
  ], 'RD')
  // Each runs on its own side of the line instead of sharing the station point.
  assert.ok(gap(shady, glenmont) >= 2 * GHOST_TRACK_OFFSET - 0.01)
  const station = SCHEMATIC_STATIONS.B02
  assert.ok(Math.abs(gap(shady, station) - GHOST_TRACK_OFFSET) < 0.01)
})

test('trains passing on one segment are not stacked at fixed fractions', () => {
  // Downtown Red stations are ~28px apart. Both passers used to sit 60% along
  // their own approach, 5.7px apart, and read as a single train.
  const [shady, glenmont] = placeGhostTrains([
    { id: 'shady', code: 'B03', approaching: true, prevCode: 'B35', sameDirection: true, progress: 0.3 },
    { id: 'glenmont', code: 'B35', approaching: true, prevCode: 'B03', sameDirection: false, progress: 0.7 },
  ], 'RD')
  // Same physical spot, opposite tracks: side by side, not on top of each other.
  assert.ok(gap(shady, glenmont) >= 2 * GHOST_TRACK_OFFSET - 0.01)
  const along = (point) => {
    const from = SCHEMATIC_STATIONS.B35
    const to = SCHEMATIC_STATIONS.B03
    const dx = to.x - from.x
    const dy = to.y - from.y
    return ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)
  }
  assert.ok(Math.abs(along(shady) - 0.3) < 0.01, 'GPS progress places the train')
  assert.ok(Math.abs(along(glenmont) - 0.3) < 0.01)
})

test('ghosts a stop away from a vehicle-tracked rider are never hidden', () => {
  const ghosts = placeGhostTrains([
    { id: 'behind', code: 'B03', approaching: false, prevCode: 'B35', sameDirection: true },
    { id: 'oncoming', code: 'B02', approaching: true, prevCode: 'B01', sameDirection: false, progress: 0.5 },
  ], 'RD')
  const rider = SCHEMATIC_STATIONS.B02
  assert.equal(visibleGhostTrains(ghosts, rider, true, 40).length, 2)
})

test('an estimated rider hides only its single likely twin', () => {
  const rider = { x: 620, y: 420 }
  const ghosts = [
    { id: 'twin', x: 624, y: 418, sameDirection: true },
    { id: 'next-stop', x: 640, y: 400, sameDirection: true },
    { id: 'oncoming', x: 619, y: 421, sameDirection: false },
    { id: 'far', x: 700, y: 300, sameDirection: null },
  ]
  assert.deepEqual(
    visibleGhostTrains(ghosts, rider, false, 40).map(ghost => ghost.id),
    ['next-stop', 'oncoming', 'far']
  )
  assert.equal(visibleGhostTrains(ghosts, null, false, 40).length, 4)
})
