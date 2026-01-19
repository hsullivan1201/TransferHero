import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { Train, CatchableTrain, Line } from '@transferhero/shared'
import { getTrainMinutes } from '@transferhero/shared'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'
import { getStaticTrips } from '../data/staticTrips.js'
import { findTransfer, getAllTerminiForStation } from '../services/pathfinding.js'
import { calculateRouteTravelTime, getTerminus, minutesToClockTime } from '../services/travelTime.js'
import { mergeTrainData, sortTrains } from '../services/trainMerger.js'
import {
  fetchStationPredictions,
  fetchGTFSTripUpdates,
  parseUpdatesToTrains,
  filterApiResponse,
  fetchDestinationArrivals,
  findDepartedTrains
} from '../services/wmata.js'
import { cacheMiddleware, CACHE_CONFIG } from '../middleware/cache.js'
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js'

// car position service with the real exit intel
import {
  getTransferCarPosition,
  getDirectTripCarPosition,
  type CarPosition
} from '../data/carPositionService.js'
import { PLATFORM_CODES, normalizePlatformCode, getPlatformForLine } from '../data/platformCodes.js'
import { LINE_STATIONS } from '../data/lineConfig.js'

/**
 * get all lines that serve the origin and can reach the transfer platform.
 * interlined origins (like OR/SV at new carrollton) get the full menu.
 */
function getInterlinesForLeg1(fromStation: { lines: Line[] }, fromPlatform: string): Line[] | undefined {
  // lines that hit the origin and also include the transfer platform
  const validLines = fromStation.lines.filter(line => {
    const stationsOnLine = LINE_STATIONS[line]
    if (!stationsOnLine) return false
    const normalizedPlatform = normalizePlatformCode(fromPlatform, stationsOnLine)
    return stationsOnLine.includes(normalizedPlatform)
  })

  return validLines.length > 0 ? validLines : undefined
}

/**
 * get all lines that share a transfer platform and still serve the destination.
 * interlined segments (OR/SV/BL at metro center, etc.) get the full list.
 */
function getInterlinesForLeg2(toPlatform: string, toStation: { lines: Line[] }): Line[] | undefined {
  const platformConfig = PLATFORM_CODES[toPlatform]
  if (!platformConfig) return undefined

  // Get all lines that use this specific platform
  const linesOnPlatform = Object.entries(platformConfig)
    .filter(([_, code]) => code === toPlatform)
    .map(([line]) => line as Line)

  if (linesOnPlatform.length === 0) return undefined

  // Intersect with destination station lines
  const validLines = linesOnPlatform.filter(line => toStation.lines.includes(line))
  return validLines.length > 0 ? validLines : undefined
}

const router = Router()

// request validation schemas
// boolean helper because z.coerce.boolean thinks "false" is true (rude)
const booleanFromString = z.preprocess(
  (val) => val === 'true' || val === true,
  z.boolean().default(false)
)

const tripQuerySchema = z.object({
  from: z.string().min(2).max(4),
  to: z.string().min(2).max(4),
  walkTime: z.coerce.number().min(1).max(15).default(3),
  transferStation: z.string().optional(), // pick a specific transfer if you fancy
  accessible: booleanFromString, // true = favor elevators
  includeDeparted: booleanFromString // true = also show trains that already bailed
})

const leg2QuerySchema = z.object({
  // allow negative numbers (e.g. -120) for already-departed trains
  departureMin: z.coerce.number().min(-120).max(120),
  walkTime: z.coerce.number().min(1).max(15).default(3),
  transferStation: z.string().optional(),
  // realtime arrival at transfer station (if WMATA/GTFS-RT feels helpful)
  transferArrivalMin: z.coerce.number().optional(),
  accessible: booleanFromString // true = elevator life
})

// pull WMATA api key from env
function getApiKey(): string {
  const key = process.env.WMATA_API_KEY
  if (!key) {
    throw new Error('WMATA_API_KEY not configured')
  }
  return key
}

/**
 * get a single terminus string from an array—car position service wants one value
 */
function getTerminusString(terminus: string | string[]): string {
  if (Array.isArray(terminus)) {
    return terminus[0] || ''
  }
  return terminus
}

