import type { Train } from '@transferhero/shared'
import { getTrainMinutes } from '@transferhero/shared'

export interface MergeTrainDataOptions {
  /** Trains from WMATA API */
  apiTrains: Train[]
  /** Trains from GTFS-RT feed */
  gtfsTrains: Train[]
  /** Trains from static schedule (optional) */
  scheduledTrains?: Train[]
  /** Deduplication threshold for GTFS trains (minutes) */
  gtfsThreshold?: number
  /** Deduplication threshold for scheduled trains (minutes) */
  scheduleThreshold?: number
}

/**
 * Merges train data from multiple sources (API, GTFS-RT, Schedule)
 * Deduplicates based on arrival time and line
 *
 * Priority: API > GTFS-RT > Schedule
 */
export function mergeTrainData(options: MergeTrainDataOptions): Train[] {
  const {
    apiTrains,
    gtfsTrains,
    scheduledTrains = [],
    gtfsThreshold = 3,
    scheduleThreshold = 4
  } = options

  const merged: Train[] = [...apiTrains]

  // Merge GTFS-RT trains (avoid duplicates within threshold)
  gtfsTrains.forEach(gTrain => {
    const gMin = getTrainMinutes(gTrain.Min)
    const duplicate = merged.some(mTrain => {
      const mMin = getTrainMinutes(mTrain.Min)
      return Math.abs(mMin - gMin) <= gtfsThreshold && mTrain.Line === gTrain.Line
    })
    if (!duplicate) merged.push(gTrain)
  })

  // Merge scheduled trains (avoid duplicates within threshold)
  scheduledTrains.forEach(sTrain => {
    const sMin = getTrainMinutes(sTrain.Min)
    const duplicate = merged.some(mTrain => {
      const mMin = getTrainMinutes(mTrain.Min)
      return Math.abs(mMin - sMin) <= scheduleThreshold
    })
    if (!duplicate) {
      merged.push({
        ...sTrain,
        _gtfs: false,
        _scheduled: true
      })
    }
  })

  return merged
}

/**
 * Sort trains by arrival time, prioritizing live data over scheduled
 */
export function sortTrains(trains: Train[]): Train[] {
  return [...trains].sort((a, b) => {
    // Live trains first (API or GTFS-RT)
    const aIsLive = !a._scheduled
    const bIsLive = !b._scheduled
    if (aIsLive !== bIsLive) return aIsLive ? -1 : 1

    // Then by arrival time
    return getTrainMinutes(a.Min) - getTrainMinutes(b.Min)
  })
}
