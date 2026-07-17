import type { Line, Station, Transfer, EvaluatedRoute, TransferResult, TransferAlternative } from '@transferhero/shared'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'
import { TRANSFERS } from '../data/transfers.js'
import { LINE_STATIONS } from '../data/lineConfig.js'
import { PLATFORM_CODES, getPlatformForLine } from '../data/platformCodes.js'
import { calculateRouteTravelTime, getTerminus } from './travelTime.js'
import {
  areSamePhysicalStation,
  getDirectLinesForLeg,
  getInterlinedLinesForLeg,
  getPhysicalStationLines,
  lineCanServeLeg,
} from './lineHelpers.js'

/**
 * Default transfer walk time in minutes
 */
const DEFAULT_TRANSFER_WALK_TIME = 2

/** Avoid surfacing technically valid but wildly circuitous transfer choices. */
const MAX_ALTERNATIVE_TIME_DIFF = 20

/**
 * Find all possible transfer stations between origin and destination
 */
export function findAllPossibleTransfers(
  fromCode: string,
  toCode: string
): Transfer[] {
  const fromStation = findStationByCode(fromCode)
  const toStation = findStationByCode(toCode)
  if (!fromStation || !toStation) return []
  if (areSamePhysicalStation(fromCode, toCode)) return []

  const fromLines = getPhysicalStationLines(fromCode, fromStation.lines)
  const toLines = getPhysicalStationLines(toCode, toStation.lines)

  const transfers: Transfer[] = []
  const seen = new Set<string>()

  // Check each combination of lines
  for (const fromLine of fromLines) {
    for (const toLine of toLines) {
      // 1. Check explicit TRANSFERS object
      const key = `${fromLine}_${toLine}`
      const keyFT = `${fromLine}_${toLine}_FT`  // Fort Totten variant

      if (TRANSFERS[key]) {
        const transfer = TRANSFERS[key]
        const uniqueKey = `${transfer.station}_${transfer.fromPlatform}_${transfer.toPlatform}`
        if (
          lineCanServeLeg(fromLine, fromCode, transfer.fromPlatform)
          && lineCanServeLeg(toLine, transfer.toPlatform, toCode)
          && !seen.has(uniqueKey)
        ) {
          seen.add(uniqueKey)
          transfers.push({
            ...transfer,
            fromLine: fromLine,
            toLine: toLine
          })
        }
      }

      if (TRANSFERS[keyFT]) {
        const transfer = TRANSFERS[keyFT]
        const uniqueKey = `${transfer.station}_${transfer.fromPlatform}_${transfer.toPlatform}`
        if (
          lineCanServeLeg(fromLine, fromCode, transfer.fromPlatform)
          && lineCanServeLeg(toLine, transfer.toPlatform, toCode)
          && !seen.has(uniqueKey)
        ) {
          seen.add(uniqueKey)
          transfers.push({
            ...transfer,
            fromLine: fromLine,
            toLine: toLine
          })
        }
      }

      // 2. Check for implicit transfers at multi-line stations
      const fromLineStations = LINE_STATIONS[fromLine] || []
      const toLineStations = LINE_STATIONS[toLine] || []

      // Find stations that appear on both lines
      for (const stationCode of fromLineStations) {
        if (toLineStations.includes(stationCode)) {
          if (
            !lineCanServeLeg(fromLine, fromCode, stationCode)
            || !lineCanServeLeg(toLine, stationCode, toCode)
          ) continue

          // This station serves both lines - it's a valid transfer point
          const station = ALL_STATIONS.find(s =>
            s.code === stationCode ||
            (PLATFORM_CODES[s.code] && Object.values(PLATFORM_CODES[s.code]).includes(stationCode))
          )

          if (station && station.lines.includes(fromLine) && station.lines.includes(toLine)) {
            const fromPlatform = getPlatformForLine(station.code, fromLine)
            const toPlatform = getPlatformForLine(station.code, toLine)
            const uniqueKey = `${station.code}_${fromPlatform}_${toPlatform}`

            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey)
              transfers.push({
                station: station.code,
                name: station.name,
                fromPlatform: fromPlatform,
                toPlatform: toPlatform,
                fromLine: fromLine,
                toLine: toLine
              })
            }
          }
        }
      }
    }
  }

  return transfers
}

/**
 * Evaluate the total journey time for a specific transfer route
 */
