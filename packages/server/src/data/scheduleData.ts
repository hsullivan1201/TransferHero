import type { Train } from '@transferhero/shared'
import { getDisplayName } from '@transferhero/shared'
import { getMetroDepartures } from '../services/metroScheduleIndex.js'

/**
 * Get scheduled trains for a station and terminus.
 * Returns real GTFS departure times only — no fake frequency-based trains.
 * If GTFS has no departures (e.g. 2 AM), returns empty array.
 */
export function getScheduledTrains(
  stationCode: string,
  terminus: string | string[],
  startFromMinutes = 0
): Train[] {
  const gtfsDepartures = getMetroDepartures(stationCode, terminus, startFromMinutes)

  return gtfsDepartures.map(dep => ({
    Line: dep.line,
    DestinationName: getDisplayName(dep.headsign),
    Min: dep.minutesFromNow.toString(),
    Car: '8',
    _scheduled: true,
    _tripId: dep.tripId,
  }))
}
