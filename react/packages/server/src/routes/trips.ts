import { Router, Request, Response } from 'express'
import { z } from 'zod'
import type { Train, CatchableTrain } from '@transferhero/shared'
import { getTrainMinutes } from '@transferhero/shared'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'
import { getCarPosition } from '../data/carPositions.js'
import { getStaticTrips } from '../data/staticTrips.js'
import { getScheduledTrains } from '../data/scheduleData.js'
import { findTransfer, getAllTerminiForStation } from '../services/pathfinding.js'
import { calculateRouteTravelTime, getTerminus, minutesToClockTime } from '../services/travelTime.js'
import { mergeTrainData, sortTrains } from '../services/trainMerger.js'
import {
  fetchStationPredictions,
  fetchGTFSTripUpdates,
  parseUpdatesToTrains,
  filterApiResponse
} from '../services/wmata.js'
import { cacheMiddleware, CACHE_CONFIG } from '../middleware/cache.js'
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js'

const router = Router()

// Request validation schemas
const tripQuerySchema = z.object({
  from: z.string().min(2).max(4),
  to: z.string().min(2).max(4),
  walkTime: z.coerce.number().min(1).max(15).default(3)
})

const leg2QuerySchema = z.object({
  departureMin: z.coerce.number().min(0).max(60),
  walkTime: z.coerce.number().min(1).max(15).default(3)
})

// Get API key from environment
function getApiKey(): string {
  const key = process.env.WMATA_API_KEY
  if (!key) {
    throw new Error('WMATA_API_KEY not configured')
  }
  return key
}

/**
 * GET /api/trips
 * Returns complete trip plan with trains
 */
