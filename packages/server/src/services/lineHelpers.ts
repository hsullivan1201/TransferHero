import type { Line, Station } from '@transferhero/shared'
import { LINE_PATHS } from '../data/lineConfig.js'
import { getAllPlatformCodes, getPlatformForLine, normalizePlatformCode } from '../data/platformCodes.js'
import { findStationByCode } from '../data/stations.js'
import { calculateRouteTravelTime } from './travelTime.js'

interface LinePathMatch {
  path: string[]
  fromIndex: number
  toIndex: number
}

function getLinePathMatches(line: Line, fromCode: string, toCode: string): LinePathMatch[] {
  const matches: LinePathMatch[] = []

  for (const path of LINE_PATHS[line] ?? []) {
    const from = normalizePlatformCode(fromCode, path)
    const to = normalizePlatformCode(toCode, path)
    const fromIndex = path.indexOf(from)
    const toIndex = path.indexOf(to)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) continue
    matches.push({ path, fromIndex, toIndex })
  }

  return matches
}

/** Return every ordered station-code segment a line can use for this leg. */
export function getLineSegmentsForLeg(line: Line, fromCode: string, toCode: string): string[][] {
  return getLinePathMatches(line, fromCode, toCode).map(({ path, fromIndex, toIndex }) => {
    const step = toIndex > fromIndex ? 1 : -1
    const segment: string[] = []
    for (let index = fromIndex; index !== toIndex + step; index += step) {
      segment.push(path[index])
    }
    return segment
  })
}

/** True only when a single revenue-service path contains both leg endpoints. */
export function lineCanServeLeg(line: Line, fromCode: string, toCode: string): boolean {
  return getLinePathMatches(line, fromCode, toCode).length > 0
}

/** Lines available anywhere within a physical station's aliased platform codes. */
export function getPhysicalStationLines(code: string, declaredLines: Line[] = []): Line[] {
  const lines = new Set(declaredLines)
  for (const platformCode of getAllPlatformCodes(code)) {
    for (const line of findStationByCode(platformCode)?.lines ?? []) lines.add(line)
  }
  return [...lines]
}

/** Whether two codes identify different platforms within the same station. */
export function areSamePhysicalStation(leftCode: string, rightCode: string): boolean {
  const rightCodes = new Set(getAllPlatformCodes(rightCode))
  return getAllPlatformCodes(leftCode).some(code => rightCodes.has(code))
}

/** Lines that can carry a rider between both endpoints without a transfer. */
export function getDirectLinesForLeg(
  fromLines: Line[],
  toLines: Line[],
  fromCode: string,
  toCode: string
): Line[] {
  const physicalFromLines = getPhysicalStationLines(fromCode, fromLines)
  const destinationLines = new Set(getPhysicalStationLines(toCode, toLines))
  return physicalFromLines.filter(line =>
    destinationLines.has(line)
    && lineCanServeLeg(line, fromCode, toCode)
    && Number.isFinite(calculateRouteTravelTime(fromCode, toCode, line))
  )
}

function physicalStationCode(code: string): string {
  return [...getAllPlatformCodes(code)].sort()[0]
}

function samePhysicalSegment(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((code, index) => physicalStationCode(code) === physicalStationCode(right[index]))
}

/**
 * Return candidate lines that use the exact same platforms and track segment
 * as the planned line. Merely serving both endpoints is insufficient when two
 * lines split and later rejoin (Blue/Yellow between King St and L'Enfant).
 */
export function getInterlinedLinesForLeg(
  plannedLine: Line,
  candidateLines: Line[],
  fromCode: string,
  toCode: string
): Line[] {
  const plannedSegments = getLineSegmentsForLeg(plannedLine, fromCode, toCode)
  if (plannedSegments.length === 0) return []

  const plannedFromPlatform = getPlatformForLine(fromCode, plannedLine)
  const plannedToPlatform = getPlatformForLine(toCode, plannedLine)

  const physicalCandidateLines = getPhysicalStationLines(
    toCode,
    getPhysicalStationLines(fromCode, candidateLines)
  )

  return physicalCandidateLines.filter(line => {
    if (getPlatformForLine(fromCode, line) !== plannedFromPlatform) return false
    if (getPlatformForLine(toCode, line) !== plannedToPlatform) return false

    const candidateSegments = getLineSegmentsForLeg(line, fromCode, toCode)
    return candidateSegments.some(candidate =>
      plannedSegments.some(planned => samePhysicalSegment(candidate, planned))
    )
  })
}

/** Return every real station on a leg in travel order, including both endpoints. */
export function getStopsForLeg(line: Line, fromCode: string, toCode: string): Station[] {
  return (getLineSegmentsForLeg(line, fromCode, toCode)[0] ?? [])
    .map(findStationByCode)
    .filter((station): station is Station => station !== undefined)
}

/** Return up to `limit` real stations beyond the destination in travel order. */
export function getStopsBeyondDestination(
  line: Line,
  fromCode: string,
  toCode: string,
  limit: number = 3
): Station[] {
  if (limit <= 0) return []
  const matches = getLinePathMatches(line, fromCode, toCode)
  if (matches.length === 0) return []

  const beyondByPath = matches.map(({ path, fromIndex, toIndex }) => {
    const step = toIndex > fromIndex ? 1 : -1
    const codes: string[] = []
    for (
      let index = toIndex + step;
      index >= 0 && index < path.length && codes.length < limit;
      index += step
    ) {
      codes.push(path[index])
    }
    return codes
  })

  // If service branches beyond the destination, show only the common prefix;
  // choosing one branch would misdescribe trains headed down the other one.
  const commonCodes: string[] = []
  for (let index = 0; index < beyondByPath[0].length; index += 1) {
    const code = beyondByPath[0][index]
    const sharedByEveryPath = beyondByPath.every(codes =>
      codes[index] !== undefined
      && physicalStationCode(codes[index]) === physicalStationCode(code)
    )
    if (!sharedByEveryPath) break
    commonCodes.push(code)
  }

  return commonCodes
    .map(findStationByCode)
    .filter((station): station is Station => station !== undefined)
}

/**
 * Get all lines that share the planned line's exact leg-one track segment.
 */
export function getInterlinesForLeg1(
  fromStation: { lines: Line[] },
  fromCode: string,
  toCode: string,
  plannedLine: Line
): Line[] | undefined {
  const validLines = getInterlinedLinesForLeg(plannedLine, fromStation.lines, fromCode, toCode)
  return validLines.length > 0 ? validLines : undefined
}

/**
 * Get all destination lines that share the planned line's exact leg-two track.
 */
export function getInterlinesForLeg2(
  fromCode: string,
  toStation: { lines: Line[] },
  toCode: string,
  plannedLine: Line
): Line[] | undefined {
  const validLines = getInterlinedLinesForLeg(plannedLine, toStation.lines, fromCode, toCode)
  return validLines.length > 0 ? validLines : undefined
}

/**
 * get a single terminus string from an array—car position service wants one value
 */
export function getTerminusString(terminus: string | string[]): string {
  if (Array.isArray(terminus)) {
    return terminus[0] || ''
  }
  return terminus
}
