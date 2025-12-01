/**
 * Car Position Service
 *
 * Provides optimal car recommendations for DC Metro trips based on exit locations.
 * Uses data from DCMetroStationExits dataset.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
let cachedData = null;
function loadStationData() {
    if (cachedData)
        return cachedData;
    try {
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const jsonPath = join(__dirname, 'stationExits.json');
        const content = readFileSync(jsonPath, 'utf-8');
        cachedData = JSON.parse(content);
        console.log(`[CarPosition] Loaded ${Object.keys(cachedData.stations).length} stations`);
        return cachedData;
    }
    catch (error) {
        console.error('[CarPosition] Failed to load stationExits.json:', error);
        // Return empty data structure
        return {
            stations: {},
            doorPositions: [],
            carBoundaries: [9, 18, 27, 36, 45, 54, 63, 72]
        };
    }
}
function getData() {
    return cachedData ?? loadStationData();
}
// Additional WMATA code mappings for multi-level stations
const MULTI_LEVEL_CODE_MAP = {
    'A01': 'Metro Center', // Red line (upper)
    'C01': 'Metro Center', // BL/OR/SV (lower)
    'B01': 'Gallery Place', // Red line (upper)
    'F01': 'Gallery Place', // GR/YL (lower)
    'D03': "L'Enfant Plaza", // BL/OR/SV (lower)
    'F03': "L'Enfant Plaza", // GR/YL (upper)
    'B06': 'Fort Totten', // Red line (upper)
    'E06': 'Fort Totten', // GR (lower)
};
/**
 * Get station by name or WMATA code
 */
export function getStation(nameOrCode) {
    const data = getData();
    // Try direct name lookup first
    if (data.stations[nameOrCode]) {
        return data.stations[nameOrCode];
    }
    // Check multi-level code map
    if (MULTI_LEVEL_CODE_MAP[nameOrCode]) {
        const stationName = MULTI_LEVEL_CODE_MAP[nameOrCode];
        if (data.stations[stationName]) {
            return data.stations[stationName];
        }
    }
    // Try to find by WMATA code
    for (const station of Object.values(data.stations)) {
        if (station.wmataCode === nameOrCode) {
            return station;
        }
    }
    // Try case-insensitive name match
    const lowerName = nameOrCode.toLowerCase();
    for (const [name, station] of Object.entries(data.stations)) {
        if (name.toLowerCase() === lowerName || station.nameAlt?.toLowerCase() === lowerName) {
            return station;
        }
    }
    return null;
}
/**
 * Find the platform at a station that serves a given line
 */
export function findPlatformForLine(station, line) {
    for (const platform of station.platforms) {
        if (platform.lines.includes(line)) {
            return platform;
        }
    }
    return null;
}
/**
 * Determine which track a train is on based on its destination
 */
export function getTrackDirection(platform, destination) {
    const destLower = destination.toLowerCase();
    // Check track1 destinations
    for (const d of platform.track1Destinations) {
        if (destLower.includes(d.toLowerCase()) || d.toLowerCase().includes(destLower)) {
            return 'track1';
        }
    }
    // Check track2 destinations
    for (const d of platform.track2Destinations) {
        if (destLower.includes(d.toLowerCase()) || d.toLowerCase().includes(destLower)) {
            return 'track2';
        }
    }
    // Default to track1 if we can't determine
    return 'track1';
}
// ============================================================================
// Car Calculation
// ============================================================================
/**
 * Convert x-position (light pair 1-72) to car number (1-8)
 */
export function xToCar(x) {
    const data = getData();
    for (let i = 0; i < data.carBoundaries.length; i++) {
        if (x <= data.carBoundaries[i]) {
            return i + 1;
        }
    }
    return 8;
}
/**
 * Find the closest door position to a given x coordinate
 */
export function findClosestDoor(x) {
    const data = getData();
    let closest = { car: 1, doorX: 2.25, distance: Infinity };
    for (const carDoors of data.doorPositions) {
        for (const doorX of carDoors.positions) {
            const distance = Math.abs(x - doorX);
            if (distance < closest.distance) {
                closest = { car: carDoors.car, doorX, distance };
            }
        }
    }
    return closest;
}
/**
 * Get human-readable position in train
 */
function getPositionDescription(car) {
    if (car <= 2)
        return 'front';
    if (car >= 7)
        return 'back';
    return 'middle';
}
/**
 * Adjust car number for track direction
 * Track 2 trains are oriented opposite to Track 1
 */
