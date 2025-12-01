import type { CarPosition } from '@transferhero/shared';
/**
 * Optimal car positioning for transfers
 * Tells riders which car to board for fastest transfer
 */
export declare const CAR_POSITIONS: Record<string, CarPosition>;
/**
 * Get car position for a transfer
 */
export declare function getCarPosition(fromPlatform: string, toPlatform: string): CarPosition;
//# sourceMappingURL=carPositions.d.ts.map