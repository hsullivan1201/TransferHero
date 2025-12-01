import type { Train } from '@transferhero/shared';
export interface MergeTrainDataOptions {
    /** Trains from WMATA API */
    apiTrains: Train[];
    /** Trains from GTFS-RT feed */
    gtfsTrains: Train[];
    /** Trains from static schedule (optional) */
    scheduledTrains?: Train[];
    /** Deduplication threshold for GTFS trains (minutes) */
    gtfsThreshold?: number;
    /** Deduplication threshold for scheduled trains (minutes) */
    scheduleThreshold?: number;
}
/**
 * Merges train data from multiple sources (API, GTFS-RT, Schedule)
 * Deduplicates based on arrival time and line
 *
 * Priority: API > GTFS-RT > Schedule
 */
export declare function mergeTrainData(options: MergeTrainDataOptions): Train[];
/**
 * Sort trains by arrival time, prioritizing live data over scheduled
 */
export declare function sortTrains(trains: Train[]): Train[];
//# sourceMappingURL=trainMerger.d.ts.map