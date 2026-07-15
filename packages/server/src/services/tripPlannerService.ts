import type { CatchableTrain, Line, Train } from '@transferhero/shared'
import { getTrainMinutes } from '@transferhero/shared'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'
import { getStaticTrips } from '../data/staticTrips.js'
import { getScheduledTrains } from '../data/scheduleData.js'
import {
  getDirectTripCarPosition,
  getTransferCarPosition,
  getTransferWayfinding
} from '../data/carPositionService.js'
import { LINE_STATIONS } from '../data/lineConfig.js'
import { getPlatformForLine, normalizePlatformCode } from '../data/platformCodes.js'
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js'
import { getInterlinesForLeg1, getInterlinesForLeg2, getStopsBeyondDestination, getStopsForLeg, getTerminusString } from './lineHelpers.js'
import { planScheduledTrip } from './scheduledTripPlanner.js'
import { findTransfer, getAllTerminiForStation } from './pathfinding.js'
import { mergeTrainData, sortTrains } from './trainMerger.js'
import { calculateRouteTravelTime, getTerminus, minutesToClockTime } from './travelTime.js'
import {
  fetchDestinationArrivals,
  fetchGTFSTripUpdates,
  fetchStationPredictions,
  filterApiResponse,
  findDepartedTrains,
  parseUpdatesToTrains,
} from './wmata.js'

export interface PlanTripInput {
  from: string
  to: string
  walkTime: number
  transferStation?: string
  accessible: boolean
  includeDeparted: boolean
  apiKey: string
  /** epoch ms — plan for a future departure using schedule data instead of realtime */
  departAt?: number
}

/** departures further out than realtime predictions cover go to the schedule-only planner */
const REALTIME_HORIZON_MIN = 30

export interface PlanLeg2Input {
  tripId: string
  departureMin: number
  walkTime: number
  transferStation?: string
  transferArrivalMin?: number
  accessible: boolean
  includeDeparted: boolean
  apiKey: string
}

export interface TripPlanner {
  planTrip(input: PlanTripInput): Promise<any>
  planLeg2(input: PlanLeg2Input): Promise<any>
}

export interface TripPlannerDeps {
  fetchStationPredictions: typeof fetchStationPredictions
  fetchGTFSTripUpdates: typeof fetchGTFSTripUpdates
  parseUpdatesToTrains: typeof parseUpdatesToTrains
  filterApiResponse: typeof filterApiResponse
  fetchDestinationArrivals: typeof fetchDestinationArrivals
  findDepartedTrains: typeof findDepartedTrains
  nowIso: () => string
}

const defaultTripPlannerDeps: TripPlannerDeps = {
  fetchStationPredictions,
  fetchGTFSTripUpdates,
  parseUpdatesToTrains,
  filterApiResponse,
  fetchDestinationArrivals,
  findDepartedTrains,
  nowIso: () => new Date().toISOString()
}

interface TransferBuildOptions {
  allowYellowFallback?: boolean
  branchWarning?: string
  defaultTransferName?: string
}

