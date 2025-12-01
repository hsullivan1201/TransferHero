import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ensureArray, normalizeDestination } from '@transferhero/shared';
let cachedScheduleConfig = null;
/**
 * Load schedule config data from the root schedule-data.js file
 */
export function loadScheduleConfig() {
    if (cachedScheduleConfig) {
        return cachedScheduleConfig;
    }
    try {
        // Navigate from server/src/data to project root's schedule-data.js
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const scheduleDataPath = resolve(__dirname, '../../../../../schedule-data.js');
        const fileContent = readFileSync(scheduleDataPath, 'utf-8');
        // Extract JSON from: const SCHEDULE_CONFIG = {...}
        const jsonMatch = fileContent.match(/const\s+SCHEDULE_CONFIG\s*=\s*(\{[\s\S]*?\n\};)/);
        if (!jsonMatch) {
            console.warn('[ScheduleData] Could not parse schedule-data.js format');
            return { patterns: {} };
        }
        // Remove trailing semicolon, strip inline comments, and parse
        let jsonStr = jsonMatch[1].replace(/;$/, '');
        // Remove inline comments like "// minutes between trains"
        jsonStr = jsonStr.replace(/\/\/[^\n]*/g, '');
        // Remove trailing commas before closing braces (not valid in JSON)
        jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
        // Quote unquoted object keys (e.g., patterns: -> "patterns":)
        jsonStr = jsonStr.replace(/(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*):/g, '$1"$2"$3:');
        // Convert single quotes to double quotes for string values
        jsonStr = jsonStr.replace(/'/g, '"');
        cachedScheduleConfig = JSON.parse(jsonStr);
        console.log(`[ScheduleData] Loaded ${Object.keys(cachedScheduleConfig.patterns).length} schedule patterns`);
        return cachedScheduleConfig;
    }
    catch (error) {
        console.error('[ScheduleData] Failed to load schedule-data.js:', error);
        if (error instanceof Error) {
            console.error('[ScheduleData] Error details:', error.message);
        }
        return { patterns: {} };
    }
}
/**
 * Convert time string (HH:MM) to minutes since midnight
 */
function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}
/**
 * Get current minutes since midnight
 */
function getCurrentMinutes() {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
}
/**
 * Generate scheduled trains for a specific pattern
 */
function generateScheduledTrains(patternKey, scheduleConfig, startFromMinutes = 0) {
    const pattern = scheduleConfig.patterns[patternKey];
    if (!pattern)
        return [];
    const currentMinutes = getCurrentMinutes();
    const frequency = pattern.frequency;
    const firstTrainMin = timeToMinutes(pattern.firstTrain);
    const lastTrainMin = timeToMinutes(pattern.lastTrain);
    const trains = [];
    const searchStart = currentMinutes + startFromMinutes;
    let trainTime = firstTrainMin;
    while (trainTime < searchStart && trainTime <= lastTrainMin) {
        trainTime += frequency;
    }
    for (let i = 0; i < 8 && trainTime <= lastTrainMin; i++) {
        const minFromNow = trainTime - currentMinutes;
        if (minFromNow >= startFromMinutes && minFromNow <= 60) {
            trains.push({
                Line: pattern.line,
                DestinationName: pattern.destination,
                Min: minFromNow.toString(),
                Car: '8',
                _scheduled: true
            });
        }
        trainTime += frequency;
    }
    return trains;
}
/**
 * Get scheduled trains for a station and terminus
 * @param stationCode - Station code (e.g., 'A01')
 * @param terminus - Terminus destination(s) to filter by
 * @param startFromMinutes - Minimum minutes from now to start search (default: 0)
 */
export function getScheduledTrains(stationCode, terminus, startFromMinutes = 0) {
    const scheduleConfig = cachedScheduleConfig ?? loadScheduleConfig();
    const terminusList = ensureArray(terminus);
    let allTrains = [];
    for (const [patternKey, pattern] of Object.entries(scheduleConfig.patterns)) {
        if (pattern.station === stationCode) {
            // Normalize and match destination names
            const normalizedPatternDest = normalizeDestination(pattern.destination);
            const normalizedTermini = terminusList.map(t => normalizeDestination(t));
            const matches = normalizedTermini.some(term => {
                if (normalizedPatternDest === term)
                    return true;
                if (normalizedPatternDest.includes(term) || term.includes(normalizedPatternDest))
                    return true;
                const destFirst = normalizedPatternDest.split(/[\s\-\/]/)[0];
                const termFirst = term.split(/[\s\-\/]/)[0];
                return destFirst === termFirst;
            });
            if (matches) {
                const generatedTrains = generateScheduledTrains(patternKey, scheduleConfig, startFromMinutes);
                allTrains = allTrains.concat(generatedTrains);
            }
        }
    }
    allTrains.sort((a, b) => parseInt(String(a.Min)) - parseInt(String(b.Min)));
    return allTrains;
}
//# sourceMappingURL=scheduleData.js.map