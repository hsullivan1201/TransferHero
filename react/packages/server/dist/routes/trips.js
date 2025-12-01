import { Router } from 'express';
import { z } from 'zod';
import { getTrainMinutes } from '@transferhero/shared';
import { findStationByCode } from '../data/stations.js';
import { getStaticTrips } from '../data/staticTrips.js';
import { findTransfer, getAllTerminiForStation } from '../services/pathfinding.js';
import { calculateRouteTravelTime, getTerminus, minutesToClockTime } from '../services/travelTime.js';
import { mergeTrainData, sortTrains } from '../services/trainMerger.js';
import { fetchStationPredictions, fetchGTFSTripUpdates, parseUpdatesToTrains, filterApiResponse } from '../services/wmata.js';
import { cacheMiddleware, CACHE_CONFIG } from '../middleware/cache.js';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
// NEW: Import the car position service with real exit data
import { getTransferCarPosition, getDirectTripCarPosition } from '../data/carPositionService.js';
const router = Router();
// Request validation schemas
const tripQuerySchema = z.object({
    from: z.string().min(2).max(4),
    to: z.string().min(2).max(4),
    walkTime: z.coerce.number().min(1).max(15).default(3),
    transferStation: z.string().optional() // Allow specifying which transfer to use
});
const leg2QuerySchema = z.object({
    departureMin: z.coerce.number().min(0).max(60),
    walkTime: z.coerce.number().min(1).max(15).default(3)
});
// Get API key from environment
function getApiKey() {
    const key = process.env.WMATA_API_KEY;
    if (!key) {
        throw new Error('WMATA_API_KEY not configured');
    }
    return key;
}
/**
 * Helper to get terminus string from terminus array
 * The car position service needs a single destination string for track direction
 */
function getTerminusString(terminus) {
    if (Array.isArray(terminus)) {
        return terminus[0] || '';
    }
    return terminus;
}
/**
 * GET /api/trips
 * Returns complete trip plan with trains
 */
