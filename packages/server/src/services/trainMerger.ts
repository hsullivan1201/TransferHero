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

function isUnknownDestination(destination: string): boolean {
  return !destination || destination.includes('check board')
}

function identityCompatible(left: Train, right: Train): boolean {
  const leftDestination = normalizeDestination(left.DestinationName || '')
  const rightDestination = normalizeDestination(right.DestinationName || '')
  return isUnknownDestination(leftDestination)
    || isUnknownDestination(rightDestination)
    || leftDestination === rightDestination
}

interface IdentityMatchPlan {
  matches: number
  distance: number
  pairs: Array<[apiIndex: number, gtfsIndex: number]>
}

function betterIdentityPlan(left: IdentityMatchPlan, right: IdentityMatchPlan): IdentityMatchPlan {
  if (left.matches !== right.matches) return left.matches > right.matches ? left : right
  if (left.distance !== right.distance) return left.distance < right.distance ? left : right
  return left.pairs.length >= right.pairs.length ? left : right
}

/**
 * Match the two ordered prediction streams one-to-one before display dedupe.
 * Maximizing matches first prevents a nearby GTFS row from consuming the only
 * API row that a later train can use; minimizing total distance then chooses
 * the closest stable identities without letting trains cross in sequence.
 */
function enrichApiTripIds(
  apiTrains: Train[],
  gtfsTrains: Train[],
  threshold: number
): Train[] {
  const enriched = apiTrains.map(train => ({ ...train }))
  const lines = new Set(apiTrains.map(train => train.Line))

  for (const line of lines) {
    const apiIndices = apiTrains
      .map((train, index) => ({ train, index }))
      .filter(item => item.train.Line === line)
      .sort((a, b) => getTrainMinutes(a.train.Min) - getTrainMinutes(b.train.Min) || a.index - b.index)
      .map(item => item.index)
    const gtfsIndices = gtfsTrains
      .map((train, index) => ({ train, index }))
      .filter(item => item.train.Line === line && !!item.train._tripId)
      .sort((a, b) => getTrainMinutes(a.train.Min) - getTrainMinutes(b.train.Min) || a.index - b.index)
      .map(item => item.index)
    const memo = new Map<string, IdentityMatchPlan>()

    const planFrom = (apiOffset: number, gtfsOffset: number): IdentityMatchPlan => {
      if (apiOffset >= apiIndices.length || gtfsOffset >= gtfsIndices.length) {
        return { matches: 0, distance: 0, pairs: [] }
      }
      const key = `${apiOffset}:${gtfsOffset}`
      const cached = memo.get(key)
      if (cached) return cached

      let best = betterIdentityPlan(
        planFrom(apiOffset + 1, gtfsOffset),
        planFrom(apiOffset, gtfsOffset + 1)
      )
      const apiIndex = apiIndices[apiOffset]
      const gtfsIndex = gtfsIndices[gtfsOffset]
      const apiTrain = apiTrains[apiIndex]
      const gtfsTrain = gtfsTrains[gtfsIndex]
      const distance = Math.abs(getTrainMinutes(apiTrain.Min) - getTrainMinutes(gtfsTrain.Min))

      if (distance <= threshold && identityCompatible(apiTrain, gtfsTrain)) {
        const remainder = planFrom(apiOffset + 1, gtfsOffset + 1)
        best = betterIdentityPlan({
          matches: remainder.matches + 1,
          distance: remainder.distance + distance,
          pairs: [[apiIndex, gtfsIndex], ...remainder.pairs],
        }, best)
      }

      memo.set(key, best)
      return best
    }

    for (const [apiIndex, gtfsIndex] of planFrom(0, 0).pairs) {
      if (!enriched[apiIndex]._tripId) {
        enriched[apiIndex]._tripId = gtfsTrains[gtfsIndex]._tripId
      }
    }
  }

  return enriched
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

  // Prediction cache entries can be reused elsewhere, so enrich copies only.
  const merged: Train[] = enrichApiTripIds(apiTrains, gtfsTrains, gtfsThreshold)

  // pull in gtfs-rt trains, skipping near-duplicates (api wins)
  gtfsTrains.forEach(gTrain => {
    const gMin = getTrainMinutes(gTrain.Min)
    const gDest = normalizeDestination(gTrain.DestinationName || '')

    // dedupe against any existing train (api first, then gtfs already added)
    const duplicateIndex = merged.findIndex(mTrain => {
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

    if (duplicateIndex === -1) {
      merged.push(gTrain)
      return
    }

    // Stable ids were assigned one-to-one above. Display dedupe can remain
    // intentionally loose without binding the wrong GTFS trip to its winner.
  })

  // now sprinkle in scheduled trains, still avoiding near-duplicates
  scheduledTrains.forEach(sTrain => {
    const sMin = getTrainMinutes(sTrain.Min)
    const sDest = normalizeDestination(sTrain.DestinationName || '')
    const duplicate = merged.some(mTrain => {
      if (mTrain.Line !== sTrain.Line) return false
      const mMin = getTrainMinutes(mTrain.Min)
      const mDest = normalizeDestination(mTrain.DestinationName || '')
      const unknownDestination = (destination: string) =>
        !destination || destination.includes('check board')
      const destinationMatches = unknownDestination(mDest)
        || unknownDestination(sDest)
        || mDest === sDest
      return destinationMatches && Math.abs(mMin - sMin) <= scheduleThreshold
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
