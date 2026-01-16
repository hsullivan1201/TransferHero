import assert from 'node:assert/strict'
import { getTransferCarPosition } from './carPositionService.js'

function accessibleTransferPrefersElevator() {
  const result = getTransferCarPosition(
    'F01',       // transfer station (Gallery Place lower - incoming YL)
    'YL',        // incoming line
    'RD',        // outgoing line
    'Greenbelt', // incoming destination (direction for track)
    'B35',       // final destination (NoMa-Gallaudet U)
    'Glenmont',  // outgoing destination (direction for track)
    true         // accessible mode
  )

  assert.equal(result.leg1.details?.exitType, 'elevator')
  assert.ok(result.leg1.legend.toLowerCase().includes('elevator'), 'leg1 legend should call out the elevator transfer')

  const leg2Elevator = result.leg2.exits?.find(e => e.type === 'elevator')
  assert.ok(leg2Elevator, 'leg2 exits should include an elevator in accessible mode')

  console.log('✓ accessible transfer prefers elevator for leg1 and keeps elevator exits for leg2')
}

accessibleTransferPrefersElevator()

console.log('carPositionService tests passed')