router.get('/', cacheMiddleware(CACHE_CONFIG.tripPlan), asyncHandler(async (req, res) => {
    // Validate request
    const result = tripQuerySchema.safeParse(req.query);
    if (!result.success) {
        throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
    }
    const { from, to, walkTime, transferStation } = result.data;
    const apiKey = getApiKey();
    // Find stations
    const fromStation = findStationByCode(from);
    const toStation = findStationByCode(to);
    if (!fromStation) {
        throw new NotFoundError(`Origin station not found: ${from}`);
    }
    if (!toStation) {
        throw new NotFoundError(`Destination station not found: ${to}`);
    }
    // Find transfer (first get default to access alternatives)
    let transfer = findTransfer(from, to, walkTime);
    // If a specific transfer station was requested, use that alternative instead
    if (transferStation && transfer && !transfer.direct && transfer.alternatives) {
        const requestedAlternative = transfer.alternatives.find(alt => alt.station === transferStation);
        if (requestedAlternative) {
            // Use the requested alternative, but keep the alternatives list from the original
            const alternatives = transfer.alternatives;
            transfer = { ...requestedAlternative, alternatives };
        }
    }
    if (!transfer) {
        throw new NotFoundError('No route found between stations');
    }
    // Handle direct route
    if (transfer.direct) {
        const terminus = getTerminus(transfer.line, from, to);
        // Fetch trains
        const [apiTrains, gtfsEntities] = await Promise.all([
            fetchStationPredictions(from, apiKey),
            fetchGTFSTripUpdates(apiKey)
        ]);
        const apiFiltered = filterApiResponse(apiTrains, terminus);
        const staticTrips = getStaticTrips();
        const gtfsTrains = parseUpdatesToTrains(gtfsEntities, from, terminus, staticTrips);
        const mergedTrains = mergeTrainData({
            apiTrains: apiFiltered,
            gtfsTrains: gtfsTrains
        });
        const sortedTrains = sortTrains(mergedTrains);
        // NEW: Get car position for direct trip exit
        const directCarPosition = getDirectTripCarPosition(to, // destination station code
        transfer.line, // line (RD, OR, etc.)
        getTerminusString(terminus) // train terminus for track direction
        );
        return res.json({
            trip: {
                origin: fromStation,
                destination: toStation,
                isDirect: true,
                transfer: null,
                alternatives: [],
                leg1: {
                    trains: sortedTrains,
                    carPosition: directCarPosition // NEW: Real car position for exit
                }
            },
            meta: {
                fetchedAt: new Date().toISOString(),
                sources: ['api', 'gtfs-rt']
            }
        });
    }
    // Handle transfer route
    const terminusFirst = getAllTerminiForStation(fromStation, from, transfer.fromPlatform || 'C01');
    const terminusSecond = getAllTerminiForStation(toStation, transfer.toPlatform || 'A01', to);
    // Fetch leg 1 and leg 2 trains in parallel
    const [leg1ApiTrains, leg2ApiTrains, gtfsEntities] = await Promise.all([
        fetchStationPredictions(from, apiKey),
        fetchStationPredictions(transfer.toPlatform, apiKey),
        fetchGTFSTripUpdates(apiKey)
    ]);
    // Process leg 1 trains
    const staticTrips = getStaticTrips();
    const leg1ApiFiltered = filterApiResponse(leg1ApiTrains, terminusFirst);
    const leg1GtfsTrains = parseUpdatesToTrains(gtfsEntities, from, terminusFirst, staticTrips);
    const leg1MergedTrains = mergeTrainData({
        apiTrains: leg1ApiFiltered,
        gtfsTrains: leg1GtfsTrains
    });
    const sortedTrains = sortTrains(leg1MergedTrains);
    // Process leg 2 trains
    const leg2ApiFiltered = filterApiResponse(leg2ApiTrains, terminusSecond);
    const leg2GtfsTrains = parseUpdatesToTrains(gtfsEntities, transfer.toPlatform, terminusSecond, staticTrips);
    const leg2MergedTrains = mergeTrainData({
        apiTrains: leg2ApiFiltered,
        gtfsTrains: leg2GtfsTrains
    });
    const leg2SortedTrains = sortTrains(leg2MergedTrains);
    // NEW: Get car positions using real exit data
    const carPositions = getTransferCarPosition(transfer.fromPlatform, // transfer station (incoming platform)
    transfer.fromLine, // incoming line (e.g., 'RD')
    transfer.toLine, // outgoing line (e.g., 'BL')
    getTerminusString(terminusFirst), // incoming train destination
    to, // final destination station code
    getTerminusString(terminusSecond) // outgoing train destination
    );
    // Calculate travel times
    const leg1TravelTime = transfer.leg1Time || calculateRouteTravelTime(from, transfer.fromPlatform, transfer.fromLine);
    const leg2TravelTime = transfer.leg2Time || calculateRouteTravelTime(transfer.toPlatform, to, transfer.toLine);
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
                carPosition: carPositions.leg1, // NEW: Real car position for transfer
                terminus: terminusFirst,
                travelTime: leg1TravelTime
            },
            leg2: {
                trains: leg2SortedTrains,
                terminus: terminusSecond,
                travelTime: leg2TravelTime,
                carPosition: carPositions.leg2 // NEW: Real car position for exit
            }
        },
        meta: {
            fetchedAt: new Date().toISOString(),
            sources: ['api', 'gtfs-rt'],
            walkTime: walkTime
        }
    });
}));
/**
 * GET /api/trips/:tripId/leg2
 * Fetch catchable leg 2 trains based on selected leg 1 train
 */