/**
 * GET /api/trips
 * returns a full trip plan with trains
 */
router.get('/', cacheMiddleware(CACHE_CONFIG.tripPlan), asyncHandler(async (req: Request, res: Response) => {
  // validate request
  const result = tripQuerySchema.safeParse(req.query)
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '))
  }

  const { from, to, walkTime, transferStation, accessible, includeDeparted } = result.data
  const apiKey = getApiKey()

  // find stations
  const fromStation = findStationByCode(from)
  const toStation = findStationByCode(to)

  if (!fromStation) {
    throw new NotFoundError(`Origin station not found: ${from}`)
  }
  if (!toStation) {
    throw new NotFoundError(`Destination station not found: ${to}`)
  }

  // log the trip request for debugging
  console.log(`[Trip] Request: ${fromStation.name} → ${toStation.name} | walkTime=${walkTime}min${transferStation ? ` | transfer=${transferStation}` : ''}${accessible ? ' | accessible' : ''}${includeDeparted ? ' | includeDeparted' : ''}`)

  // find transfer (grab default first so we know the alternatives)
  let transfer = findTransfer(from, to, walkTime)
  let defaultTransferName: string | undefined

  // if a specific transfer was requested, swap it in
  if (transferStation && transfer && !transfer.direct && transfer.alternatives) {
    const requestedAlternative = transfer.alternatives.find(alt => alt.station === transferStation)
    if (requestedAlternative) {
      // Save the default name before swapping
      defaultTransferName = transfer.name
      // Use the requested alternative, but keep the alternatives list from the original
      const alternatives = transfer.alternatives
      transfer = { ...requestedAlternative, alternatives }
    }
  }

  if (!transfer) {
    throw new NotFoundError('No route found between stations')
  }

  // handle direct route
  if (transfer.direct) {
    // Get all shared lines between origin and destination
    const sharedLines = fromStation.lines.filter((l: Line) => toStation.lines.includes(l))

    // Collect termini from ALL shared lines (not just the first)
    const allTermini: string[] = []
    for (const line of sharedLines) {
      const lineTermini = getTerminus(line, from, to)
      allTermini.push(...lineTermini)
    }
    // Dedupe termini
    const terminus = [...new Set(allTermini)]

    // Get all unique platform codes needed for origin (multi-platform stations like Metro Center)
    const originPlatforms = [...new Set(sharedLines.map(line => getPlatformForLine(from, line)))]

    // batch fetch: origin predictions from ALL relevant platforms, destination predictions, and GTFS-RT
    const [originPredArrays, destPreds, gtfsEntities] = await Promise.all([
      Promise.all(originPlatforms.map(platform => fetchStationPredictions(platform, apiKey))),
      fetchStationPredictions(to, apiKey),
      fetchGTFSTripUpdates(apiKey)
    ])
    // Flatten and dedupe origin predictions from all platforms
    const originPreds = originPredArrays.flat()

    const apiFiltered = filterApiResponse(originPreds, terminus)
    const staticTrips = getStaticTrips()
    // Parse GTFS-RT trains from all relevant platforms (e.g., B01 AND F01 for Gallery Place)
    const gtfsTrainArrays = originPlatforms.map(platform =>
      parseUpdatesToTrains(gtfsEntities, platform, terminus, staticTrips)
    )
    const gtfsTrains = gtfsTrainArrays.flat()

    const mergedTrains = mergeTrainData({
      apiTrains: apiFiltered,
      gtfsTrains: gtfsTrains
    })

    // add realtime destination arrivals (using prefetched destPreds to avoid another call)
    const trainsWithArrival = await fetchDestinationArrivals(
      mergedTrains,
      to,
      apiKey,
      gtfsEntities,
      destPreds  // Prefetched predictions
    )

    let sortedTrains = sortTrains(trainsWithArrival)

    // optionally include trains that already left (check all shared lines)
    if (includeDeparted && sharedLines.length > 0) {
      const allDepartedTrains: Train[] = []
      for (const line of sharedLines) {
        const directTravelTime = calculateRouteTravelTime(from, to, line)
        const lineTermini = getTerminus(line, from, to)
        const departedTrains = findDepartedTrains(
          from,
          to,
          line,
          directTravelTime,
          gtfsEntities,
          staticTrips,
          lineTermini
        )
        allDepartedTrains.push(...departedTrains)
      }
      // dedupe departed trains against what's already in sortedTrains
      const existingTripIds = new Set(sortedTrains.map(t => t._tripId).filter(Boolean))
      const uniqueDeparted = allDepartedTrains.filter(t => !t._tripId || !existingTripIds.has(t._tripId))
      // departed trains sit at the end—they already left the party
      sortedTrains = [...sortedTrains, ...uniqueDeparted]
    }

    // grab car position for the direct trip exit
    const directCarPosition = getDirectTripCarPosition(
      to,                           // destination station code
      transfer.line!,               // line (RD, OR, etc.)
      getTerminusString(terminus),  // train terminus for track direction
      accessible                    // accessibility mode
    )

    return res.json({
      trip: {
        origin: fromStation,
        destination: toStation,
        isDirect: true,
        transfer: null,
        alternatives: [],
        leg1: {
          trains: sortedTrains,
          carPosition: directCarPosition  // real car position for exit
        }
      },
      meta: {
        fetchedAt: new Date().toISOString(),
        sources: ['api', 'gtfs-rt']
      }
    })
  }

  const yellowStations = LINE_STATIONS['YL'] || []
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
    currentTransfer: typeof transfer,
    options: { allowYellowFallback?: boolean, branchWarning?: string, defaultTransferName?: string } = {}
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

    // Compute leg1 allowed lines BEFORE fetch so we know which platforms to query
    const leg1AllowedLines = getInterlinesForLeg1(fromStation, currentTransfer.fromPlatform)
      || (currentTransfer.fromLine ? [currentTransfer.fromLine] : undefined)

    // Get all origin platforms for the allowed lines (handles multi-platform stations like Gallery Place)
    const leg1OriginPlatforms = leg1AllowedLines
      ? [...new Set(leg1AllowedLines.map(line => getPlatformForLine(from, line)))]
      : [from]

    // batch fetch all station predictions + GTFS-RT
    const [originPredArrays, transferPreds, destPreds, gtfsEntities] = await Promise.all([
      Promise.all(leg1OriginPlatforms.map(platform => fetchStationPredictions(platform, apiKey))),
      fetchStationPredictions(currentTransfer.toPlatform, apiKey),
      fetchStationPredictions(to, apiKey),
      fetchGTFSTripUpdates(apiKey)
    ])
    const originPreds = originPredArrays.flat()

    const staticTrips = getStaticTrips()
    const leg1ApiFiltered = filterApiResponse(originPreds, terminusFirst, leg1AllowedLines)
    // Parse GTFS-RT from all origin platforms
    const leg1GtfsTrainArrays = leg1OriginPlatforms.map(platform =>
      parseUpdatesToTrains(gtfsEntities, platform, terminusFirst, staticTrips, leg1AllowedLines)
    )
    const leg1GtfsTrains = leg1GtfsTrainArrays.flat()
    const leg1MergedTrains = mergeTrainData({
      apiTrains: leg1ApiFiltered,
      gtfsTrains: leg1GtfsTrains
    })

    // reuse transferPreds so we don't refetch
    const leg1WithTransferArrival = await fetchDestinationArrivals(
      leg1MergedTrains,
      currentTransfer.fromPlatform,
      apiKey,
      gtfsEntities,
      transferPreds  // Prefetched transfer station predictions
    )

    const leg1WithBothArrivals = leg1WithTransferArrival.map(train => ({
      ...train,
      _transferArrivalMin: train._destArrivalMin,
      _transferArrivalTime: train._destArrivalTime,
      _transferArrivalTimestamp: train._destArrivalTimestamp
    }))

    // reuse destPreds so we don't refetch
    const leg1WithArrival = await fetchDestinationArrivals(
      leg1WithBothArrivals,
      to,
      apiKey,
      gtfsEntities,
      destPreds  // Prefetched destination predictions
    )
    let sortedTrains = sortTrains(leg1WithArrival)

    if (includeDeparted && currentTransfer.fromLine) {
      const leg1TravelTime = currentTransfer.leg1Time || calculateRouteTravelTime(
        from,
        currentTransfer.fromPlatform,
        currentTransfer.fromLine
      )
      const departedTrains = findDepartedTrains(
        from,
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
    const leg2ApiFiltered = filterApiResponse(transferPreds, terminusSecond, leg2AllowedLines)
    const leg2GtfsTrains = parseUpdatesToTrains(gtfsEntities, currentTransfer.toPlatform, terminusSecond, staticTrips, leg2AllowedLines)
    const leg2MergedTrains = mergeTrainData({
      apiTrains: leg2ApiFiltered,
      gtfsTrains: leg2GtfsTrains
    })

    // reuse destPreds so we don't refetch
    const leg2WithArrival = await fetchDestinationArrivals(
      leg2MergedTrains,
      to,
      apiKey,
      gtfsEntities,
      destPreds  // Prefetched destination predictions
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
      currentTransfer.fromPlatform,                  // transfer station (incoming platform)
      currentTransfer.fromLine!,                     // incoming line (e.g., 'RD')
      currentTransfer.toLine!,                       // outgoing line (e.g., 'BL')
      getTerminusString(terminusFirst),              // incoming train destination
      to,                                            // final destination station code
      getTerminusString(terminusSecond),             // outgoing train destination
      accessible                                     // accessibility mode
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
          defaultTransferName: optDefaultName
        },
        leg1: {
          trains: sortedTrains,
            carPosition: carPositions.leg1,  // real car position for transfer
          terminus: terminusFirst,
          travelTime: leg1TravelTime
        },
        leg2: {
          trains: leg2SortedTrains,
          terminus: terminusSecond,
          travelTime: leg2TravelTime,
            carPosition: carPositions.leg2   // real car position for exit
        }
      },
      meta: {
        fetchedAt: new Date().toISOString(),
        sources: ['api', 'gtfs-rt'],
        walkTime: walkTime,
        branchWarning: branchWarningToUse
      }
    }
  }

  const transferTrip = await buildTransferTrip(transfer, { allowYellowFallback: true, defaultTransferName })
  res.json(transferTrip)
}))

