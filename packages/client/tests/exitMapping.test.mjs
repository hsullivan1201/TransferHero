import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'

const source = await readFile(new URL('../src/data/exitMapping.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
})
const { resolveExitLabels } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

test('WMATA entrance names match with or without ordinal suffixes', () => {
  // WMATA's GTFS names U Street's east entrance "10 & U St": it must not fall
  // back to the 13th St escalator.
  assert.deepEqual(resolveExitLabels('E03', '10 & U St', 'YL'), [2])
  assert.deepEqual(resolveExitLabels('E03', '10th St & U St NW', 'GR'), [2])
  assert.deepEqual(resolveExitLabels('E03', '13 & U St', 'GR'), [1])
})

test('numbers only match whole numbers', () => {
  assert.deepEqual(resolveExitLabels('F01', '19th St NW', 'GR'), [])
  assert.deepEqual(resolveExitLabels('F01', '9 & G St', 'GR'), [1, 2])
})

test('"7th St" is not mistaken for an H St entrance', () => {
  assert.deepEqual(resolveExitLabels('B01', 'F St & 7th St NW', 'GR'), [5])
  assert.deepEqual(resolveExitLabels('B01', '7th & H Sts NW', 'YL'), [3])
})

test('two-level stations use the arriving platform\'s exit numbering', () => {
  // Metro Center: labels 5/6 only exist on the Blue/Orange/Silver level.
  assert.deepEqual(resolveExitLabels('A01', '12th & F Sts NW', 'OR'), [6])
  assert.deepEqual(resolveExitLabels('A01', '12th & F Sts NW', 'RD'), [4, 3])
  assert.deepEqual(resolveExitLabels('A01', 'G & 12th Sts NW', 'BL'), [5])
  assert.deepEqual(resolveExitLabels('A01', 'G & 12th Sts NW', 'RD'), [3, 4])
  // Gallery Place: the Red Line level reaches 9th & G directly.
  assert.deepEqual(resolveExitLabels('F01', '9th & G Sts NW', 'RD'), [1])
  // L'Enfant Plaza: Exit A (7th & Maryland) sits off the Green/Yellow level.
  assert.deepEqual(resolveExitLabels('D03', '7th St & Maryland Ave SW', 'GR'), [3])
  assert.deepEqual(resolveExitLabels('D03', '7th St & Maryland Ave SW', 'SV'), [2, 3])
  assert.deepEqual(resolveExitLabels('F03', '9th & D Sts SW', 'BL'), [5])
  assert.deepEqual(resolveExitLabels('D03', 'D & 7th Sts SW', 'BL'), [4])
})