router.get('/:tripId/leg2', asyncHandler(async (req, res) => {
    // Validate request
    const result = leg2QuerySchema.safeParse(req.query);
    if (!result.success) {
        throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
    }
    const { departureMin, walkTime } = result.data;
    const tripId = req.params.tripId;
    const apiKey = getApiKey();
    // Parse tripId (format: fromCode-toCode)
    const [from, to] = tripId.split('-');
    if (!from || !to) {
        throw new ValidationError('Invalid trip ID format. Expected: fromCode-toCode');
    }
    const fromStation = findStationByCode(from);
    const toStation = findStationByCode(to);
    if (!fromStation || !toStation) {
        throw new NotFoundError('Station not found');
    }
    // Find transfer
    const transfer = findTransfer(from, to, walkTime);
    if (!transfer || transfer.direct) {
        throw new ValidationError('This trip does not require a transfer');
    }
    // Calculate when user arrives at transfer station
    const leg1TravelTime = transfer.leg1Time || calculateRouteTravelTime(from, transfer.fromPlatform, transfer.fromLine);
    const arrivalAtTransfer = departureMin + leg1TravelTime + walkTime;
    // Get terminus for leg 2
    const terminusSecond = getAllTerminiForStation(toStation, transfer.toPlatform, to);
    // Get terminus for leg 1 (needed for car position calculation)
    const terminusFirst = getAllTerminiForStation(fromStation, from, transfer.fromPlatform);
    // Fetch leg 2 trains from transfer station
    const [apiTrains, gtfsEntities] = await Promise.all([
        fetchStationPredictions(transfer.toPlatform, apiKey),
        fetchGTFSTripUpdates(apiKey)
    ]);
    const staticTrips = getStaticTrips();
    const apiFiltered = filterApiResponse(apiTrains, terminusSecond);
    const gtfsTrains = parseUpdatesToTrains(gtfsEntities, transfer.toPlatform, terminusSecond, staticTrips);
    const mergedTrains = mergeTrainData({
        apiTrains: apiFiltered,
        gtfsTrains: gtfsTrains
    });
    // Calculate leg 2 travel time
    const leg2TravelTime = transfer.leg2Time || calculateRouteTravelTime(transfer.toPlatform, to, transfer.toLine);
    // Calculate catchability for each train
    const CATCH_THRESHOLD = -3; // Can catch trains up to 3 mins before arrival (might run)
    const trainsWithCatchability = mergedTrains.map(train => {
        const trainArrival = getTrainMinutes(train.Min);
        const waitTime = trainArrival - arrivalAtTransfer;
        const totalJourneyTime = trainArrival + leg2TravelTime;
        const arrivalClockTime = minutesToClockTime(totalJourneyTime);
        return {
            ...train,
            _waitTime: waitTime,
            _canCatch: waitTime >= CATCH_THRESHOLD,
            _totalTime: totalJourneyTime,
            _arrivalClock: arrivalClockTime
        };
    });
    // Filter to only catchable trains
    const catchableTrains = trainsWithCatchability.filter(t => t._canCatch);
    // Sort: live trains first, then by arrival time
    const sortedTrains = catchableTrains.sort((a, b) => {
        const aIsLive = !a._scheduled;
        const bIsLive = !b._scheduled;
        if (aIsLive !== bIsLive)
            return aIsLive ? -1 : 1;
        if (a._canCatch !== b._canCatch)
            return a._canCatch ? -1 : 1;
        return getTrainMinutes(a.Min) - getTrainMinutes(b.Min);
    });
    // NEW: Get car positions using real exit data
    const carPositions = getTransferCarPosition(transfer.fromPlatform, // transfer station (incoming platform)
    transfer.fromLine, // incoming line
    transfer.toLine, // outgoing line
    getTerminusString(terminusFirst), // incoming train destination
    to, // final destination station code
    getTerminusString(terminusSecond) // outgoing train destination
    );
    res.json({
        trains: sortedTrains,
        arrivalAtTransfer: arrivalAtTransfer,
        arrivalTime: minutesToClockTime(arrivalAtTransfer),
        carPosition: carPositions.leg1, // For boarding at origin
        exitCarPosition: carPositions.leg2, // NEW: For exiting at destination
        leg2TravelTime: leg2TravelTime,
        meta: {
            fetchedAt: new Date().toISOString(),
            transferStation: transfer.name
        }
    });
}));
export default router;
//# sourceMappingURL=trips.js.map