export function createTripPlanner(overrides: Partial<TripPlannerDeps> = {}): TripPlanner {
  const deps: TripPlannerDeps = {
    ...defaultTripPlannerDeps,
    ...overrides
  }

  async function planTrip(input: PlanTripInput): Promise<any> {
    const { from, to, walkTime, transferStation, accessible, includeDeparted, apiKey, departAt } = input

    // future departures beyond the realtime horizon use GTFS schedule data only
    if (departAt !== undefined) {
      const offsetMin = Math.round((departAt - Date.now()) / 60000)
      if (offsetMin > REALTIME_HORIZON_MIN) {
        return planScheduledTrip({ from, to, walkTime, transferStation, accessible, departAtMs: departAt })
      }
      // within the horizon, realtime "leave now" data already covers the departure
    }

    const fromStation = findStationByCode(from)
    const toStation = findStationByCode(to)

    if (!fromStation) {
      throw new NotFoundError(`Origin station not found: ${from}`)
    }
    if (!toStation) {
      throw new NotFoundError(`Destination station not found: ${to}`)
    }

    let transfer = findTransfer(from, to, walkTime)
    let defaultTransferName: string | undefined

    if (transferStation && transfer && !transfer.direct && transfer.alternatives) {
      const requestedAlternative = transfer.alternatives.find(alt => alt.station === transferStation)
      if (requestedAlternative) {
        defaultTransferName = transfer.name
        const alternatives = transfer.alternatives
        transfer = { ...requestedAlternative, alternatives }
      }
    }

    if (!transfer) {
      throw new NotFoundError('No route found between stations')
    }

    if (transfer.direct) {
      const directLines = fromStation.lines.filter((line: Line) => toStation.lines.includes(line))
      const allTermini: string[] = []
      for (const line of directLines) {
        const lineTermini = getTerminus(line, from, to)
        allTermini.push(...lineTermini)
      }
      const terminus = [...new Set(allTermini)]
      const originPlatforms = [...new Set(directLines.map(line => getPlatformForLine(from, line)))]

      const [originPredArrays, destPreds, gtfsEntities] = await Promise.all([
        Promise.all(originPlatforms.map(platform => deps.fetchStationPredictions(platform, apiKey))),
        deps.fetchStationPredictions(to, apiKey),
        deps.fetchGTFSTripUpdates(apiKey)
      ])

      const originPreds = originPredArrays.flat()
      const apiFiltered = deps.filterApiResponse(originPreds, terminus, directLines)
      const staticTrips = getStaticTrips()
      const gtfsTrainArrays = originPlatforms.map(platform =>
        deps.parseUpdatesToTrains(gtfsEntities, platform, terminus, staticTrips, directLines)
      )
      const gtfsTrains = gtfsTrainArrays.flat()

      const scheduledTrains = getScheduledTrains(from, terminus, 35)
        .filter(train => directLines.includes(train.Line))
      const mergedTrains = mergeTrainData({
        apiTrains: apiFiltered,
        gtfsTrains,
        scheduledTrains
      })

      const trainsByLine = mergedTrains.reduce<Map<Line, Train[]>>((grouped, train) => {
        const existing = grouped.get(train.Line)
        if (existing) existing.push(train)
        else grouped.set(train.Line, [train])
        return grouped
      }, new Map())

      const trainsWithArrivalArrays = await Promise.all(
        Array.from(trainsByLine.entries()).map(([line, trains]) =>
          deps.fetchDestinationArrivals(
            trains,
            to,
            apiKey,
            gtfsEntities,
            destPreds,
            calculateRouteTravelTime(from, to, line)
          )
        )
      )
      const trainsWithArrival = trainsWithArrivalArrays.flat()

      let sortedTrains = sortTrains(trainsWithArrival)

      if (includeDeparted && directLines.length > 0) {
        const allDepartedTrains: Train[] = []
        for (const line of directLines) {
          const lineTravelTime = calculateRouteTravelTime(from, to, line)
          const lineTermini = getTerminus(line, from, to)
          const departedTrains = deps.findDepartedTrains(
            to,
            line,
            lineTravelTime,
            gtfsEntities,
            staticTrips,
            lineTermini
          )
          allDepartedTrains.push(...departedTrains)
        }
        const existingTripIds = new Set(sortedTrains.map(t => t._tripId).filter(Boolean))
        const uniqueDeparted = allDepartedTrains.filter(t => !t._tripId || !existingTripIds.has(t._tripId))
        sortedTrains = [...sortedTrains, ...uniqueDeparted]
      }

      const lineCarPositions = directLines.reduce<Partial<Record<Line, ReturnType<typeof getDirectTripCarPosition>>>>((positions, line) => {
        positions[line] = getDirectTripCarPosition(
          to,
          line,
          getTerminusString(getTerminus(line, from, to)),
          accessible
        )
        return positions
      }, {})

      const directCarPosition = directLines.length === 1
        ? lineCarPositions[directLines[0]] ?? null
        : null
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
            trains: sortedTrains,
            carPosition: directCarPosition,
            stops: directLines.length === 1 ? lineStops[directLines[0]] ?? [] : undefined,
            stopsBeyond: directLines.length === 1 ? lineStopsBeyond[directLines[0]] ?? [] : undefined,
            ...(directLines.length > 1 ? { lineCarPositions, lineStops, lineStopsBeyond } : {})
          }
        },
        meta: {
          fetchedAt: deps.nowIso(),
          sources: ['api', 'gtfs-rt']
        }
      }
    }

    const yellowStations = LINE_STATIONS.YL || []
    const mtVernonIdx = yellowStations.indexOf('E01')
    const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const destinationToCode = (destName: string) => {
      const normalized = normalizeName(destName)
      const match = ALL_STATIONS.find(st => normalizeName(st.name) === normalized)
      return match?.code
    }
    const isNorthOfMtVernon = (code: string) => {
      if (mtVernonIdx === -1) return false
      const normalized = normalizePlatformCode(code, yellowStations)
      const idx = yellowStations.indexOf(normalized)
      if (idx === -1) return false
      return idx > mtVernonIdx
    }

    const buildTransferTrip = async (
      currentTransfer: NonNullable<typeof transfer>,
      options: TransferBuildOptions = {}
    ): Promise<any> => {
      const { allowYellowFallback = false, branchWarning, defaultTransferName: optDefaultName } = options

      const terminusFirst = getAllTerminiForStation(
        fromStation,
        from,
        currentTransfer.fromPlatform || 'C01'
      )
      const terminusSecond = getAllTerminiForStation(
        toStation,
        currentTransfer.toPlatform || 'A01',
        to
      )

      const leg1AllowedLines = getInterlinesForLeg1(fromStation, currentTransfer.fromPlatform)
        || (currentTransfer.fromLine ? [currentTransfer.fromLine] : undefined)

      const leg1OriginPlatforms = leg1AllowedLines
        ? [...new Set(leg1AllowedLines.map(line => getPlatformForLine(from, line)))]
        : [from]

      const [originPredArrays, transferPreds, destPreds, gtfsEntities] = await Promise.all([
        Promise.all(leg1OriginPlatforms.map(platform => deps.fetchStationPredictions(platform, apiKey))),
        deps.fetchStationPredictions(currentTransfer.toPlatform, apiKey),
        deps.fetchStationPredictions(to, apiKey),
        deps.fetchGTFSTripUpdates(apiKey)
      ])
      const originPreds = originPredArrays.flat()

      const staticTrips = getStaticTrips()
      const leg1ApiFiltered = deps.filterApiResponse(originPreds, terminusFirst, leg1AllowedLines)
      const leg1GtfsTrainArrays = leg1OriginPlatforms.map(platform =>
        deps.parseUpdatesToTrains(gtfsEntities, platform, terminusFirst, staticTrips, leg1AllowedLines)
      )
      const leg1GtfsTrains = leg1GtfsTrainArrays.flat()
      const leg1ScheduledTrains = getScheduledTrains(from, terminusFirst, 35)
      const leg1MergedTrains = mergeTrainData({
        apiTrains: leg1ApiFiltered,
        gtfsTrains: leg1GtfsTrains,
        scheduledTrains: leg1ScheduledTrains
      })

      const leg1ExpectedTime = calculateRouteTravelTime(from, currentTransfer.fromPlatform, currentTransfer.fromLine!)
      const leg1WithTransferArrival = await deps.fetchDestinationArrivals(
        leg1MergedTrains,
        currentTransfer.fromPlatform,
        apiKey,
        gtfsEntities,
        transferPreds,
        leg1ExpectedTime
      )

      const leg1WithBothArrivals = leg1WithTransferArrival.map(train => ({
        ...train,
        _transferArrivalMin: train._destArrivalMin,
        _transferArrivalTime: train._destArrivalTime,
        _transferArrivalTimestamp: train._destArrivalTimestamp
      }))

      const leg1WithArrival = await deps.fetchDestinationArrivals(
        leg1WithBothArrivals,
        to,
        apiKey,
        gtfsEntities,
        destPreds
      )
      let sortedTrains = sortTrains(leg1WithArrival)

      if (includeDeparted && currentTransfer.fromLine) {
        const leg1TravelTime = currentTransfer.leg1Time || calculateRouteTravelTime(
          from,
          currentTransfer.fromPlatform,
          currentTransfer.fromLine
        )
        const departedTrains = deps.findDepartedTrains(
          currentTransfer.fromPlatform,
          currentTransfer.fromLine,
          leg1TravelTime,
          gtfsEntities,
          staticTrips,
          terminusFirst
        )
        const existingTripIds = new Set(sortedTrains.map(t => t._tripId).filter(Boolean))
        const uniqueDeparted = departedTrains.filter(t => !t._tripId || !existingTripIds.has(t._tripId))
        sortedTrains = [...sortedTrains, ...uniqueDeparted]
      }

      const leg2AllowedLines = getInterlinesForLeg2(currentTransfer.toPlatform, toStation)
        || (currentTransfer.toLine ? [currentTransfer.toLine] : undefined)
      const leg2ApiFiltered = deps.filterApiResponse(transferPreds, terminusSecond, leg2AllowedLines)
      const leg2GtfsTrains = deps.parseUpdatesToTrains(
        gtfsEntities,
        currentTransfer.toPlatform,
        terminusSecond,
        staticTrips,
        leg2AllowedLines
      )
      const leg2ScheduledTrains = getScheduledTrains(currentTransfer.toPlatform, terminusSecond, 35)
      const leg2MergedTrains = mergeTrainData({
        apiTrains: leg2ApiFiltered,
        gtfsTrains: leg2GtfsTrains,
        scheduledTrains: leg2ScheduledTrains
      })

      const leg2ExpectedTime = calculateRouteTravelTime(currentTransfer.toPlatform, to, currentTransfer.toLine!)
      const leg2WithArrival = await deps.fetchDestinationArrivals(
        leg2MergedTrains,
        to,
        apiKey,
        gtfsEntities,
        destPreds,
        leg2ExpectedTime
      )
      const leg2SortedTrains = sortTrains(leg2WithArrival)

      let branchWarningToUse = branchWarning
      const destinationIsNorth = isNorthOfMtVernon(to)
      if (currentTransfer.toLine === 'YL' && destinationIsNorth && mtVernonIdx !== -1) {
        const yellowTrains = leg2WithArrival.filter(train => train.Line === 'YL')
        const hasYellowBeyondMtVernon = yellowTrains.some(train => {
          const destCode = destinationToCode(train.DestinationName || '')
          if (!destCode) return false
          const normalizedDest = normalizePlatformCode(destCode, yellowStations)
          const destIdx = yellowStations.indexOf(normalizedDest)
          return destIdx > mtVernonIdx
        })

        if (!hasYellowBeyondMtVernon) {
          branchWarningToUse = 'yellow_branch_inactive'
          if (allowYellowFallback) {
            const greenAlt = currentTransfer.alternatives?.find(alt => alt.toLine === 'GR')
            if (greenAlt) {
              const fallbackTransfer = { ...greenAlt, alternatives: currentTransfer.alternatives }
              return buildTransferTrip(fallbackTransfer, {
                allowYellowFallback: false,
                branchWarning: branchWarningToUse,
                defaultTransferName: optDefaultName ?? currentTransfer.name
              })
            }
          }
        }
      }

      const carPositions = getTransferCarPosition(
        currentTransfer.fromPlatform,
        currentTransfer.fromLine!,
        currentTransfer.toLine!,
        getTerminusString(terminusFirst),
        to,
        getTerminusString(terminusSecond),
        accessible
      )
      const transferWayfinding = getTransferWayfinding(
        currentTransfer.fromPlatform,
        currentTransfer.fromLine!,
        currentTransfer.toLine!
      )

      const leg1TravelTime = currentTransfer.leg1Time || calculateRouteTravelTime(
        from,
        currentTransfer.fromPlatform,
        currentTransfer.fromLine!
      )
      const leg2TravelTime = currentTransfer.leg2Time || calculateRouteTravelTime(
        currentTransfer.toPlatform,
        to,
        currentTransfer.toLine!
      )

      return {
        trip: {
          origin: fromStation,
          destination: toStation,
          isDirect: false,
          transfer: {
            station: currentTransfer.station,
            name: currentTransfer.name,
            fromPlatform: currentTransfer.fromPlatform,
            toPlatform: currentTransfer.toPlatform,
            fromLine: currentTransfer.fromLine,
            toLine: currentTransfer.toLine,
            leg1Time: leg1TravelTime,
            leg2Time: leg2TravelTime,
            alternatives: currentTransfer.alternatives || [],
            defaultTransferName: optDefaultName,
            toPlatformLines: transferWayfinding.toPlatformLines,
            levelInstruction: transferWayfinding.levelInstruction
          },
          leg1: {
            trains: sortedTrains,
            carPosition: carPositions.leg1,
            terminus: terminusFirst,
            travelTime: leg1TravelTime,
            stops: getStopsForLeg(currentTransfer.fromLine!, from, currentTransfer.fromPlatform)
          },
          leg2: {
            trains: leg2SortedTrains,
            terminus: terminusSecond,
            travelTime: leg2TravelTime,
            carPosition: carPositions.leg2,
            stops: getStopsForLeg(currentTransfer.toLine!, currentTransfer.toPlatform, to),
            stopsBeyond: getStopsBeyondDestination(currentTransfer.toLine!, currentTransfer.toPlatform, to)
          }
        },
        meta: {
          fetchedAt: deps.nowIso(),
          sources: ['api', 'gtfs-rt'],
          walkTime,
          branchWarning: branchWarningToUse
        }
      }
    }

    return buildTransferTrip(transfer, { allowYellowFallback: true, defaultTransferName })
  }

  async function planLeg2(input: PlanLeg2Input): Promise<any> {
    const { tripId, departureMin, walkTime, transferStation, transferArrivalMin, accessible, includeDeparted, apiKey } = input

    const [from, to] = tripId.split('-')
    if (!from || !to) {
      throw new ValidationError('Invalid trip ID format. Expected: fromCode-toCode')
    }

    const fromStation = findStationByCode(from)
    const toStation = findStationByCode(to)

    if (!fromStation || !toStation) {
      throw new NotFoundError('Station not found')
    }

    let transfer = findTransfer(from, to, walkTime)
    if (transferStation && transfer && !transfer.direct && transfer.alternatives) {
      const requestedAlternative = transfer.alternatives.find(alt => alt.station === transferStation)
      if (requestedAlternative) {
        transfer = { ...requestedAlternative, alternatives: transfer.alternatives }
      }
    }

    if (!transfer || transfer.direct) {
      throw new ValidationError('Trip does not require a transfer')
    }

    let arrivalAtTransfer: number
    if (transferArrivalMin !== undefined) {
      arrivalAtTransfer = transferArrivalMin + walkTime
    } else {
      const leg1TravelTime = transfer.leg1Time || calculateRouteTravelTime(
        from,
        transfer.fromPlatform,
        transfer.fromLine!
      )
      arrivalAtTransfer = departureMin + leg1TravelTime + walkTime
    }

    const terminusSecond = getAllTerminiForStation(toStation, transfer.toPlatform, to)
    const terminusFirst = getAllTerminiForStation(fromStation, from, transfer.fromPlatform)

    const [transferPreds, destPreds, gtfsEntities] = await Promise.all([
      deps.fetchStationPredictions(transfer.toPlatform, apiKey),
      deps.fetchStationPredictions(to, apiKey),
      deps.fetchGTFSTripUpdates(apiKey)
    ])

    const staticTrips = getStaticTrips()
    const leg2AllowedLines = getInterlinesForLeg2(transfer.toPlatform, toStation)
      || (transfer.toLine ? [transfer.toLine] : undefined)

    const apiFiltered = deps.filterApiResponse(transferPreds, terminusSecond, leg2AllowedLines)
    const gtfsTrains = deps.parseUpdatesToTrains(
      gtfsEntities,
      transfer.toPlatform,
      terminusSecond,
      staticTrips,
      leg2AllowedLines
    )

    const scheduledTrains = getScheduledTrains(transfer.toPlatform, terminusSecond, 35)
    const mergedTrains = mergeTrainData({
      apiTrains: apiFiltered,
      gtfsTrains,
      scheduledTrains
    })

    const leg2TravelTimeFallback = transfer.leg2Time || calculateRouteTravelTime(
      transfer.toPlatform,
      to,
      transfer.toLine!
    )

    const trainsWithArrival = await deps.fetchDestinationArrivals(
      mergedTrains,
      to,
      apiKey,
      gtfsEntities,
      destPreds,
      leg2TravelTimeFallback
    )

    const CATCH_THRESHOLD = -3
    const trainsWithCatchability: CatchableTrain[] = trainsWithArrival.map(train => {
      const trainArrival = getTrainMinutes(train.Min)
      const waitTime = trainArrival - arrivalAtTransfer

      const totalJourneyTime = train._destArrivalMin !== undefined
        ? train._destArrivalMin
        : trainArrival + leg2TravelTimeFallback
      const arrivalClockTime = train._destArrivalTime || minutesToClockTime(totalJourneyTime)

      return {
        ...train,
        _waitTime: waitTime,
        _canCatch: waitTime >= CATCH_THRESHOLD,
        _totalTime: totalJourneyTime,
        _arrivalClock: arrivalClockTime
      }
    })

    const catchableTrains = trainsWithCatchability.filter(train => train._canCatch)

    let sortedTrains: CatchableTrain[] = catchableTrains.sort((a, b) => {
      const aIsLive = !a._scheduled
      const bIsLive = !b._scheduled
      if (aIsLive !== bIsLive) return aIsLive ? -1 : 1
      if (a._canCatch !== b._canCatch) return a._canCatch ? -1 : 1
      return getTrainMinutes(a.Min) - getTrainMinutes(b.Min)
    })

    if (includeDeparted && transfer.toLine) {
      const leg2TravelTime = transfer.leg2Time || calculateRouteTravelTime(
        transfer.toPlatform,
        to,
        transfer.toLine
      )
      const departedTrains = deps.findDepartedTrains(
        to,
        transfer.toLine,
        leg2TravelTime,
        gtfsEntities,
        staticTrips,
        terminusSecond
      )
      const existingTripIds = new Set(sortedTrains.map(t => t._tripId).filter(Boolean))
      const uniqueDeparted = departedTrains.filter(t => !t._tripId || !existingTripIds.has(t._tripId))
      const departedCatchable: CatchableTrain[] = uniqueDeparted.map(train => ({
        ...train,
        _waitTime: 0,
        _canCatch: true,
        _totalTime: train._destArrivalMin ?? 0,
        _arrivalClock: train._destArrivalTime || '',
      }))
      sortedTrains = [...sortedTrains, ...departedCatchable]
    }

    const carPositions = getTransferCarPosition(
      transfer.fromPlatform,
      transfer.fromLine!,
      transfer.toLine!,
      getTerminusString(terminusFirst),
      to,
      getTerminusString(terminusSecond),
      accessible
    )

    return {
      trains: sortedTrains,
      arrivalAtTransfer,
      arrivalTime: minutesToClockTime(arrivalAtTransfer),
      carPosition: carPositions.leg1,
      exitCarPosition: carPositions.leg2,
      leg2TravelTime: leg2TravelTimeFallback,
      meta: {
        fetchedAt: deps.nowIso(),
        transferStation: transfer.name
      }
    }
  }

  return {
    planTrip,
    planLeg2
  }
}
