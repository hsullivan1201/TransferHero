import type { Line } from '@transferhero/shared'
import { TRAVEL_TIMES } from '../data/travelTimes.js'
import { LINE_STATIONS, TERMINI } from '../data/lineConfig.js'
import { normalizePlatformCode, getAllPlatformCodes } from '../data/platformCodes.js'
import { ALL_STATIONS } from '../data/stations.js'

/**
 * Calculate travel time between two stations on a given line
 * Walks through each segment and sums up travel times
 */
export function calculateRouteTravelTime(fromStation: string, toStation: string, line: Line): number {
  // First check for direct lookup
  const directKey = `${fromStation}_${toStation}`
  if (TRAVEL_TIMES[directKey]) return TRAVEL_TIMES[directKey]

  const stations = LINE_STATIONS[line]
  if (!stations) return 10 // Default fallback

  // Normalize platform codes for multi-code stations
  const mappedFrom = normalizePlatformCode(fromStation, stations)
  const mappedTo = normalizePlatformCode(toStation, stations)
  const fromIdx = stations.indexOf(mappedFrom)
  const toIdx = stations.indexOf(mappedTo)

  if (fromIdx === -1 || toIdx === -1) return 10 // Default fallback

  let totalTime = 0
  const step = fromIdx < toIdx ? 1 : -1

  for (let i = fromIdx; i !== toIdx; i += step) {
    const segFrom = stations[i]
    const segTo = stations[i + step]

    // Generate all possible keys using platform code aliases
    const segFromCodes = getAllPlatformCodes(segFrom)
    const segToCodes = getAllPlatformCodes(segTo)
    const keys: string[] = []

    for (const fromCode of segFromCodes) {
      for (const toCode of segToCodes) {
        keys.push(`${fromCode}_${toCode}`, `${toCode}_${fromCode}`)
      }
    }

    let segTime = 2 // Default segment time
    for (const key of keys) {
      if (TRAVEL_TIMES[key]) {
        segTime = TRAVEL_TIMES[key]
        break
      }
    }
    totalTime += segTime
  }

  return totalTime
}

/**
 * Get terminus stations for a given direction on a line
 */
export function getTerminus(line: Line, fromStation: string, toStation: string): string[] {
  const stations = LINE_STATIONS[line] || []
  const normalizedFrom = normalizePlatformCode(fromStation, stations)
  const normalizedTo = normalizePlatformCode(toStation, stations)
  const fromIdx = stations.indexOf(normalizedFrom)
  const toIdx = stations.indexOf(normalizedTo)
  const t = TERMINI[line] || { toward_a: [], toward_b: [] }

  const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const findStationCodeByName = (name: string) => {
    const normalized = normalizeName(name)
    const match = ALL_STATIONS.find(s => normalizeName(s.name) === normalized)
    return match?.code
  }

  if (fromIdx === -1 || toIdx === -1) return [...t.toward_a, ...t.toward_b]

  const direction = toIdx < fromIdx ? 'toward_a' : 'toward_b'
  const directionTermini = t[direction] || []

  const filtered = directionTermini.filter(terminusName => {
    const terminusCode = findStationCodeByName(terminusName)
    if (!terminusCode) return false
    const normalizedTerminus = normalizePlatformCode(terminusCode, stations)
    const terminusIdx = stations.indexOf(normalizedTerminus)
    if (terminusIdx === -1) return false
    return direction === 'toward_b' ? terminusIdx >= toIdx : terminusIdx <= toIdx
  })

  return filtered.length > 0 ? filtered : directionTermini
}

/**
 * Convert minutes from now to clock time string
 */
export function minutesToClockTime(minutesFromNow: number): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + minutesFromNow)
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}
