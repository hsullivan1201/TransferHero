/**
 * Car Position Service
 *
 * Provides optimal car recommendations for DC Metro trips based on exit locations.
 * Uses data from DCMetroStationExits dataset.
 */
export interface Egress {
    x: number;
    x2?: number;
    type: 'escalator' | 'elevator' | 'stairs' | 'exit';
    y: number;
    preferred: boolean;
    exitLabel?: number;
    description?: string;
}
export interface Platform {
    level?: 'lower' | 'upper';
    lines: string[];
    track1Destinations: string[];
    track2Destinations: string[];
    platformType: 'island' | 'side' | 'terminus_wb' | 'terminus_eb' | 'gap_island';
    egresses: {
        track1: Egress[];
        track2: Egress[];
        shared: Egress[];
    };
}
export interface Station {
    name: string;
    nameAlt?: string;
    subtitle?: string;
    platforms: Platform[];
    wmataCode?: string;
    transfers?: Record<string, {
        x: number;
        description: string;
    }>;
}
export interface CarPosition {
    boardCar: number;
    exitCar: number;
    boardPosition: 'front' | 'middle' | 'back';
    legend: string;
    confidence: 'high' | 'medium' | 'low';
    details?: {
        exitType?: string;
        exitDescription?: string;
        xPosition?: number;
    };
}
export type TrackDirection = 'track1' | 'track2';
/**
 * Get station by name or WMATA code
 */
export declare function getStation(nameOrCode: string): Station | null;
/**
 * Find the platform at a station that serves a given line
 */
export declare function findPlatformForLine(station: Station, line: string): Platform | null;
/**
 * Determine which track a train is on based on its destination
 */
export declare function getTrackDirection(platform: Platform, destination: string): TrackDirection;
/**
 * Convert x-position (light pair 1-72) to car number (1-8)
 */
export declare function xToCar(x: number): number;
/**
 * Find the closest door position to a given x coordinate
 */
export declare function findClosestDoor(x: number): {
    car: number;
    doorX: number;
    distance: number;
};
/**
 * Adjust car number for track direction
 * Track 2 trains are oriented opposite to Track 1
 */
export declare function adjustCarForTrack(car: number, track: TrackDirection): number;
/**
 * Get car position for a direct (non-transfer) trip
 */
export declare function getDirectTripCarPosition(destinationCode: string, line: string, trainDestination: string): CarPosition;
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
export declare function getTransferCarPosition(transferCode: string, incomingLine: string, outgoingLine: string, incomingDestination: string, destinationCode: string, finalDestination: string): {
    leg1: CarPosition;
    leg2: CarPosition;
};
/**
 * Get all stations (for debugging/admin)
 */
export declare function getAllStations(): Station[];
/**
 * Get station names mapped to WMATA codes
 */
export declare function getStationCodeMap(): Record<string, string>;
//# sourceMappingURL=carPositionService.d.ts.map