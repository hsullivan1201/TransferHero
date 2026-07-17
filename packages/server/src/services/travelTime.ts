import type { Line } from '@transferhero/shared'
import { TRAVEL_TIMES } from '../data/travelTimes.js'
import { LINE_PATHS, TERMINI } from '../data/lineConfig.js'
import { normalizePlatformCode, getAllPlatformCodes } from '../data/platformCodes.js'
import { ALL_STATIONS } from '../data/stations.js'

interface PathMatch {
  path: string[]
  fromIndex: number
  toIndex: number
}

function getPathMatches(line: Line, fromStation: string, toStation: string): PathMatch[] {
  const matches: PathMatch[] = []
  for (const path of LINE_PATHS[line] ?? []) {
    const from = normalizePlatformCode(fromStation, path)
    const to = normalizePlatformCode(toStation, path)
    const fromIndex = path.indexOf(from)
    const toIndex = path.indexOf(to)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) continue
    matches.push({ path, fromIndex, toIndex })
  }
  return matches
}

/**
 * Calculate travel time between two stations on a given line
 * Walks through each segment and sums up travel times
 */
export function calculateRouteTravelTime(fromStation: string, toStation: string, line: Line): number {
  const match = getPathMatches(line, fromStation, toStation)[0]
  if (!match) return Number.POSITIVE_INFINITY

  const { path, fromIndex, toIndex } = match

  let totalTime = 0
  const step = fromIndex < toIndex ? 1 : -1

  for (let i = fromIndex; i !== toIndex; i += step) {
    const segFrom = path[i]
    const segTo = path[i + step]

    const segFromCodes = getAllPlatformCodes(segFrom)
    const segToCodes = getAllPlatformCodes(segTo)
    let segTime: number | undefined

    for (const fromCode of segFromCodes) {
      for (const toCode of segToCodes) {
        const directed = TRAVEL_TIMES[`${fromCode}_${toCode}`]
        if (directed !== undefined) {
          segTime = directed
          break
        }
      }
      if (segTime !== undefined) break
    }

    // Some generated datasets contain only the reverse direction. It is still
    // a measured edge, so use it rather than inventing a flat segment time.
    if (segTime === undefined) {
      for (const fromCode of segFromCodes) {
        for (const toCode of segToCodes) {
          const reverse = TRAVEL_TIMES[`${toCode}_${fromCode}`]
          if (reverse !== undefined) {
            segTime = reverse
            break
          }
        }
        if (segTime !== undefined) break
      }
    }

    if (segTime === undefined) return Number.POSITIVE_INFINITY
    totalTime += segTime
  }

  return totalTime
}

/**
 * Canonical (full-line) terminus name for the direction of travel — what the
 * permanent station signage shows, regardless of short-turn service patterns.
 * The first entry of each TERMINI direction array is the true end of the line;
 * later entries are turnbacks added for train filtering.
 */
export function getCanonicalTerminus(line: Line, fromStation: string, toStation: string): string | null {
  return getTerminus(line, fromStation, toStation)[0] ?? null
}

/**
 * Get terminus stations for a given direction on a line
 */
export function getTerminus(line: Line, fromStation: string, toStation: string): string[] {
  const t = TERMINI[line] || { toward_a: [], toward_b: [] }
  const matches = getPathMatches(line, fromStation, toStation)

  const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const findStationCodeByName = (name: string) => {
    const normalized = normalizeName(name)
    const match = ALL_STATIONS.find(s => normalizeName(s.name) === normalized)
    return match?.code
  }

  if (matches.length === 0) return []

  const direction = matches[0].toIndex < matches[0].fromIndex ? 'toward_a' : 'toward_b'
  const directionTermini = t[direction]

  const filtered = directionTermini.filter(terminusName => {
    const terminusCode = findStationCodeByName(terminusName)
    if (!terminusCode) return false

    return matches.some(({ path, toIndex }) => {
      const normalizedTerminus = normalizePlatformCode(terminusCode, path)
      const terminusIndex = path.indexOf(normalizedTerminus)
      if (terminusIndex < 0) return false
      return direction === 'toward_b'
        ? terminusIndex >= toIndex
        : terminusIndex <= toIndex
    })
  })

  return filtered
}

/**
 * Convert minutes from now to clock time string
 */
export function minutesToClockTime(minutesFromNow: number): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + minutesFromNow)
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}