export function adjustCarForTrack(car, track) {
    if (track === 'track2') {
        return 9 - car; // Flip: 1→8, 2→7, 3→6, etc.
    }
    return car;
}
/**
 * Get egresses for a platform based on track direction
 */
function getEgressesForTrack(platform, track) {
    if (platform.platformType === 'island' || platform.platformType.startsWith('terminus')) {
        return platform.egresses.shared;
    }
    // Side or gap island platforms have separate egresses per track
    const trackEgresses = track === 'track1' ? platform.egresses.track1 : platform.egresses.track2;
    return trackEgresses.length > 0 ? trackEgresses : platform.egresses.shared;
}
/**
 * Find the best egress from a list
 * Prioritizes: preferred > escalator > stairs > elevator > exit
 */
function findBestEgress(egresses, preferType) {
    if (egresses.length === 0)
        return null;
    // First check for preferred egress
    const preferred = egresses.find(e => e.preferred);
    if (preferred && (!preferType || preferred.type === preferType)) {
        return preferred;
    }
    // If specific type requested, try to find it
    if (preferType) {
        const ofType = egresses.find(e => e.type === preferType);
        if (ofType)
            return ofType;
    }
    // Priority order for speed: escalator > stairs > exit > elevator
    const priority = ['escalator', 'stairs', 'exit', 'elevator'];
    for (const type of priority) {
        const egress = egresses.find(e => e.type === type);
        if (egress)
            return egress;
    }
    return egresses[0];
}
/**
 * Find egress that leads to a connecting platform (for transfers)
 */
function findTransferEgress(platform, track, targetLines) {
    const egresses = getEgressesForTrack(platform, track);
    // Look for egresses with descriptions mentioning the target line
    for (const egress of egresses) {
        if (egress.description) {
            const desc = egress.description.toLowerCase();
            for (const line of targetLines) {
                // Check for line mentions like "RD Trains" or "BL/OR/SV"
                if (desc.includes(line.toLowerCase()) || desc.includes(`${line.toLowerCase()} trains`)) {
                    return egress;
                }
            }
            // Also check for "opposite platform" or similar
            if (desc.includes('platform') && !desc.includes('street')) {
                return egress;
            }
        }
    }
    // Fall back to best egress
    return findBestEgress(egresses);
}
// ============================================================================
// Public API
// ============================================================================
/**
 * Get car position for a direct (non-transfer) trip
 */
export function getDirectTripCarPosition(destinationCode, line, trainDestination) {
    const station = getStation(destinationCode);
    if (!station) {
        return {
            boardCar: 4,
            exitCar: 4,
            boardPosition: 'middle',
            legend: 'Board middle of train',
            confidence: 'low',
        };
    }
    const platform = findPlatformForLine(station, line);
    if (!platform) {
        return {
            boardCar: 4,
            exitCar: 4,
            boardPosition: 'middle',
            legend: 'Board middle of train',
            confidence: 'low',
        };
    }
    const track = getTrackDirection(platform, trainDestination);
    const egresses = getEgressesForTrack(platform, track);
    const bestEgress = findBestEgress(egresses);
    if (!bestEgress) {
        return {
            boardCar: 4,
            exitCar: 4,
            boardPosition: 'middle',
            legend: 'Board middle of train',
            confidence: 'low',
        };
    }
    const rawCar = xToCar(bestEgress.x);
    const adjustedCar = adjustCarForTrack(rawCar, track);
    return {
        boardCar: adjustedCar,
        exitCar: adjustedCar,
        boardPosition: getPositionDescription(adjustedCar),
        legend: `Board car ${adjustedCar} for quick exit at ${station.name}`,
        confidence: 'high',
        details: {
            exitType: bestEgress.type,
            exitDescription: bestEgress.description,
            xPosition: bestEgress.x,
        },
    };
}
/**
 * Get car positions for a transfer trip
 *
 * @param transferCode - Station code where the transfer happens
 * @param incomingLine - Line you're arriving on (e.g., 'RD')
 * @param outgoingLine - Line you're transferring to (e.g., 'BL')
 * @param incomingDestination - Terminus of your incoming train
 * @param destinationCode - Final destination station
 * @param finalDestination - Terminus of your outgoing train
 */
