import type { CatchableTrain, Line, Train } from '@transferhero/shared'
import { getDisplayName } from '@transferhero/shared'
import { findStationByCode } from '../data/stations.js'
import {
  getDirectTripCarPosition,
  getTransferCarPosition,
  getTransferWayfinding
} from '../data/carPositionService.js'
import { getPlatformForLine } from '../data/platformCodes.js'
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js'
import { getDirectLinesForLeg, getInterlinedLinesForLeg, getStopsBeyondDestination, getStopsForLeg, getTerminusString } from './lineHelpers.js'
import { getMetroDepartures, type ScheduledMetroTrain } from './metroScheduleIndex.js'
import { findTransfer, getAllTerminiForStation } from './pathfinding.js'
import { calculateRouteTravelTime, getCanonicalTerminus, getTerminus, minutesToClockTime } from './travelTime.js'

/** per-line canonical terminus names — signage labels, not short-turn headsigns */
function buildDirectionLabels(
  lines: Array<Line | undefined> | undefined,
  fromStation: string,
  toStation: string
): Partial<Record<Line, string>> {
  const labels: Partial<Record<Line, string>> = {}
  for (const line of lines ?? []) {
    if (!line || labels[line]) continue
    const label = getCanonicalTerminus(line, fromStation, toStation)
    if (label) labels[line] = label
  }
  return labels
}

export interface PlanScheduledTripInput {
  from: string
  to: string
  walkTime: number
  transferStation?: string
  accessible: boolean
  departAtMs: number
}

/** the schedule index only covers the current service day (plus tomorrow after 9 PM) */
export const MAX_FUTURE_HOURS = 10

const TRAINS_PER_LEG = 10
const CATCH_THRESHOLD = -3

interface ScheduledTripDeps {
  getMetroDepartures: typeof getMetroDepartures
  now: () => number
}

const defaultDeps: ScheduledTripDeps = {
  getMetroDepartures,
  now: () => Date.now()
}

function validateDepartureOffset(offsetMin: number): void {
  if (offsetMin < -5) {
    throw new ValidationError('Departure time is in the past')
  }
  if (offsetMin > MAX_FUTURE_HOURS * 60) {
    throw new ValidationError(
      `Scheduling is only available for the current service day (up to ${MAX_FUTURE_HOURS} hours ahead)`
    )
  }
}

/** map a GTFS departure to the Train shape the client already renders */
function toScheduledTrain(
  dep: ScheduledMetroTrain,
  arrivalMin: number,
  nowMs: number
): Train {
  return {
    Line: dep.line,
    DestinationName: getDisplayName(dep.headsign),
    Min: dep.minutesFromNow.toString(),
    Car: '8',
    _scheduled: true,
    _tripId: dep.tripId,
    _destArrivalMin: arrivalMin,
    _destArrivalTime: minutesToClockTime(arrivalMin),
    _destArrivalTimestamp: nowMs + arrivalMin * 60_000,
  }
}

/**
 * Plan a trip for a future departure using GTFS schedule data exclusively —
 * no realtime prediction or GTFS-RT calls. Response shape mirrors planTrip so
 * the client renders it unchanged; leg2 trains are included inline as
 * CatchableTrain[] (relative to the first leg1 departure) since there are no
 * realtime updates to poll for.
 */
