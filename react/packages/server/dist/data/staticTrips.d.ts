export interface StaticTripInfo {
    headsign: string;
    line: string;
}
export type StaticTripsMap = Record<string, StaticTripInfo>;
/**
 * Load static trips data from the root static-trips.js file
 * This maps trip IDs to their headsign/line info for GTFS-RT lookups
 */
export declare function loadStaticTrips(): StaticTripsMap;
/**
 * Get static trips (uses cached data after first load)
 */
export declare function getStaticTrips(): StaticTripsMap;
//# sourceMappingURL=staticTrips.d.ts.map