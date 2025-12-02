import type { Train, Line } from '@transferhero/shared';
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
}>, allowedLines?: Line[]): Train[];
interface ArrivalData {
    minutes: number;
    timestamp: number;
}
/**
 * Get arrival time at a destination station from GTFS-RT data
 * Returns arrival minutes and exact timestamp, or undefined if not found
 */
export declare function getArrivalAtStation(entities: any[], tripId: string, destinationCode: string): ArrivalData | undefined;
/**
 * Enrich trains with destination arrival times from GTFS-RT
 */
export declare function enrichTrainsWithDestinationArrival(trains: Train[], entities: any[], destinationCode: string): Train[];
/**
 * Fetch predictions at destination and match to origin trains
 * WMATA realtime is preferred for displayed times, GTFS-RT used as fallback
 */
export declare function fetchDestinationArrivals(originTrains: Train[], destinationCode: string, apiKey: string, gtfsEntities?: any[]): Promise<Train[]>;
/**
 * Filter API response trains by terminus and optionally by line
 * Also normalizes destination names to display format
 */
export declare function filterApiResponse(trains: Train[], terminus: string | string[], allowedLines?: Line[]): Train[];
export {};
//# sourceMappingURL=wmata.d.ts.map