export function planScheduledTrip(
  input: PlanScheduledTripInput,
  deps: ScheduledTripDeps = defaultDeps
): any {
  const { from, to, walkTime, transferStation, accessible, departAtMs } = input
  const nowMs = deps.now()
  const offsetMin = Math.round((departAtMs - nowMs) / 60_000)

  validateDepartureOffset(offsetMin)

  const fromStation = findStationByCode(from)
  const toStation = findStationByCode(to)
  if (!fromStation) throw new NotFoundError(`Origin station not found: ${from}`)
  if (!toStation) throw new NotFoundError(`Destination station not found: ${to}`)

  let transfer = findTransfer(from, to, walkTime)
  let defaultTransferName: string | undefined
  if (transferStation && transfer && !transfer.direct && transfer.alternatives) {
    const requested = transfer.alternatives.find(alt => alt.station === transferStation)
    if (requested) {
      defaultTransferName = transfer.name
      transfer = { ...requested, alternatives: transfer.alternatives }
    }
  }
  if (!transfer) {
    throw new NotFoundError('No route found between stations')
  }

  const meta = {
    fetchedAt: new Date(nowMs).toISOString(),
    sources: ['schedule'],
    scheduleOnly: true,
    plannedFor: new Date(departAtMs).toISOString(),
    walkTime,
  }

  if (transfer.direct) {
    const directLines = getDirectLinesForLeg(fromStation.lines, toStation.lines, from, to)
    const allTermini = directLines.flatMap(line => getTerminus(line, from, to))
    const terminus = [...new Set(allTermini)]
    const originPlatforms = [...new Set(directLines.map(line => getPlatformForLine(from, line)))]

    const departures = originPlatforms
      .flatMap(platform => deps.getMetroDepartures(platform, terminus, offsetMin, TRAINS_PER_LEG))
      .filter(dep => directLines.includes(dep.line))
      .sort((a, b) => a.minutesFromNow - b.minutesFromNow)
      .slice(0, TRAINS_PER_LEG)

    const trains = departures.map(dep =>
      toScheduledTrain(dep, dep.minutesFromNow + calculateRouteTravelTime(from, to, dep.line), nowMs)
    )

    const lineCarPositions = directLines.reduce<Partial<Record<Line, ReturnType<typeof getDirectTripCarPosition>>>>((positions, line) => {
      positions[line] = getDirectTripCarPosition(to, line, getTerminusString(getTerminus(line, from, to)), accessible)
      return positions
    }, {})
    const lineStops = directLines.reduce<Partial<Record<Line, ReturnType<typeof getStopsForLeg>>>>((stops, line) => {
      stops[line] = getStopsForLeg(line, from, to)
      return stops
    }, {})
    const lineStopsBeyond = directLines.reduce<Partial<Record<Line, ReturnType<typeof getStopsBeyondDestination>>>>((stops, line) => {
      stops[line] = getStopsBeyondDestination(line, from, to)
      return stops
    }, {})

    return {
      trip: {
        origin: fromStation,
        destination: toStation,
        isDirect: true,
        transfer: null,
        alternatives: [],
        leg1: {
          trains,
          carPosition: directLines.length === 1 ? lineCarPositions[directLines[0]] ?? null : null,
          directionLabels: buildDirectionLabels(directLines, from, to),
          stops: directLines.length === 1 ? lineStops[directLines[0]] ?? [] : undefined,
          stopsBeyond: directLines.length === 1 ? lineStopsBeyond[directLines[0]] ?? [] : undefined,
          ...(directLines.length > 1 ? { lineCarPositions, lineStops, lineStopsBeyond } : {})
        }
      },
      meta
    }
  }

  const terminusFirst = getAllTerminiForStation(
    fromStation,
    from,
    transfer.fromPlatform || 'C01',
    transfer.fromLine
  )
  const terminusSecond = getAllTerminiForStation(
    toStation,
    transfer.toPlatform || 'A01',
    to,
    transfer.toLine
  )

  const leg1AllowedLines = getInterlinedLinesForLeg(
    transfer.fromLine!, fromStation.lines, from, transfer.fromPlatform
  )
  const leg2AllowedLines = getInterlinedLinesForLeg(
    transfer.toLine!, toStation.lines, transfer.toPlatform, to
  )

  const leg1TravelTime = transfer.leg1Time
    || calculateRouteTravelTime(from, transfer.fromPlatform, transfer.fromLine!)
  const leg2TravelTime = transfer.leg2Time
    || calculateRouteTravelTime(transfer.toPlatform, to, transfer.toLine!)

  const leg1OriginPlatforms = [...new Set(
    leg1AllowedLines.map(line => getPlatformForLine(from, line))
  )]
  const leg1Departures = leg1OriginPlatforms
    .flatMap(platform => deps.getMetroDepartures(platform, terminusFirst, offsetMin, TRAINS_PER_LEG))
    .filter(dep => !leg1AllowedLines || leg1AllowedLines.includes(dep.line))
    .sort((a, b) => a.minutesFromNow - b.minutesFromNow)
    .slice(0, TRAINS_PER_LEG)

  // leg1 trains carry both transfer arrival and (schedule-derived) final arrival
  const leg1Trains: Train[] = leg1Departures.map(dep => {
    const transferArrivalMin = dep.minutesFromNow + leg1TravelTime
    // first catchable leg2 departure after arriving + walking determines final arrival
    const connection = deps.getMetroDepartures(transfer!.toPlatform, terminusSecond, transferArrivalMin + walkTime, 1)
      .filter(d => !leg2AllowedLines || leg2AllowedLines.includes(d.line))[0]
    const finalArrivalMin = connection
      ? connection.minutesFromNow + leg2TravelTime
      : transferArrivalMin + walkTime + leg2TravelTime

    const train = toScheduledTrain(dep, finalArrivalMin, nowMs)
    return {
      ...train,
      _transferArrivalMin: transferArrivalMin,
      _transferArrivalTime: minutesToClockTime(transferArrivalMin),
      _transferArrivalTimestamp: nowMs + transferArrivalMin * 60_000,
    }
  })

  // leg2 catchability is relative to the first listed leg1 departure
  const firstLeg1 = leg1Departures[0]
  const arrivalAtTransfer = firstLeg1
    ? firstLeg1.minutesFromNow + leg1TravelTime + walkTime
    : offsetMin + leg1TravelTime + walkTime

  const leg2Trains: CatchableTrain[] = deps.getMetroDepartures(transfer.toPlatform, terminusSecond, arrivalAtTransfer - 3, TRAINS_PER_LEG)
    .filter(dep => !leg2AllowedLines || leg2AllowedLines.includes(dep.line))
    .map(dep => {
      const waitTime = dep.minutesFromNow - arrivalAtTransfer
      const totalTime = dep.minutesFromNow + leg2TravelTime
      const base = toScheduledTrain(dep, totalTime, nowMs)
      return {
        ...base,
        _waitTime: waitTime,
        _canCatch: waitTime >= CATCH_THRESHOLD,
        _totalTime: totalTime,
        _arrivalClock: minutesToClockTime(totalTime),
      }
    })
    .filter(train => train._canCatch)

  const carPositions = getTransferCarPosition(
    transfer.fromPlatform,
    transfer.fromLine!,
    transfer.toLine!,
    getTerminusString(terminusFirst),
    to,
    getTerminusString(terminusSecond),
    accessible
  )
  const transferWayfinding = getTransferWayfinding(
    transfer.fromPlatform,
    transfer.fromLine!,
    transfer.toLine!
  )

  return {
    trip: {
      origin: fromStation,
      destination: toStation,
      isDirect: false,
      transfer: {
        station: transfer.station,
        name: transfer.name,
        fromPlatform: transfer.fromPlatform,
        toPlatform: transfer.toPlatform,
        fromLine: transfer.fromLine,
        toLine: transfer.toLine,
        leg1Time: leg1TravelTime,
        leg2Time: leg2TravelTime,
        alternatives: transfer.alternatives || [],
        defaultTransferName,
        toPlatformLines: transferWayfinding.toPlatformLines,
        levelInstruction: transferWayfinding.levelInstruction
      },
      leg1: {
        trains: leg1Trains,
        carPosition: carPositions.leg1,
        terminus: terminusFirst,
        travelTime: leg1TravelTime,
        directionLabels: buildDirectionLabels(
          leg1AllowedLines ?? [transfer.fromLine],
          from,
          transfer.fromPlatform
        ),
        stops: getStopsForLeg(transfer.fromLine!, from, transfer.fromPlatform)
      },
      leg2: {
        trains: leg2Trains,
        terminus: terminusSecond,
        travelTime: leg2TravelTime,
        carPosition: carPositions.leg2,
        directionLabels: buildDirectionLabels(
          leg2AllowedLines ?? [transfer.toLine],
          transfer.toPlatform,
          to
        ),
        stops: getStopsForLeg(transfer.toLine!, transfer.toPlatform, to),
        stopsBeyond: getStopsBeyondDestination(transfer.toLine!, transfer.toPlatform, to)
      }
    },
    meta
  }
}
