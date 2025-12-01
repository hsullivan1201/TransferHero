import { ensureArray, normalizeDestination } from '@transferhero/shared';
import protobuf from 'protobufjs';
import fetch from 'node-fetch';
// Cached protobuf root
let protoRoot = null;
// GTFS-RT Protobuf schema definition
const GTFS_RT_SCHEMA = {
    nested: {
        transit_realtime: {
            nested: {
                FeedMessage: { fields: { entity: { rule: 'repeated', type: 'FeedEntity', id: 2 } } },
                FeedEntity: { fields: { tripUpdate: { type: 'TripUpdate', id: 3 } } },
                TripUpdate: {
                    fields: {
                        trip: { type: 'TripDescriptor', id: 1 },
                        stopTimeUpdate: { rule: 'repeated', type: 'StopTimeUpdate', id: 2 }
                    }
                },
                TripDescriptor: {
                    fields: {
                        tripId: { type: 'string', id: 1 },
                        routeId: { type: 'string', id: 5 }
                    }
                },
                StopTimeUpdate: {
                    fields: {
                        stopSequence: { type: 'uint32', id: 1 },
                        arrival: { type: 'StopEvent', id: 2 },
                        departure: { type: 'StopEvent', id: 3 },
                        stopId: { type: 'string', id: 4 }
                    }
                },
                StopEvent: { fields: { time: { type: 'int64', id: 2 } } }
            }
        }
    }
};
/**
 * Initialize protobuf schema
 */
async function initProto() {
    if (protoRoot)
        return protoRoot;
    protoRoot = protobuf.Root.fromJSON(GTFS_RT_SCHEMA);
    return protoRoot;
}
/**
 * Fetch station predictions from WMATA API
 */
export async function fetchStationPredictions(stationCode, apiKey) {
    const url = `https://api.wmata.com/StationPrediction.svc/json/GetPrediction/${stationCode}`;
    const response = await fetch(url, {
        headers: { 'api_key': apiKey }
    });
    if (!response.ok) {
        throw new Error(`WMATA API error: ${response.status}`);
    }
    const data = await response.json();
    return data.Trains || [];
}
/**
 * Fetch GTFS-RT trip updates
 */
export async function fetchGTFSTripUpdates(apiKey) {
    try {
        const root = await initProto();
        const response = await fetch('https://api.wmata.com/gtfs/rail-gtfsrt-tripupdates.pb', {
            headers: { 'api_key': apiKey }
        });
        if (!response.ok) {
            throw new Error(`GTFS-RT fetch error: ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        const FeedMessage = root.lookupType('transit_realtime.FeedMessage');
        const message = FeedMessage.decode(new Uint8Array(buffer));
        const object = FeedMessage.toObject(message, { longs: String });
        return object.entity || [];
    }
    catch (e) {
        console.error('[GTFS] Fetch Error:', e);
        return [];
    }
}
/**
 * Parse GTFS-RT entities to train format
 */
export function parseUpdatesToTrains(entities, stationCode, terminusList, staticTrips = {}) {
    const relevantTrains = [];
    const now = Date.now() / 1000;
    const target = stationCode.trim().toUpperCase();
    entities.forEach(entity => {
        if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate)
            return;
        const trip = entity.tripUpdate.trip;
        const updates = entity.tripUpdate.stopTimeUpdate;
        // Find matching stop update (handles pf_x_y format)
        const stopUpdate = updates.find((u) => {
            if (!u.stopId)
                return false;
            const parts = u.stopId.split('_');
            const extractedCode = (parts[0] === 'PF') ? parts[1] : parts[0];
            return extractedCode === target;
        });
        if (!stopUpdate)
            return;
        const event = stopUpdate.departure || stopUpdate.arrival;
        if (!event || !event.time)
            return;
        const time = parseInt(event.time);
        const minutesUntil = Math.floor((time - now) / 60);
        // Skip trains that have already departed
        if (minutesUntil < -1)
            return;
        // Get static trip info if available
        const staticInfo = staticTrips[trip.tripId];
        const line = staticInfo ? staticInfo.line : (trip.routeId || '');
        const destName = staticInfo ? staticInfo.headsign : 'Check Board';
        // Filter by terminus/destination
        const normalizedDest = normalizeDestination(destName);
        const normalizedTermini = ensureArray(terminusList).map(t => normalizeDestination(t));
        const matchesTerminus = normalizedTermini.some(term => {
            if (normalizedDest === term)
                return true;
            if (normalizedDest.includes(term) || term.includes(normalizedDest))
                return true;
            const destFirst = normalizedDest.split(/[\s\-\/]/)[0];
            const termFirst = term.split(/[\s\-\/]/)[0];
            return destFirst === termFirst;
        });
        if (!matchesTerminus)
            return;
        relevantTrains.push({
            Line: line,
            DestinationName: destName,
            Min: minutesUntil <= 0 ? 'ARR' : minutesUntil.toString(),
            Car: '8',
            _gtfs: true,
            _scheduled: false
        });
    });
    // Deduplicate
    const uniqueTrains = [];
    const seen = new Set();
    relevantTrains.forEach(t => {
        const key = `${t.Line}_${t.Min}_${t.DestinationName}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueTrains.push(t);
        }
    });
    return uniqueTrains;
}
/**
 * Filter API response trains by terminus
 */
export function filterApiResponse(trains, terminus) {
    if (!trains || trains.length === 0)
        return [];
    const terminusList = ensureArray(terminus);
    const normalizedTermini = terminusList.map(t => normalizeDestination(t));
    return trains.filter(train => {
        const dest = train.Destination || train.DestinationName || '';
        if (!dest || dest === 'No Passenger' || dest === 'Train' || dest === 'ssenger' || dest === '---') {
            return false;
        }
        const normalizedDest = normalizeDestination(dest);
        const normalizedDestName = normalizeDestination(train.DestinationName);
        return normalizedTermini.some(term => {
            if (normalizedDest === term || normalizedDestName === term)
                return true;
            if (normalizedDest.includes(term) || term.includes(normalizedDest) ||
                normalizedDestName.includes(term) || term.includes(normalizedDestName))
                return true;
            const destFirst = normalizedDest.split(/[\s\-\/]/)[0];
            const termFirst = term.split(/[\s\-\/]/)[0];
            return destFirst === termFirst;
        });
    });
}
//# sourceMappingURL=wmata.js.map