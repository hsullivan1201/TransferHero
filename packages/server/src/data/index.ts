// Re-export all data modules
export * from './stations.js'
export * from './transfers.js'
export * from './travelTimes.js'
export * from './lineConfig.js'
export * from './platformCodes.js'

// NEW: Export car position service with real exit data
// This replaces the old placeholder carPositions.ts
export {
  getDirectTripCarPosition,
  getTransferCarPosition,
  getStation,
  findPlatformForLine,
  getTrackDirection,
  xToCar,
  adjustCarForTrack,
  type CarPosition,
  type Station as ExitStation,
  type Platform,
  type Egress,
  type TrackDirection
} from './carPositionService.js'

// Keep old export for backward compatibility (deprecated)
export { getCarPosition } from './carPositions.js'
