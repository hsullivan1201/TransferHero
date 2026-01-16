import type { Train } from '@transferhero/shared'
import { getTrainMinutes, normalizeDestination } from '@transferhero/shared'

export interface MergeTrainDataOptions {
  /** trains from the WMATA API */
  apiTrains: Train[]
  /** trains from the GTFS-RT feed */
  gtfsTrains: Train[]
  /** trains from the static schedule (optional) */
  scheduledTrains?: Train[]
  /** dedupe window for GTFS trains (minutes) */
  gtfsThreshold?: number
  /** dedupe window for scheduled trains (minutes) */
  scheduleThreshold?: number
}

/**
 * merge train data from API/GTFS-RT/schedule
 * dedupe on arrival time + line so we don't double-count
 *
 * priority: api > gtfs-rt > schedule
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

  // pull in gtfs-rt trains, skipping near-duplicates (api wins)
  gtfsTrains.forEach(gTrain => {
    const gMin = getTrainMinutes(gTrain.Min)
    const gDest = normalizeDestination(gTrain.DestinationName || '')

    // dedupe against any existing train (api first, then gtfs already added)
    const duplicate = merged.some(mTrain => {
      const mMin = getTrainMinutes(mTrain.Min)
      const mDest = normalizeDestination(mTrain.DestinationName || '')

      const normalizedDest = (dest: string) => {
        const norm = normalizeDestination(dest || '')
        return (!norm || norm.includes('check board')) ? '*' : norm
      }
      const destMatch = (() => {
        const m = normalizedDest(mDest)
        const g = normalizedDest(gDest)
        return m === '*' || g === '*' || m === g
      })()

      const withinThreshold = Math.abs(mMin - gMin) <= gtfsThreshold
      const withinOneMinute = Math.abs(mMin - gMin) <= 1

      return (
        mTrain.Line === gTrain.Line &&
        withinThreshold &&
        (destMatch || withinOneMinute)
      )
    })

    if (!duplicate) merged.push(gTrain)
  })

  // now sprinkle in scheduled trains, still avoiding near-duplicates
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

  // final cleanup: prefer earlier entries (api first), drop duplicate tripIds
  // and any exact line/destination/min combos that snuck through
  const seenTripIds = new Set<string>()
  const seenComposite = new Set<string>()

  return merged.filter(train => {
    if (train._tripId) {
      if (seenTripIds.has(train._tripId)) return false
      seenTripIds.add(train._tripId)
    }

    const destKey = (train.DestinationName || '').toLowerCase()
    const compositeKey = `${train.Line}_${destKey}_${getTrainMinutes(train.Min)}`
    if (seenComposite.has(compositeKey)) return false
    seenComposite.add(compositeKey)
    return true
  })
}

/**
 * sort trains by arrival time, favoring live data over scheduled
 */
export function sortTrains(trains: Train[]): Train[] {
  return [...trains].sort((a, b) => {
    // live trains first (api or gtfs-rt)
    const aIsLive = !a._scheduled
    const bIsLive = !b._scheduled
    if (aIsLive !== bIsLive) return aIsLive ? -1 : 1

    // then by arrival time
    return getTrainMinutes(a.Min) - getTrainMinutes(b.Min)
  })
}