/**
 * GET /api/trips/:tripId/leg2
 * Fetch catchable leg 2 trains based on selected leg 1 train
 */
router.get('/:tripId/leg2', asyncHandler(async (req: Request, res: Response) => {
  // Validate request
  const result = leg2QuerySchema.safeParse(req.query)
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '))
  }

  const { departureMin, walkTime, transferStation, transferArrivalMin, accessible } = result.data
  const tripId = req.params.tripId
  const apiKey = getApiKey()

  // Parse tripId (format: fromCode-toCode)
  const [from, to] = tripId.split('-')
  if (!from || !to) {
    throw new ValidationError('Invalid trip ID format. Expected: fromCode-toCode')
  }

  const fromStation = findStationByCode(from)
  const toStation = findStationByCode(to)

  if (!fromStation || !toStation) {
    throw new NotFoundError('Station not found')
  }

  // log the leg2 request for debugging
  console.log(`[Trip] Leg2 Request: ${fromStation.name} → ${toStation.name} | departureMin=${departureMin} | walkTime=${walkTime}min${transferStation ? ` | transfer=${transferStation}` : ''}${transferArrivalMin !== undefined ? ` | transferArrival=${transferArrivalMin}min` : ''}${accessible ? ' | accessible' : ''}`)

  // Find transfer
  let transfer = findTransfer(from, to, walkTime)

  // If a specific transfer station was requested, use that alternative instead
  if (transferStation && transfer && !transfer.direct && transfer.alternatives) {
    const requestedAlternative = transfer.alternatives.find(alt => alt.station === transferStation)
    if (requestedAlternative) {
      transfer = { ...requestedAlternative, alternatives: transfer.alternatives }
    }
  }

  if (!transfer || transfer.direct) {
    throw new ValidationError('This trip does not require a transfer')
  }

  // figure out when the rider reaches the transfer station
  // prefer realtime arrival, otherwise fall back to math
  let arrivalAtTransfer: number
  if (transferArrivalMin !== undefined) {
    // realtime arrival at transfer + walk time to the other platform
    arrivalAtTransfer = transferArrivalMin + walkTime
  } else {
    // fallback: use static travel times
    const leg1TravelTime = transfer.leg1Time || calculateRouteTravelTime(
      from,
      transfer.fromPlatform,
      transfer.fromLine!
    )
    arrivalAtTransfer = departureMin + leg1TravelTime + walkTime
  }

  // grab terminus for leg 2
  const terminusSecond = getAllTerminiForStation(
    toStation,
    transfer.toPlatform,
    to
  )

  // grab terminus for leg 1 (needed for car position calc)
  const terminusFirst = getAllTerminiForStation(
    fromStation,
    from,
    transfer.fromPlatform
  )

  // batch fetch: transfer platform, destination, and GTFS-RT
  const [transferPreds, destPreds, gtfsEntities] = await Promise.all([
    fetchStationPredictions(transfer.toPlatform, apiKey),
    fetchStationPredictions(to, apiKey),
    fetchGTFSTripUpdates(apiKey)
  ])

  // include all interlined trains (OR/SV/BL share track)
  const staticTrips = getStaticTrips()
  const leg2AllowedLines = getInterlinesForLeg2(transfer.toPlatform, toStation)
    || (transfer.toLine ? [transfer.toLine] : undefined)
  const apiFiltered = filterApiResponse(transferPreds, terminusSecond, leg2AllowedLines)
  const gtfsTrains = parseUpdatesToTrains(gtfsEntities, transfer.toPlatform, terminusSecond, staticTrips, leg2AllowedLines)

  const mergedTrains = mergeTrainData({
    apiTrains: apiFiltered,
    gtfsTrains: gtfsTrains
  })

  // add realtime arrival at the final destination (reusing destPreds)
  const trainsWithArrival = await fetchDestinationArrivals(
    mergedTrains,
    to,
    apiKey,
    gtfsEntities,
    destPreds  // Prefetched destination predictions
  )

  // leg 2 travel time fallback for trains without realtime data
  const leg2TravelTimeFallback = transfer.leg2Time || calculateRouteTravelTime(
    transfer.toPlatform,
    to,
    transfer.toLine!
  )

  // calculate catchability for each train
  const CATCH_THRESHOLD = -3  // can catch trains up to 3 min before arrival (might require a jog)
  const trainsWithCatchability: CatchableTrain[] = trainsWithArrival.map(train => {
    const trainArrival = getTrainMinutes(train.Min)
    const waitTime = trainArrival - arrivalAtTransfer

    // prefer realtime destination arrival, otherwise fall back to calculated
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

  // filter to only the trains you can actually catch
  const catchableTrains = trainsWithCatchability.filter(t => t._canCatch)

  // sort: live trains first, then by arrival time
  const sortedTrains = catchableTrains.sort((a, b) => {
    const aIsLive = !a._scheduled
    const bIsLive = !b._scheduled
    if (aIsLive !== bIsLive) return aIsLive ? -1 : 1
    if (a._canCatch !== b._canCatch) return a._canCatch ? -1 : 1
    return getTrainMinutes(a.Min) - getTrainMinutes(b.Min)
  })

  // grab car positions using real exit data
  const carPositions = getTransferCarPosition(
    transfer.fromPlatform,                  // transfer station (incoming platform)
    transfer.fromLine!,                     // incoming line
    transfer.toLine!,                       // outgoing line
    getTerminusString(terminusFirst),       // incoming train destination
    to,                                     // final destination station code
    getTerminusString(terminusSecond),      // outgoing train destination
    accessible                              // accessibility mode
  )

  res.json({
    trains: sortedTrains,
    arrivalAtTransfer: arrivalAtTransfer,
    arrivalTime: minutesToClockTime(arrivalAtTransfer),
    carPosition: carPositions.leg1,     // for boarding at origin
    exitCarPosition: carPositions.leg2, // for exiting at destination
    leg2TravelTime: leg2TravelTimeFallback,
    meta: {
      fetchedAt: new Date().toISOString(),
      transferStation: transfer.name
    }
  })
}))

export default router
