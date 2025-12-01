import type { Train } from '@transferhero/shared';
/**
 * Fetch station predictions from WMATA API
 */
export declare function fetchStationPredictions(stationCode: string, apiKey: string): Promise<Train[]>;
/**
 * Fetch GTFS-RT trip updates
 */
export declare function fetchGTFSTripUpdates(apiKey: string): Promise<any[]>;
/**
 * Parse GTFS-RT entities to train format
 */
export declare function parseUpdatesToTrains(entities: any[], stationCode: string, terminusList: string[], staticTrips?: Record<string, {
    line: string;
    headsign: string;
}>): Train[];
/**
 * Filter API response trains by terminus
 */
export declare function filterApiResponse(trains: Train[], terminus: string | string[]): Train[];
//# sourceMappingURL=wmata.d.ts.map