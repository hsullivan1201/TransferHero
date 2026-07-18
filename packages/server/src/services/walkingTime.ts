/** Brisk urban walking pace: about 3.24 mph, or 18.5 minutes per mile. */
export const ROUTED_WALK_SPEED_MPS = 1.45

/** Preserve the existing DC street-grid inflation for straight-line fallbacks. */
export const WALK_GRID_FACTOR = 1.4

/** Convert a routed walking distance to whole display/planning minutes. */
export function routedWalkMinutes(distanceMeters: number): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 0
  return Math.max(1, Math.round(distanceMeters / (ROUTED_WALK_SPEED_MPS * 60)))
}

/** Estimate walking minutes when only a straight-line distance is available. */
export function gridWalkMinutes(straightLineMeters: number): number {
  if (!Number.isFinite(straightLineMeters) || straightLineMeters <= 0) return 0
  return routedWalkMinutes(straightLineMeters * WALK_GRID_FACTOR)
}