export function getTransferCarPosition(transferCode, incomingLine, outgoingLine, incomingDestination, destinationCode, finalDestination) {
    const transferStation = getStation(transferCode);
    const destStation = getStation(destinationCode);
    // Default fallback
    const fallback = {
        boardCar: 4,
        exitCar: 4,
        boardPosition: 'middle',
        legend: 'Board middle of train',
        confidence: 'low',
    };
    if (!transferStation) {
        return { leg1: fallback, leg2: fallback };
    }
    // Find platforms
    const inPlatform = findPlatformForLine(transferStation, incomingLine);
    const outPlatform = findPlatformForLine(transferStation, outgoingLine);
    if (!inPlatform || !outPlatform) {
        return { leg1: fallback, leg2: fallback };
    }
    const inTrack = getTrackDirection(inPlatform, incomingDestination);
    const outTrack = getTrackDirection(outPlatform, finalDestination);
    // Calculate Leg 1 board car (to optimize transfer)
    let leg1Car;
    let leg1Legend;
    let leg1Confidence = 'high';
    let leg1Details;
    // Check for explicit transfer mapping first
    const transferKey = `${incomingLine}_to_${outgoingLine}`;
    const explicitTransfer = transferStation.transfers?.[transferKey];
    if (explicitTransfer) {
        // Use the explicit transfer mapping
        const rawCar = xToCar(explicitTransfer.x);
        leg1Car = adjustCarForTrack(rawCar, inTrack);
        leg1Legend = `Board car ${leg1Car} for ${explicitTransfer.description}`;
        leg1Details = {
            exitDescription: explicitTransfer.description,
            xPosition: explicitTransfer.x,
        };
    }
    else if (inPlatform === outPlatform) {
        // Same platform - cross-platform transfer, just stay put
        leg1Car = 4;
        leg1Legend = 'Cross-platform transfer - any car works';
        leg1Confidence = 'medium';
    }
    else {
        // Different platforms - find the egress to the other platform
        const transferEgress = findTransferEgress(inPlatform, inTrack, [outgoingLine]);
        if (transferEgress) {
            const rawCar = xToCar(transferEgress.x);
            leg1Car = adjustCarForTrack(rawCar, inTrack);
            leg1Legend = `Board car ${leg1Car} for quick transfer to ${outgoingLine} line`;
            leg1Details = {
                exitType: transferEgress.type,
                exitDescription: transferEgress.description,
                xPosition: transferEgress.x,
            };
        }
        else {
            leg1Car = 4;
            leg1Legend = `Board middle of train for transfer at ${transferStation.name}`;
            leg1Confidence = 'medium';
        }
    }
    // Calculate Leg 2 exit car (to optimize final exit)
    let leg2Car = leg1Car;
    let leg2Legend = leg1Legend;
    let leg2Confidence = 'medium';
    let leg2Details;
    if (destStation) {
        const destPlatform = findPlatformForLine(destStation, outgoingLine);
        if (destPlatform) {
            const destTrack = getTrackDirection(destPlatform, finalDestination);
            const destEgresses = getEgressesForTrack(destPlatform, destTrack);
            const destEgress = findBestEgress(destEgresses);
            if (destEgress) {
                const rawCar = xToCar(destEgress.x);
                leg2Car = adjustCarForTrack(rawCar, destTrack);
                leg2Legend = `Exit car ${leg2Car} at ${destStation.name}`;
                leg2Confidence = 'high';
                leg2Details = {
                    exitType: destEgress.type,
                    exitDescription: destEgress.description,
                    xPosition: destEgress.x,
                };
            }
        }
    }
    return {
        leg1: {
            boardCar: leg1Car,
            exitCar: leg1Car,
            boardPosition: getPositionDescription(leg1Car),
            legend: leg1Legend,
            confidence: leg1Confidence,
            details: leg1Details,
        },
        leg2: {
            boardCar: leg2Car,
            exitCar: leg2Car,
            boardPosition: getPositionDescription(leg2Car),
            legend: leg2Legend,
            confidence: leg2Confidence,
            details: leg2Details,
        },
    };
}
/**
 * Get all stations (for debugging/admin)
 */
export function getAllStations() {
    return Object.values(getData().stations);
}
/**
 * Get station names mapped to WMATA codes
 */
export function getStationCodeMap() {
    const map = {};
    for (const station of Object.values(getData().stations)) {
        if (station.wmataCode) {
            map[station.name] = station.wmataCode;
        }
    }
    return map;
}
//# sourceMappingURL=carPositionService.js.map