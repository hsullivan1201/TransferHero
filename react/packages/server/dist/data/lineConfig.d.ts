import type { Line, Termini } from '@transferhero/shared';
/**
 * Station order on each line (first = toward_a terminus, last = toward_b terminus)
 * Used to determine which direction a train should travel
 */
export declare const LINE_STATIONS: Record<Line, string[]>;
/**
 * Terminus stations for each line direction
 */
export declare const TERMINI: Record<Line, Termini>;
//# sourceMappingURL=lineConfig.d.ts.map