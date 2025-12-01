import type { Train } from '@transferhero/shared';
export interface SchedulePattern {
    station: string;
    line: string;
    destination: string;
    frequency: number;
    firstTrain: string;
    lastTrain: string;
}
export interface ScheduleConfig {
    patterns: Record<string, SchedulePattern>;
}
/**
 * Load schedule config data from the root schedule-data.js file
 */
export declare function loadScheduleConfig(): ScheduleConfig;
/**
 * Get scheduled trains for a station and terminus
 * @param stationCode - Station code (e.g., 'A01')
 * @param terminus - Terminus destination(s) to filter by
 * @param startFromMinutes - Minimum minutes from now to start search (default: 0)
 */
export declare function getScheduledTrains(stationCode: string, terminus: string | string[], startFromMinutes?: number): Train[];
//# sourceMappingURL=scheduleData.d.ts.map