router.get('/', cacheMiddleware(CACHE_CONFIG.tripPlan), asyncHandler(async (req: Request, res: Response) => {
  // Validate request
  const result = tripQuerySchema.safeParse(req.query)
  if (!result.success) {
    throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '))
  }

  const { from, to, walkTime } = result.data
  const apiKey = getApiKey()

  // Find stations
  const fromStation = findStationByCode(from)
  const toStation = findStationByCode(to)

  if (!fromStation) {
    throw new NotFoundError(`Origin station not found: ${from}`)
  }
  if (!toStation) {
    throw new NotFoundError(`Destination station not found: ${to}`)
  }

  // Find transfer
  const transfer = findTransfer(from, to, walkTime)

  if (!transfer) {
    throw new NotFoundError('No route found between stations')
  }

  // Handle direct route
  if (transfer.direct) {
    const terminus = getTerminus(transfer.line!, from, to)

    // Fetch trains
    const [apiTrains, gtfsEntities] = await Promise.all([
      fetchStationPredictions(from, apiKey),
      fetchGTFSTripUpdates(apiKey)
    ])

    const apiFiltered = filterApiResponse(apiTrains, terminus)
    const staticTrips = getStaticTrips()
    const gtfsTrains = parseUpdatesToTrains(gtfsEntities, from, terminus, staticTrips)
    const scheduledTrains = getScheduledTrains(from, terminus, 15)

    const mergedTrains = mergeTrainData({
      apiTrains: apiFiltered,
      gtfsTrains: gtfsTrains,
      scheduledTrains: scheduledTrains
    })

    const sortedTrains = sortTrains(mergedTrains)

    return res.json({
      trip: {
        origin: fromStation,
        destination: toStation,
        isDirect: true,
        transfer: null,
        alternatives: [],
        leg1: {
          trains: sortedTrains,
          carPosition: null
        }
      },
      meta: {
        fetchedAt: new Date().toISOString(),
        sources: ['api', 'gtfs', 'schedule']
      }
    })
  }

  // Handle transfer route
  const terminusFirst = getAllTerminiForStation(
    fromStation,
    from,
    transfer.fromPlatform || 'C01'
  )
  const terminusSecond = getAllTerminiForStation(
    toStation,
    transfer.toPlatform || 'A01',
    to
  )

  // Fetch leg 1 and leg 2 trains in parallel
  const [leg1ApiTrains, leg2ApiTrains, gtfsEntities] = await Promise.all([
    fetchStationPredictions(from, apiKey),
    fetchStationPredictions(transfer.toPlatform, apiKey),
    fetchGTFSTripUpdates(apiKey)
  ])

  // Process leg 1 trains
  const staticTrips = getStaticTrips()
  const leg1ApiFiltered = filterApiResponse(leg1ApiTrains, terminusFirst)
  const leg1GtfsTrains = parseUpdatesToTrains(gtfsEntities, from, terminusFirst, staticTrips)
  const leg1ScheduledTrains = getScheduledTrains(from, terminusFirst, 15)
  const leg1MergedTrains = mergeTrainData({
    apiTrains: leg1ApiFiltered,
    gtfsTrains: leg1GtfsTrains,
    scheduledTrains: leg1ScheduledTrains
  })
  const sortedTrains = sortTrains(leg1MergedTrains)

  // Process leg 2 trains
  const leg2ApiFiltered = filterApiResponse(leg2ApiTrains, terminusSecond)
  const leg2GtfsTrains = parseUpdatesToTrains(gtfsEntities, transfer.toPlatform, terminusSecond, staticTrips)
  const leg2ScheduledTrains = getScheduledTrains(transfer.toPlatform, terminusSecond, 15)
  const leg2MergedTrains = mergeTrainData({
    apiTrains: leg2ApiFiltered,
    gtfsTrains: leg2GtfsTrains,
    scheduledTrains: leg2ScheduledTrains
  })
  const leg2SortedTrains = sortTrains(leg2MergedTrains)

  // Get car position for transfer
  const carPosition = getCarPosition(transfer.fromPlatform, transfer.toPlatform)

  // Calculate travel times
  const leg1TravelTime = transfer.leg1Time || calculateRouteTravelTime(
    from,
    transfer.fromPlatform,
    transfer.fromLine!
  )
  const leg2TravelTime = transfer.leg2Time || calculateRouteTravelTime(
    transfer.toPlatform,
    to,
    transfer.toLine!
  )

  res.json({
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
        alternatives: transfer.alternatives || []
      },
      leg1: {
        trains: sortedTrains,
        carPosition: carPosition,
        terminus: terminusFirst,
        travelTime: leg1TravelTime
      },
      leg2: {
        trains: leg2SortedTrains,
        terminus: terminusSecond,
        travelTime: leg2TravelTime,
        carPosition: getCarPosition(transfer.toPlatform, to)
      }
    },
    meta: {
      fetchedAt: new Date().toISOString(),
      sources: ['api', 'gtfs', 'schedule'],
      walkTime: walkTime
    }
  })
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

  const { departureMin, walkTime } = result.data
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

  // Find transfer
  const transfer = findTransfer(from, to, walkTime)
  if (!transfer || transfer.direct) {
    throw new ValidationError('This trip does not require a transfer')
  }

  // Calculate when user arrives at transfer station
  const leg1TravelTime = transfer.leg1Time || calculateRouteTravelTime(
    from,
    transfer.fromPlatform,
    transfer.fromLine!
  )
  const arrivalAtTransfer = departureMin + leg1TravelTime + walkTime

  // Get terminus for leg 2
  const terminusSecond = getAllTerminiForStation(
    toStation,
    transfer.toPlatform,
    to
  )

  // Fetch leg 2 trains from transfer station
  const [apiTrains, gtfsEntities] = await Promise.all([
    fetchStationPredictions(transfer.toPlatform, apiKey),
    fetchGTFSTripUpdates(apiKey)
  ])

  const staticTrips = getStaticTrips()
  const apiFiltered = filterApiResponse(apiTrains, terminusSecond)
  const gtfsTrains = parseUpdatesToTrains(gtfsEntities, transfer.toPlatform, terminusSecond, staticTrips)
  const scheduledTrains = getScheduledTrains(transfer.toPlatform, terminusSecond, 15)

  const mergedTrains = mergeTrainData({
    apiTrains: apiFiltered,
    gtfsTrains: gtfsTrains,
    scheduledTrains: scheduledTrains
  })

  // Calculate leg 2 travel time
  const leg2TravelTime = transfer.leg2Time || calculateRouteTravelTime(
    transfer.toPlatform,
    to,
    transfer.toLine!
  )

  // Calculate catchability for each train
  const CATCH_THRESHOLD = -3  // Can catch trains up to 3 mins before arrival (might run)
  const trainsWithCatchability: CatchableTrain[] = mergedTrains.map(train => {
    const trainArrival = getTrainMinutes(train.Min)
    const waitTime = trainArrival - arrivalAtTransfer
    const totalJourneyTime = trainArrival + leg2TravelTime
    const arrivalClockTime = minutesToClockTime(totalJourneyTime)

    return {
      ...train,
      _waitTime: waitTime,
      _canCatch: waitTime >= CATCH_THRESHOLD,
      _totalTime: totalJourneyTime,
      _arrivalClock: arrivalClockTime
    }
  })

  // Filter to only catchable trains
  const catchableTrains = trainsWithCatchability.filter(t => t._canCatch)

  // Sort: live trains first, then by arrival time
  const sortedTrains = catchableTrains.sort((a, b) => {
    const aIsLive = !a._scheduled
    const bIsLive = !b._scheduled
    if (aIsLive !== bIsLive) return aIsLive ? -1 : 1
    if (a._canCatch !== b._canCatch) return a._canCatch ? -1 : 1
    return getTrainMinutes(a.Min) - getTrainMinutes(b.Min)
  })

  // Get car position for exiting
  const carPosition = getCarPosition(transfer.fromPlatform, transfer.toPlatform)

  res.json({
    trains: sortedTrains,
    arrivalAtTransfer: arrivalAtTransfer,
    arrivalTime: minutesToClockTime(arrivalAtTransfer),
    carPosition: carPosition,
    leg2TravelTime: leg2TravelTime,
    meta: {
      fetchedAt: new Date().toISOString(),
      transferStation: transfer.name
    }
  })
}))

export default router
