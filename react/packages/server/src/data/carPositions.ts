import type { CarPosition } from '@transferhero/shared'

/**
 * Optimal car positioning for transfers
 * Tells riders which car to board for fastest transfer
 */
export const CAR_POSITIONS: Record<string, CarPosition> = {
  // Metro Center: OR/SV/BL to RD
  'C01_A01': {
    boardCar: 6,
    exitCar: 3,
    legend: 'Escalator to Red Line at front of train'
  },
  'A01_C01': {
    boardCar: 3,
    exitCar: 6,
    legend: 'Escalator to Orange/Silver at rear'
  },

  // Gallery Place: RD to YL/GR
  'B01_F01': {
    boardCar: 4,
    exitCar: 5,
    legend: 'Elevator mid-platform'
  },
  'F01_B01': {
    boardCar: 5,
    exitCar: 4,
    legend: 'Stairs at center'
  },

  // L'Enfant Plaza
  'D03_F03': {
    boardCar: 2,
    exitCar: 7,
    legend: 'Long transfer - rear car fastest'
  },
  'F03_D03': {
    boardCar: 7,
    exitCar: 2,
    legend: 'Transfer via mezzanine'
  },

  // Default
  'default': {
    boardCar: 4,
    exitCar: 4,
    legend: 'Center of train'
  },
}

/**
 * Get car position for a transfer
 */
export function getCarPosition(fromPlatform: string, toPlatform: string): CarPosition {
  const key = `${fromPlatform}_${toPlatform}`
  return CAR_POSITIONS[key] || CAR_POSITIONS['default']
}
