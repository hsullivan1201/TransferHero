import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { Train, Line } from '@transferhero/shared'
import { ensureArray, normalizeDestination, getDisplayName } from '@transferhero/shared'
import { getMetroDepartures } from '../services/metroScheduleIndex.js'

// ── Legacy types (fallback when GTFS not loaded) ───────────────────────

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

// ── Legacy helpers ─────────────────────────────────────────────────────

function loadScheduleConfig(): ScheduleConfig {
  if (cachedScheduleConfig) return cachedScheduleConfig

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
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

    console.log(`[ScheduleData] Loaded ${Object.keys(cachedScheduleConfig.patterns).length} legacy schedule patterns`)
    return cachedScheduleConfig
  } catch (error) {
    console.error('[ScheduleData] Failed to load legacy schedule data:', error)
    return { patterns: {} }
  }
}

function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number)
  return hours * 60 + minutes
}

function getCurrentMinutes(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function generateLegacyTrains(
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
    if (minFromNow > endMinFromNow) break
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

function getLegacyScheduledTrains(
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

  for (const [patternKey, pattern] of Object.entries(scheduleConfig.patterns)) {
    if (pattern.station === stationCode && matchesTerminus(pattern.destination)) {
      const generatedTrains = generateLegacyTrains(patternKey, scheduleConfig, startFromMinutes)
      allTrains = allTrains.concat(generatedTrains)
    }
  }

  if (allTrains.length === 0) {
    for (const [patternKey, pattern] of Object.entries(scheduleConfig.patterns)) {
      if (matchesTerminus(pattern.destination)) {
        const generatedTrains = generateLegacyTrains(patternKey, scheduleConfig, startFromMinutes)
        allTrains = allTrains.concat(generatedTrains)
        break
      }
    }
  }

  allTrains.sort((a, b) => parseInt(String(a.Min)) - parseInt(String(b.Min)))
  return allTrains
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Get scheduled trains for a station and terminus.
 * Uses real GTFS departure times when available, falls back to legacy frequency-based generation.
 */
export function getScheduledTrains(
  stationCode: string,
  terminus: string | string[],
  startFromMinutes = 0
): Train[] {
  // Try GTFS-based schedule first
  const gtfsDepartures = getMetroDepartures(stationCode, terminus, startFromMinutes)

  if (gtfsDepartures.length > 0) {
    return gtfsDepartures.map(dep => ({
      Line: dep.line,
      DestinationName: getDisplayName(dep.headsign),
      Min: dep.minutesFromNow.toString(),
      Car: '8',
      _scheduled: true,
      _tripId: dep.tripId,
    }))
  }

  // Fallback to legacy frequency-based schedule
  console.log(`[ScheduleData] GTFS miss for ${stationCode}→${terminus}, using legacy schedule`)
  return getLegacyScheduledTrains(stationCode, terminus, startFromMinutes)
}
