/**
 * Centralized mapping for multi-code stations
 * Some stations have multiple platform codes (e.g., Metro Center = A01/C01)
 */
export const STATION_ALIASES = {
    'A01': 'C01', // Metro Center
    'C01': 'A01',
    'B01': 'F01', // Gallery Place
    'F01': 'B01',
    'D03': 'F03', // L'Enfant Plaza
    'F03': 'D03',
    'B06': 'E06', // Fort Totten
    'E06': 'B06'
};
/**
 * Platform-to-Line mapping for multi-code stations
 * This tells us which platform (A01 vs C01) to use for each line.
 * Example: At Metro Center, Red Line uses A01, but Orange/Silver/Blue use C01.
 */
export const PLATFORM_CODES = {
    'A01': { 'RD': 'A01', 'OR': 'C01', 'SV': 'C01', 'BL': 'C01' }, // Metro Center
    'C01': { 'RD': 'A01', 'OR': 'C01', 'SV': 'C01', 'BL': 'C01' }, // Metro Center (alt)
    'B01': { 'RD': 'B01', 'YL': 'F01', 'GR': 'F01' }, // Gallery Place
    'F01': { 'RD': 'B01', 'YL': 'F01', 'GR': 'F01' }, // Gallery Place (alt)
    'B06': { 'RD': 'B06', 'YL': 'E06', 'GR': 'E06' }, // Fort Totten
    'E06': { 'RD': 'B06', 'YL': 'E06', 'GR': 'E06' }, // Fort Totten (alt)
    'D03': { 'OR': 'D03', 'SV': 'D03', 'BL': 'D03', 'YL': 'F03', 'GR': 'F03' }, // L'Enfant
    'F03': { 'OR': 'D03', 'SV': 'D03', 'BL': 'D03', 'YL': 'F03', 'GR': 'F03' } // L'Enfant (alt)
};
/**
 * Normalizes a platform code to the canonical code found in a station list
 */
export function normalizePlatformCode(code, availableStations) {
    if (availableStations.includes(code))
        return code;
    const alias = STATION_ALIASES[code];
    if (alias && availableStations.includes(alias))
        return alias;
    return code;
}
/**
 * Gets all platform codes for a station (including alias)
 */
export function getAllPlatformCodes(code) {
    const alias = STATION_ALIASES[code];
    return alias ? [code, alias] : [code];
}
/**
 * Get the correct platform code for a specific line at a multi-code station
 */
export function getPlatformForLine(stationCode, line) {
    const platformConfig = PLATFORM_CODES[stationCode];
    if (platformConfig && platformConfig[line]) {
        return platformConfig[line];
    }
    return stationCode;
}
//# sourceMappingURL=platformCodes.js.map