import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Train, Line } from '@transferhero/shared'
import { ensureArray, normalizeDestination } from '@transferhero/shared'

export interface SchedulePattern {
  station: string
  line: string
  destination: string
  frequency: number
  firstTrain: string
  lastTrain: string
}

export interface ScheduleConfig {
  patterns: Record<string, SchedulePattern>
}

let cachedScheduleConfig: ScheduleConfig | null = null

/**
 * Load schedule config data from the root schedule-data.js file
 */
export function loadScheduleConfig(): ScheduleConfig {
  if (cachedScheduleConfig) {
    return cachedScheduleConfig
  }

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    // try .json first (new format), fall back to .js (legacy)
    const jsonPath = resolve(__dirname, '../../../../schedule-data.json')
    const jsPath = resolve(__dirname, '../../../../schedule-data.js')

    let fileContent: string
    let usingLegacy = false
    try {
      fileContent = readFileSync(jsonPath, 'utf-8')
    } catch {
      fileContent = readFileSync(jsPath, 'utf-8')
      usingLegacy = true
    }

    if (usingLegacy) {
      // legacy .js format: extract and transform to JSON
      const jsonMatch = fileContent.match(/const\s+SCHEDULE_CONFIG\s*=\s*(\{[\s\S]*?\n\};)/)
      if (!jsonMatch) {
        console.warn('[ScheduleData] Could not parse schedule-data.js format')
        return { patterns: {} }
      }
      let jsonStr = jsonMatch[1].replace(/;$/, '')
      jsonStr = jsonStr.replace(/\/\/[^\n]*/g, '')
      jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1')
      jsonStr = jsonStr.replace(/(\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*):/g, '$1"$2"$3:')
      jsonStr = jsonStr.replace(/'/g, '"')
      cachedScheduleConfig = JSON.parse(jsonStr) as ScheduleConfig
    } else {
      cachedScheduleConfig = JSON.parse(fileContent) as ScheduleConfig
    }

    console.log(`[ScheduleData] Loaded ${Object.keys(cachedScheduleConfig.patterns).length} schedule patterns`)
    return cachedScheduleConfig
  } catch (error) {
    console.error('[ScheduleData] Failed to load schedule data:', error)
    if (error instanceof Error) {
      console.error('[ScheduleData] Error details:', error.message)
    }
    return { patterns: {} }
  }
}

/**
 * Convert time string (HH:MM) to minutes since midnight
 */
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * Get current minutes since midnight
 */
function getCurrentMinutes(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

/**
 * Generate scheduled trains for a specific pattern
 */
function generateScheduledTrains(
  patternKey: string,
  scheduleConfig: ScheduleConfig,
  startFromMinutes = 0,
  windowMinutes = 60
): Train[] {
  const pattern = scheduleConfig.patterns[patternKey]
  if (!pattern) return []

  const currentMinutes = getCurrentMinutes()
  const frequency = pattern.frequency
  const firstTrainMin = timeToMinutes(pattern.firstTrain)
  const lastTrainMin = timeToMinutes(pattern.lastTrain)

  const trains: Train[] = []
  const searchStart = currentMinutes + startFromMinutes
  const endMinFromNow = startFromMinutes + windowMinutes

  let trainTime = firstTrainMin
  while (trainTime < searchStart && trainTime <= lastTrainMin) {
    trainTime += frequency
  }

  while (trainTime <= lastTrainMin) {
    const minFromNow = trainTime - currentMinutes
    if (minFromNow > endMinFromNow) break // past the window
    if (minFromNow >= startFromMinutes) {
      trains.push({
        Line: pattern.line as Line,
        DestinationName: pattern.destination,
        Min: minFromNow.toString(),
        Car: '8',
        _scheduled: true
      })
    }
    trainTime += frequency
  }

  return trains
}

/**
 * Get scheduled trains for a station and terminus
 * @param stationCode - Station code (e.g., 'A01')
 * @param terminus - Terminus destination(s) to filter by
 * @param startFromMinutes - Minimum minutes from now to start search (default: 0)
 */
export function getScheduledTrains(
  stationCode: string,
  terminus: string | string[],
  startFromMinutes = 0
): Train[] {
  const scheduleConfig = cachedScheduleConfig ?? loadScheduleConfig()
  const terminusList = ensureArray(terminus)
  const normalizedTermini = terminusList.map(t => normalizeDestination(t))
  let allTrains: Train[] = []

  const matchesTerminus = (patternDest: string) => {
    const normalizedPatternDest = normalizeDestination(patternDest)
    return normalizedTermini.some(term => {
      if (normalizedPatternDest === term) return true
      if (normalizedPatternDest.includes(term) || term.includes(normalizedPatternDest)) return true
      const destFirst = normalizedPatternDest.split(/[\s\-\/]/)[0]
      const termFirst = term.split(/[\s\-\/]/)[0]
      return destFirst === termFirst
    })
  }

  // Try exact station match first
  for (const [patternKey, pattern] of Object.entries(scheduleConfig.patterns)) {
    if (pattern.station === stationCode && matchesTerminus(pattern.destination)) {
      const generatedTrains = generateScheduledTrains(patternKey, scheduleConfig, startFromMinutes)
      allTrains = allTrains.concat(generatedTrains)
    }
  }

  // Fallback: no patterns for this station — use same-line frequency from any station
  // Metro runs at the same headway across a line, so frequency is transferable
  if (allTrains.length === 0) {
    for (const [patternKey, pattern] of Object.entries(scheduleConfig.patterns)) {
      if (matchesTerminus(pattern.destination)) {
        const generatedTrains = generateScheduledTrains(patternKey, scheduleConfig, startFromMinutes)
        allTrains = allTrains.concat(generatedTrains)
        break // one matching pattern is enough for frequency
      }
    }
  }

  allTrains.sort((a, b) => parseInt(String(a.Min)) - parseInt(String(b.Min)))
  return allTrains
}
