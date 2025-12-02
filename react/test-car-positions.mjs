import { getTransferCarPosition, getDirectTripCarPosition } from './packages/server/dist/data/carPositionService.js';

// Test Court House to Dupont (OR -> RD transfer at Metro Center)
console.log('=== Court House to Dupont (OR -> RD) ===');
const result1 = getTransferCarPosition(
  'C01',        // Metro Center transfer
  'OR',         // from Orange
  'RD',         // to Red
  'Largo',      // incoming train destination
  'A03',        // Dupont Circle destination
  'Shady Grove', // outgoing train terminus
  false         // accessible
);
console.log('Leg1:', JSON.stringify(result1.leg1, null, 2));
console.log('Leg2:', JSON.stringify(result1.leg2, null, 2));

// Test Court House to NoMa (OR -> RD transfer at Metro Center)
console.log('\n=== Court House to NoMa (OR -> RD) ===');
const result2 = getTransferCarPosition(
  'C01',        // Metro Center transfer
  'OR',         // from Orange
  'RD',         // to Red
  'Largo',      // incoming train destination
  'B35',        // NoMa destination
  'Glenmont',   // outgoing train terminus
  false         // accessible
);
console.log('Leg1:', JSON.stringify(result2.leg1, null, 2));
console.log('Leg2:', JSON.stringify(result2.leg2, null, 2));

// Direct trip test
console.log('\n=== Direct trip to Dupont ===');
const result3 = getDirectTripCarPosition(
  'A03',        // Dupont Circle
  'RD',         // Red Line
  'Shady Grove', // terminus
  false         // accessible
);
console.log('DirectCarPosition:', JSON.stringify(result3, null, 2));

