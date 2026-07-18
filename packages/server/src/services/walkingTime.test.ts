import assert from 'node:assert/strict'
import {
  ROUTED_WALK_SPEED_MPS,
  WALK_GRID_FACTOR,
  gridWalkMinutes,
  routedWalkMinutes,
} from './walkingTime.js'

function usesBriskRoutedPace() {
  assert.equal(ROUTED_WALK_SPEED_MPS, 1.45)
  assert.equal(routedWalkMinutes(805), 9)
  console.log('✓ routed walks use the calibrated 1.45 m/s pace')
}

function preservesZeroAndMinimumPositiveMinute() {
  assert.equal(routedWalkMinutes(0), 0)
  assert.equal(gridWalkMinutes(0), 0)
  assert.equal(routedWalkMinutes(-1), 0)
  assert.equal(routedWalkMinutes(Number.NaN), 0)
  assert.equal(routedWalkMinutes(1), 1)
  console.log('✓ zero-length walks stay zero and positive walks keep a one-minute minimum')
}

function retainsGridInflationForFallbacks() {
  assert.equal(WALK_GRID_FACTOR, 1.4)
  assert.equal(gridWalkMinutes(1000), 16)
  console.log('✓ straight-line fallbacks retain the 1.4 grid factor')
}

usesBriskRoutedPace()
preservesZeroAndMinimumPositiveMinute()
retainsGridInflationForFallbacks()

console.log('walkingTime tests passed')