export function evaluateTransferRoute(
  fromCode: string,
  toCode: string,
  transfer: Transfer,
  transferWalkTime: number = DEFAULT_TRANSFER_WALK_TIME
): EvaluatedRoute {
  // Calculate leg 1: from origin to transfer station
  const leg1Time = calculateRouteTravelTime(fromCode, transfer.fromPlatform, transfer.fromLine!)

  // Calculate leg 2: from transfer station to destination
  const leg2Time = calculateRouteTravelTime(transfer.toPlatform, toCode, transfer.toLine!)

  const totalTime = leg1Time + transferWalkTime + leg2Time

  return {
    transfer: transfer,
    leg1Time: leg1Time,
    transferTime: transferWalkTime,
    leg2Time: leg2Time,
    totalTime: totalTime
  }
}

/**
 * Find the optimal transfer point between two stations
 * Returns the fastest option with alternatives
 */
export function findTransfer(
  fromCode: string,
  toCode: string,
  transferWalkTime: number = DEFAULT_TRANSFER_WALK_TIME
): TransferResult | null {
  const fromStation = findStationByCode(fromCode)
  const toStation = findStationByCode(toCode)
  if (!fromStation || !toStation) return null
  if (areSamePhysicalStation(fromCode, toCode)) return null

  // Check for direct route
  const sharedLines = getDirectLinesForLeg(fromStation.lines, toStation.lines, fromCode, toCode)
  if (sharedLines.length > 0) {
    return {
      name: 'Direct (no transfer)',
      station: '',
      fromPlatform: '',
      toPlatform: '',
      direct: true,
      line: sharedLines[0]
    }
  }

  // Find all possible transfers
  const allTransfers = findAllPossibleTransfers(fromCode, toCode)

  // Evaluate each transfer option
  const evaluatedRoutes = allTransfers.map(transfer =>
    evaluateTransferRoute(fromCode, toCode, transfer, transferWalkTime)
  ).filter(route =>
    Number.isFinite(route.leg1Time)
    && Number.isFinite(route.leg2Time)
    && Number.isFinite(route.totalTime)
  )

  if (evaluatedRoutes.length === 0) return null

  // Sort by total time (fastest first)
  evaluatedRoutes.sort((a, b) => a.totalTime - b.totalTime)

  // Return fastest option
  const fastest = evaluatedRoutes[0]

  // Keep the fastest route, then reserve space for distinct line-pair
  // strategies before filling remaining slots by time. Otherwise several
  // transfer points on one shared trunk crowd out a genuinely different
  // boarding option (e.g. Blue/Rosslyn vs Yellow/L'Enfant from King St).
  const selectedRoutes: EvaluatedRoute[] = [fastest]
  const selectedSignatures = new Set([
    `${fastest.transfer.fromLine ?? ''}:${fastest.transfer.toLine ?? ''}`
  ])
  const eligibleAlternatives = evaluatedRoutes.slice(1).filter(route =>
    route.totalTime - fastest.totalTime <= MAX_ALTERNATIVE_TIME_DIFF
  )

  for (const route of eligibleAlternatives) {
    if (selectedRoutes.length >= 3) break
    const signature = `${route.transfer.fromLine ?? ''}:${route.transfer.toLine ?? ''}`
    if (selectedSignatures.has(signature)) continue
    selectedRoutes.push(route)
    selectedSignatures.add(signature)
  }

  for (const route of eligibleAlternatives) {
    if (selectedRoutes.length >= 3) break
    if (selectedRoutes.includes(route)) continue
    selectedRoutes.push(route)
  }

  selectedRoutes.sort((a, b) => a.totalTime - b.totalTime)

  const alternativesWithTimes: TransferAlternative[] = selectedRoutes.slice(1).map(r => ({
    ...r.transfer,
    totalTime: r.totalTime,
    leg1Time: r.leg1Time,
    leg2Time: r.leg2Time,
    timeDiff: r.totalTime - fastest.totalTime
  }))

  return {
    ...fastest.transfer,
    totalTime: fastest.totalTime,
    leg1Time: fastest.leg1Time,
    leg2Time: fastest.leg2Time,
    alternatives: alternativesWithTimes
  }
}

/**
 * Get all termini for a station based on which lines serve it
 */
export function getAllTerminiForStation(
  station: Station,
  fromPlatform: string,
  toStationCode: string,
  referenceLine?: Line
): string[] {
  const allTermini: string[] = []

  const candidateLines = referenceLine
    ? getInterlinedLinesForLeg(referenceLine, station.lines, fromPlatform, toStationCode)
    : getPhysicalStationLines(station.code, station.lines)
      .filter((line: Line) => lineCanServeLeg(line, fromPlatform, toStationCode))

  candidateLines.forEach((line: Line) => {
    const termini = getTerminus(line, fromPlatform, toStationCode)
    allTermini.push(...termini)
  })

  // Remove duplicates
  return [...new Set(allTermini)]
}
