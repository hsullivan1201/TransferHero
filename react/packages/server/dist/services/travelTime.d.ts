import type { Line } from '@transferhero/shared';
/**
 * Calculate travel time between two stations on a given line
 * Walks through each segment and sums up travel times
 */
export declare function calculateRouteTravelTime(fromStation: string, toStation: string, line: Line): number;
/**
 * Get terminus stations for a given direction on a line
 */
export declare function getTerminus(line: Line, fromStation: string, toStation: string): string[];
/**
 * Convert minutes from now to clock time string
 */
export declare function minutesToClockTime(minutesFromNow: number): string;
//# sourceMappingURL=travelTime.d.ts.map