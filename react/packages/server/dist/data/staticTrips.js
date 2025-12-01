import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
let cachedStaticTrips = null;
/**
 * Load static trips data from the root static-trips.js file
 * This maps trip IDs to their headsign/line info for GTFS-RT lookups
 */
export function loadStaticTrips() {
    if (cachedStaticTrips) {
        return cachedStaticTrips;
    }
    try {
        // Navigate from server/src/data to project root's static-trips.js
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const staticTripsPath = resolve(__dirname, '../../../../../static-trips.js');
        const fileContent = readFileSync(staticTripsPath, 'utf-8');
        // Extract JSON from: const STATIC_TRIPS = {...}
        const jsonMatch = fileContent.match(/const\s+STATIC_TRIPS\s*=\s*(\{[\s\S]*\})/);
        if (!jsonMatch) {
            console.warn('[StaticTrips] Could not parse static-trips.js format');
            return {};
        }
        cachedStaticTrips = JSON.parse(jsonMatch[1]);
        console.log(`[StaticTrips] Loaded ${Object.keys(cachedStaticTrips).length} trip mappings`);
        return cachedStaticTrips;
    }
    catch (error) {
        console.error('[StaticTrips] Failed to load static-trips.js:', error);
        return {};
    }
}
/**
 * Get static trips (uses cached data after first load)
 */
export function getStaticTrips() {
    return cachedStaticTrips ?? loadStaticTrips();
}
//# sourceMappingURL=staticTrips.js.map