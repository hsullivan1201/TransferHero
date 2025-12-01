import { getTrainMinutes } from '@transferhero/shared';
/**
 * Merges train data from multiple sources (API, GTFS-RT, Schedule)
 * Deduplicates based on arrival time and line
 *
 * Priority: API > GTFS-RT > Schedule
 */
export function mergeTrainData(options) {
    const { apiTrains, gtfsTrains, scheduledTrains = [], gtfsThreshold = 3, scheduleThreshold = 4 } = options;
    const merged = [...apiTrains];
    // Merge GTFS-RT trains (avoid duplicates within threshold)
    gtfsTrains.forEach(gTrain => {
        const gMin = getTrainMinutes(gTrain.Min);
        const duplicate = merged.some(mTrain => {
            const mMin = getTrainMinutes(mTrain.Min);
            return Math.abs(mMin - gMin) <= gtfsThreshold && mTrain.Line === gTrain.Line;
        });
        if (!duplicate)
            merged.push(gTrain);
    });
    // Merge scheduled trains (avoid duplicates within threshold)
    scheduledTrains.forEach(sTrain => {
        const sMin = getTrainMinutes(sTrain.Min);
        const duplicate = merged.some(mTrain => {
            const mMin = getTrainMinutes(mTrain.Min);
            return Math.abs(mMin - sMin) <= scheduleThreshold;
        });
        if (!duplicate) {
            merged.push({
                ...sTrain,
                _gtfs: false,
                _scheduled: true
            });
        }
    });
    return merged;
}
/**
 * Sort trains by arrival time, prioritizing live data over scheduled
 */
export function sortTrains(trains) {
    return [...trains].sort((a, b) => {
        // Live trains first (API or GTFS-RT)
        const aIsLive = !a._scheduled;
        const bIsLive = !b._scheduled;
        if (aIsLive !== bIsLive)
            return aIsLive ? -1 : 1;
        // Then by arrival time
        return getTrainMinutes(a.Min) - getTrainMinutes(b.Min);
    });
}
//# sourceMappingURL=trainMerger.js.map