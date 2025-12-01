/**
 * Converts train Min value to integer minutes
 * @param min - Train Min value ('ARR', 'BRD', or number)
 * @returns Minutes as integer (0 for ARR/BRD)
 */
export declare function getTrainMinutes(min: string | number): number;
/**
 * Ensures value is an array
 * @param value - Value that may or may not be an array
 * @returns Value as array
 */
export declare function ensureArray<T>(value: T | T[]): T[];
/**
 * Normalizes destination name for comparison
 * @param dest - Raw destination name
 * @returns Normalized destination name
 */
export declare function normalizeDestination(dest: string): string;
/**
 * Gets display name for a destination
 * @param dest - Raw destination name
 * @returns Formatted display name
 */
export declare function getDisplayName(dest: string): string;
//# sourceMappingURL=index.d.ts.map