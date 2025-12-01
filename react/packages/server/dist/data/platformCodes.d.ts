import type { Line } from '@transferhero/shared';
/**
 * Centralized mapping for multi-code stations
 * Some stations have multiple platform codes (e.g., Metro Center = A01/C01)
 */
export declare const STATION_ALIASES: Record<string, string>;
/**
 * Platform-to-Line mapping for multi-code stations
 * This tells us which platform (A01 vs C01) to use for each line.
 * Example: At Metro Center, Red Line uses A01, but Orange/Silver/Blue use C01.
 */
export declare const PLATFORM_CODES: Record<string, Partial<Record<Line, string>>>;
/**
 * Normalizes a platform code to the canonical code found in a station list
 */
export declare function normalizePlatformCode(code: string, availableStations: string[]): string;
/**
 * Gets all platform codes for a station (including alias)
 */
export declare function getAllPlatformCodes(code: string): string[];
/**
 * Get the correct platform code for a specific line at a multi-code station
 */
export declare function getPlatformForLine(stationCode: string, line: Line): string;
//# sourceMappingURL=platformCodes.d.ts.map