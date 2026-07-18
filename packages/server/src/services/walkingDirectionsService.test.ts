import assert from 'node:assert/strict'
import { walkingDirectionsResultFromLeg } from './walkingDirectionsService.js'

function derivesTimeFromRoutedDistanceInsteadOfProviderDuration() {
  const result = walkingDirectionsResultFromLeg({
    distance: { value: 805 },
    duration: { value: 660 },
  })

  assert.deepEqual(result, {
    walkTimeMinutes: 9,
    walkDistanceMeters: 805,
  })
  console.log('✓ Google walking results use routed distance with the calibrated pace')
}

function preservesZeroDistance() {
  const result = walkingDirectionsResultFromLeg({
    distance: { value: 0 },
    duration: { value: 60 },
  })

  assert.deepEqual(result, {
    walkTimeMinutes: 0,
    walkDistanceMeters: 0,
  })
  console.log('✓ Google zero-distance walking legs remain zero minutes')
}

derivesTimeFromRoutedDistanceInsteadOfProviderDuration()
preservesZeroDistance()

console.log('walkingDirectionsService tests passed')
