/** Optimal DC Metro car recommendations based on DCMetroStationExits data. */

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

export interface Egress {
  x: number
  x2?: number
  type: 'escalator' | 'elevator' | 'stairs' | 'exit'
  y: number
  preferred: boolean
  exitLabel?: number
  description?: string
}

export interface Platform {
  level?: 'lower' | 'upper'
  lines: string[]
  track1Destinations: string[]
  track2Destinations: string[]
  platformType: 'island' | 'side' | 'terminus_wb' | 'terminus_eb' | 'gap_island'
  egresses: {
    track1: Egress[]
    track2: Egress[]
    shared: Egress[]
  }
}

export interface Station {
  name: string
  nameAlt?: string
  subtitle?: string
  platforms: Platform[]
  wmataCode?: string
  transfers?: Record<string, { x: number; description: string }>
}

export interface DoorRecommendation {
  car: number
  door: 1 | 2 | 3
  referenceCarCount: 8
  distance: number
  sourceX: number
}

export interface ExitOption {
  car: number
  position: 'front' | 'middle' | 'back'
  type: 'escalator' | 'elevator' | 'stairs' | 'exit'
  label: string
  description?: string
  xPosition?: number
  trainXPosition?: number
  doorRecommendation?: DoorRecommendation
  preferred?: boolean
  exitLabel?: number
}

export interface CarPosition {
  boardCar: number
  exitCar: number
  boardPosition: 'front' | 'middle' | 'back'
  legend: string
  confidence: 'high' | 'medium' | 'low'
  exits?: ExitOption[]
  allExits?: ExitOption[]
  platformMarkers?: ExitOption[]
  details?: {
    exitType?: string
    exitDescription?: string
    xPosition?: number
    trainXPosition?: number
    doorRecommendation?: DoorRecommendation
  }
}

export type TrackDirection = 'track1' | 'track2'

export interface TransferWayfinding {
  toPlatformLines: string[]
  levelInstruction: 'up one level' | 'down one level' | 'across the station'
}

interface StationData {
  stations: Record<string, Station>
  doorPositions: { car: number; positions: number[] }[]
  carBoundaries: number[]
}

let cachedData: StationData | null = null

let wmataCodeIndex: Map<string, Station> | null = null
let lowerNameIndex: Map<string, Station> | null = null
let trackDestsLower: WeakMap<Platform, { track1: string[]; track2: string[] }> | null = null

function loadStationData(): StationData {
  if (cachedData) return cachedData

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const jsonPath = join(__dirname, 'stationExits.json')
    const content = readFileSync(jsonPath, 'utf-8')
    cachedData = JSON.parse(content) as StationData
    console.log(`[CarPosition] Loaded ${Object.keys(cachedData.stations).length} stations`)

    wmataCodeIndex = new Map()
    lowerNameIndex = new Map()
    trackDestsLower = new WeakMap()
    for (const [name, station] of Object.entries(cachedData.stations)) {
      if (station.wmataCode) wmataCodeIndex.set(station.wmataCode, station)
      lowerNameIndex.set(name.toLowerCase(), station)
      if (station.nameAlt) lowerNameIndex.set(station.nameAlt.toLowerCase(), station)
      for (const platform of station.platforms) {
        trackDestsLower.set(platform, {
          track1: platform.track1Destinations.map(d => d.toLowerCase()),
          track2: platform.track2Destinations.map(d => d.toLowerCase()),
        })
      }
    }

    return cachedData
  } catch (error) {
    console.error('[CarPosition] Failed to load stationExits.json:', error)
    return {
      stations: {},
      doorPositions: [],
      carBoundaries: [9, 18, 27, 36, 45, 54, 63, 72]
    }
  }
}

function getData(): StationData {
  return cachedData ?? loadStationData()
}

// Physically distinct platform codes intentionally resolve to the shared station record.
const MULTI_LEVEL_CODE_MAP: Record<string, string> = {
  'A01': 'Metro Center',      // Red line (upper)
  'C01': 'Metro Center',      // BL/OR/SV (lower)
  'B01': 'Gallery Place',     // Red line (upper)
  'F01': 'Gallery Place',     // GR/YL (lower)
  'D03': "L'Enfant Plaza",    // BL/OR/SV (lower)
  'F03': "L'Enfant Plaza",    // GR/YL (upper)
  'B06': 'Fort Totten',       // Red line (upper)
  'E06': 'Fort Totten',       // GR (lower)
}

/** Get a station by name or WMATA code. */
export function getStation(nameOrCode: string): Station | null {
  const data = getData()
  if (data.stations[nameOrCode]) {
    return data.stations[nameOrCode]
  }

  if (MULTI_LEVEL_CODE_MAP[nameOrCode]) {
    const stationName = MULTI_LEVEL_CODE_MAP[nameOrCode]
    if (data.stations[stationName]) {
      return data.stations[stationName]
    }
  }

  const byWmata = wmataCodeIndex?.get(nameOrCode)
  if (byWmata) return byWmata

  const byLower = lowerNameIndex?.get(nameOrCode.toLowerCase())
  if (byLower) return byLower

  return null
}

/** Find the platform at a station that serves a given line. */
export function findPlatformForLine(station: Station, line: string): Platform | null {
  for (const platform of station.platforms) {
    if (platform.lines.includes(line)) {
      return platform
    }
  }
  return null
}

export function getTransferWayfinding(
  transferCode: string,
  incomingLine: string,
  outgoingLine: string
): TransferWayfinding {
  const station = getStation(transferCode)
  const incomingPlatform = station ? findPlatformForLine(station, incomingLine) : null
  const outgoingPlatform = station ? findPlatformForLine(station, outgoingLine) : null

  let levelInstruction: TransferWayfinding['levelInstruction'] = 'across the station'
  if (incomingPlatform?.level && outgoingPlatform?.level && incomingPlatform.level !== outgoingPlatform.level) {
    levelInstruction = outgoingPlatform.level === 'upper' ? 'up one level' : 'down one level'
  }

  return {
    toPlatformLines: outgoingPlatform?.lines ?? [outgoingLine],
    levelInstruction,
  }
}

/** Determine a train's track from its destination. */
export function getTrackDirection(platform: Platform, destination: string): TrackDirection {
  const destLower = destination.toLowerCase()
  const cached = trackDestsLower?.get(platform)

  const t1 = cached?.track1 ?? platform.track1Destinations
  const t2 = cached?.track2 ?? platform.track2Destinations

  for (const d of t1) {
    const dLower = cached ? d : d.toLowerCase()
    if (destLower.includes(dLower) || dLower.includes(destLower)) {
      return 'track1'
    }
  }

  for (const d of t2) {
    const dLower = cached ? d : d.toLowerCase()
    if (destLower.includes(dLower) || dLower.includes(destLower)) {
      return 'track2'
    }
  }

  return 'track1'
}

/** Convert x-position (light pair 1-72) to car number (1-8). */
export function xToCar(x: number): number {
  const data = getData()
  for (let i = 0; i < data.carBoundaries.length; i++) {
    if (x <= data.carBoundaries[i]) {
      return i + 1
    }
  }
  return 8
}

/** Find the closest door position to a given x coordinate. */
export function findClosestDoor(x: number): { car: number; door: 1 | 2 | 3; doorX: number; distance: number } {
  const data = getData()
  let closest: { car: number; door: 1 | 2 | 3; doorX: number; distance: number } = {
    car: 1,
    door: 1,
    doorX: 2.25,
    distance: Infinity,
  }

  for (const carDoors of data.doorPositions) {
    for (const [index, doorX] of carDoors.positions.entries()) {
      const distance = Math.abs(x - doorX)
      if (distance < closest.distance) {
        closest = {
          car: carDoors.car,
          door: (index + 1) as 1 | 2 | 3,
          doorX,
          distance,
        }
      }
    }
  }

  return closest
}

/** Return the nearest door in train orientation, mirroring cars and doors on track 2. */
export function getDoorRecommendation(x: number, track: TrackDirection): DoorRecommendation {
  const closest = findClosestDoor(x)
  return {
    car: track === 'track2' ? 9 - closest.car : closest.car,
    door: track === 'track2' ? (4 - closest.door) as 1 | 2 | 3 : closest.door,
    referenceCarCount: 8,
    distance: closest.distance,
    sourceX: x,
  }
}

/** Get a human-readable position in the train. */
function getPositionDescription(car: number): 'front' | 'middle' | 'back' {
  if (car <= 2) return 'front'
  if (car >= 7) return 'back'
  return 'middle'
}

/** Adjust the car number because track 2 trains face the opposite direction. */
export function adjustCarForTrack(car: number, track: TrackDirection): number {
  if (track === 'track2') {
    return 9 - car // Flip: 1→8, 2→7, 3→6, etc.
  }
  return car
}

/** Convert a platform coordinate into the arriving train's front-to-back frame. */
export function toTrainXPosition(x: number, track: TrackDirection): number {
  return track === 'track2' ? 72 - x : x
}

function buildFallbackCarPosition(): CarPosition {
  return {
    boardCar: 4,
    exitCar: 4,
    boardPosition: 'middle',
    legend: 'Board middle of train',
    confidence: 'low',
  }
}

function resolveCarDetails(
  x: number,
  track: TrackDirection,
  exitType?: string,
  exitDescription?: string,
): { car: number; details: NonNullable<CarPosition['details']> } {
  const doorRecommendation = getDoorRecommendation(x, track)
  return {
    car: doorRecommendation.car,
    details: {
      exitType,
      exitDescription,
      xPosition: x,
      trainXPosition: toTrainXPosition(x, track),
      doorRecommendation,
    },
  }
}

/** Build a leg-1 transfer legend, flagging elevator transfers. */
function buildTransferLegend(car: number, outgoingLine: string, exitType?: Egress['type']): string {
  if (exitType === 'elevator') {
    return `Board car ${car} for elevator transfer to ${outgoingLine} line`
  }
  return `Board car ${car} for quick transfer to ${outgoingLine} line`
}

function inferEgressType(description: string): Egress['type'] {
  if (/elevator/i.test(description)) return 'elevator'
  if (/stairs?/i.test(description)) return 'stairs'
  if (/exit/i.test(description)) return 'exit'
  return 'escalator'
}

/** Get a platform's egresses for the supplied track direction. */
function getEgressesForTrack(platform: Platform, track: TrackDirection): Egress[] {
  if (platform.platformType === 'island' || platform.platformType.startsWith('terminus')) {
    return platform.egresses.shared
  }
  
  const trackEgresses = track === 'track1' ? platform.egresses.track1 : platform.egresses.track2
  return trackEgresses.length > 0 ? trackEgresses : platform.egresses.shared
}

/** Prefer elevators in accessible mode; otherwise omit them. */
function filterEgressesByAccessibility(egresses: Egress[], accessible: boolean): Egress[] {
  if (accessible) {
    const elevators = egresses.filter(e => e.type === 'elevator')
    return elevators.length > 0 ? elevators : egresses
  }
  return egresses.filter(e => e.type !== 'elevator')
}

/** Find the best egress, honoring preferred status, type preference, and accessibility. */
function findBestEgress(egresses: Egress[], accessible: boolean = false, preferType?: Egress['type']): Egress | null {
  const filtered = filterEgressesByAccessibility(egresses, accessible)
  if (filtered.length === 0) return null

  const preferred = filtered.find(e => e.preferred)
  if (preferred && (!preferType || preferred.type === preferType)) {
    return preferred
  }

  if (preferType) {
    const ofType = filtered.find(e => e.type === preferType)
    if (ofType) return ofType
  }

  const priority: Egress['type'][] = accessible 
    ? ['elevator', 'escalator', 'stairs', 'exit']
    : ['escalator', 'stairs', 'exit', 'elevator']
  for (const type of priority) {
    const egress = filtered.find(e => e.type === type)
    if (egress) return egress
  }

  return filtered[0]
}

/** Build a compact "{type} {street}" exit label. */
function buildExitLabel(egress: Egress): string {
  let desc = egress.description || ''

  desc = desc
    .replace(/,?\s*Elevator to Platform( Only)?/gi, '')
    .replace(/,?\s*Elevator to Platform & Street/gi, '')
    .replace(/,?\s*Escalators?/gi, '')
    .replace(/,?\s*Stairs/gi, '')
    .trim()

  desc = desc.replace(/,\s*$/, '').trim()

  const typeAbbrev: Record<string, string> = {
    escalator: 'Esc.',
    elevator: 'Elev.',
    stairs: 'Stairs',
    exit: 'Exit',
  }
  const typeLabel = typeAbbrev[egress.type] || egress.type.charAt(0).toUpperCase() + egress.type.slice(1)

  if (desc) {
    return `${typeLabel} ${desc}`
  }

  return egress.type.charAt(0).toUpperCase() + egress.type.slice(1)
}

/**
 * Get all valid exits for a destination (used for direct trips and leg2).
 * The complete set is retained so an exact mapped destination exit cannot be
 * discarded merely because another egress shares its car.
 */
function getAllValidExits(
  egresses: Egress[],
  track: TrackDirection,
  accessible: boolean
): ExitOption[] {
  const filtered = filterEgressesByAccessibility(egresses, accessible)

  return filtered.map((egress) => buildExitOption(egress, track))
}

function buildExitOption(egress: Egress, track: TrackDirection): ExitOption {
  const doorRecommendation = getDoorRecommendation(egress.x, track)
  return {
    car: doorRecommendation.car,
    position: getPositionDescription(doorRecommendation.car),
    type: egress.type,
    label: buildExitLabel(egress),
    description: egress.description,
    xPosition: egress.x,
    trainXPosition: toTrainXPosition(egress.x, track),
    doorRecommendation,
    preferred: egress.preferred,
    exitLabel: egress.exitLabel,
  }
}

/**
 * Physical platform context is deliberately not accessibility-filtered: the
 * diagram should show elevators, escalators, stairs, and street exits even
 * when one mode is preferred for the actual recommendation.
 */
function getPlatformMarkers(egresses: Egress[], track: TrackDirection): ExitOption[] {
  return egresses.map((egress) => buildExitOption(egress, track))
}

/** Keep the classic compact exit list while the full list remains available for exact matching. */
function dedupeExitOptionsByCar(exits: ExitOption[]): ExitOption[] {

  // Priority: escalator > stairs > exit > elevator (for speed)
  // For accessible mode, elevator would already be prioritized by filterEgressesByAccessibility
  const typePriority: Record<Egress['type'], number> = {
    escalator: 1,
    stairs: 2,
    exit: 3,
    elevator: 4,
  }

  // Group by car and pick the best exit per car
  const exitsByCar = new Map<number, ExitOption>()

  for (const exit of exits) {
    const existing = exitsByCar.get(exit.car)
    if (!existing) {
      exitsByCar.set(exit.car, exit)
    } else {
      // Keep the better exit: preferred wins, otherwise compare by type priority
      const existingPriority = typePriority[existing.type]
      const newPriority = typePriority[exit.type]

      if (exit.preferred && !existing.preferred) {
        exitsByCar.set(exit.car, exit)
      } else if (!existing.preferred && newPriority < existingPriority) {
        exitsByCar.set(exit.car, exit)
      }
    }
  }

  return Array.from(exitsByCar.values())
}

/**
 * Find egress that leads to a connecting platform (for transfers)
 * @param outgoingDestination - Terminus of the outgoing train (for direction-specific matching)
 * @param accessible - When true, prefer elevator egresses
 */
function findTransferEgress(
  platform: Platform, 
  track: TrackDirection,
  targetLines: string[],
  outgoingDestination?: string,
  accessible: boolean = false
): Egress | null {
  const egresses = getEgressesForTrack(platform, track)
  const filtered = filterEgressesByAccessibility(egresses, accessible)
  
  // First, try to find direction-specific egress (e.g., "RD Trains to Glenmont")
  if (outgoingDestination) {
    for (const egress of filtered) {
      if (egress.description) {
        const desc = egress.description.toLowerCase()
        const destLower = outgoingDestination.toLowerCase()
        // Check for direction-specific match like "RD Trains to Glenmont"
        if (desc.includes(destLower) || desc.includes(`to ${destLower}`)) {
          return egress
        }
      }
    }
  }
  
  // Fall back to line-only match
  for (const egress of filtered) {
    if (egress.description) {
      const desc = egress.description.toLowerCase()
      for (const line of targetLines) {
        // Check for line mentions like "RD Trains" or "BL/OR/SV"
        if (desc.includes(line.toLowerCase()) || desc.includes(`${line.toLowerCase()} trains`)) {
          return egress
        }
      }
      // Also check for "opposite platform" or similar
      if (desc.includes('platform') && !desc.includes('street')) {
        return egress
      }
    }
  }
  
  // Fall back to best egress
  return findBestEgress(egresses, accessible)
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get car position for a direct (non-transfer) trip
 * @param accessible - When true, prioritize elevator exits
 */
export function getDirectTripCarPosition(
  destinationCode: string,
  line: string,
  trainDestination: string,
  accessible: boolean = false
): CarPosition {
  const station = getStation(destinationCode)
  if (!station) return buildFallbackCarPosition()

  const platform = findPlatformForLine(station, line)
  if (!platform) return buildFallbackCarPosition()

  const track = getTrackDirection(platform, trainDestination)
  const egresses = getEgressesForTrack(platform, track)
  const bestEgress = findBestEgress(egresses, accessible)

  if (!bestEgress) return buildFallbackCarPosition()

  const resolved = resolveCarDetails(bestEgress.x, track, bestEgress.type, bestEgress.description)
  const adjustedCar = resolved.car

  // Get all valid exits for destinations
  const allExits = getAllValidExits(egresses, track, accessible)
  const exits = dedupeExitOptionsByCar(allExits)
  const platformMarkers = getPlatformMarkers(egresses, track)

  return {
    boardCar: adjustedCar,
    exitCar: adjustedCar,
    boardPosition: getPositionDescription(adjustedCar),
    legend: `Board car ${adjustedCar} for quick exit at ${station.name}`,
    confidence: 'high',
    exits,
    allExits,
    platformMarkers,
    details: resolved.details,
  }
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
 * @param accessible - When true, prioritize elevator exits
 */
export function getTransferCarPosition(
  transferCode: string,
  incomingLine: string,
  outgoingLine: string,
  incomingDestination: string,
  destinationCode: string,
  finalDestination: string,
  accessible: boolean = false
): { leg1: CarPosition; leg2: CarPosition } {
  const transferStation = getStation(transferCode)
  const destStation = getStation(destinationCode)

  const fallback = buildFallbackCarPosition()

  if (!transferStation) {
    return { leg1: fallback, leg2: fallback }
  }

  // Find platforms
  const inPlatform = findPlatformForLine(transferStation, incomingLine)
  const outPlatform = findPlatformForLine(transferStation, outgoingLine)

  if (!inPlatform || !outPlatform) {
    return { leg1: fallback, leg2: fallback }
  }

  const inTrack = getTrackDirection(inPlatform, incomingDestination)
  const leg1PlatformMarkers = getPlatformMarkers(getEgressesForTrack(inPlatform, inTrack), inTrack)

  // Accessible mode: try to use an elevator-based egress even if an explicit transfer mapping exists
  const accessibleTransferEgress = accessible
    ? findTransferEgress(inPlatform, inTrack, [outgoingLine], finalDestination, true)
    : null

  // Calculate Leg 1 board car (to optimize transfer)
  let leg1Car: number
  let leg1Legend: string
  let leg1Confidence: CarPosition['confidence'] = 'high'
  let leg1Details: CarPosition['details']

  // Check for explicit transfer mapping first - try direction-specific key, then fallback
  const directionKey = `${incomingLine}_to_${outgoingLine}_${finalDestination}`
  const fallbackKey = `${incomingLine}_to_${outgoingLine}`
  const explicitTransfer = transferStation.transfers?.[directionKey] 
                        || transferStation.transfers?.[fallbackKey]

  if (accessibleTransferEgress) {
    const resolved = resolveCarDetails(
      accessibleTransferEgress.x, inTrack, accessibleTransferEgress.type, accessibleTransferEgress.description,
    )
    leg1Car = resolved.car
    leg1Legend = buildTransferLegend(leg1Car, outgoingLine, accessibleTransferEgress.type)
    leg1Details = resolved.details
  } else if (explicitTransfer) {
    const resolved = resolveCarDetails(
      explicitTransfer.x, inTrack, inferEgressType(explicitTransfer.description), explicitTransfer.description,
    )
    leg1Car = resolved.car
    leg1Legend = `Board car ${leg1Car} for ${explicitTransfer.description}`
    leg1Details = resolved.details
  } else if (inPlatform === outPlatform) {
    // Same platform - cross-platform transfer, just stay put
    leg1Car = 4
    leg1Legend = 'Cross-platform transfer - any car works'
    leg1Confidence = 'medium'
  } else {
    // Different platforms - find the egress to the other platform
    // Pass finalDestination for direction-aware matching
    const transferEgress = findTransferEgress(inPlatform, inTrack, [outgoingLine], finalDestination, accessible)
    if (transferEgress) {
      const resolved = resolveCarDetails(transferEgress.x, inTrack, transferEgress.type, transferEgress.description)
      leg1Car = resolved.car
      leg1Legend = buildTransferLegend(leg1Car, outgoingLine, transferEgress.type)
      leg1Details = resolved.details
    } else {
      leg1Car = 4
      leg1Legend = `Board middle of train for transfer at ${transferStation.name}`
      leg1Confidence = 'medium'
    }
  }

  // Calculate Leg 2 exit car (to optimize final exit)
  let leg2Car = leg1Car
  let leg2Legend = leg1Legend
  let leg2Confidence: CarPosition['confidence'] = 'medium'
  let leg2Details: CarPosition['details']
  let leg2Exits: ExitOption[] | undefined
  let leg2PlatformMarkers: ExitOption[] | undefined

  if (destStation) {
    const destPlatform = findPlatformForLine(destStation, outgoingLine)
    if (destPlatform) {
      const destTrack = getTrackDirection(destPlatform, finalDestination)
      const destEgresses = getEgressesForTrack(destPlatform, destTrack)
      const destEgress = findBestEgress(destEgresses, accessible)
      leg2PlatformMarkers = getPlatformMarkers(destEgresses, destTrack)

      if (destEgress) {
        const resolved = resolveCarDetails(destEgress.x, destTrack, destEgress.type, destEgress.description)
        leg2Car = resolved.car
        leg2Legend = `Exit car ${leg2Car} at ${destStation.name}`
        leg2Confidence = 'high'
        leg2Details = resolved.details
        // Get all valid exits for leg2 destination (preferred status preserved from source)
        leg2Exits = getAllValidExits(destEgresses, destTrack, accessible)
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
      platformMarkers: leg1PlatformMarkers,
    },
    leg2: {
      boardCar: leg2Car,
      exitCar: leg2Car,
      boardPosition: getPositionDescription(leg2Car),
      legend: leg2Legend,
      confidence: leg2Confidence,
      details: leg2Details,
      exits: leg2Exits ? dedupeExitOptionsByCar(leg2Exits) : undefined,
      allExits: leg2Exits,
      platformMarkers: leg2PlatformMarkers,
    },
  }
}

/**
 * Get all stations (for debugging/admin)
 */
export function getAllStations(): Station[] {
  return Object.values(getData().stations)
}

/**
 * Get station names mapped to WMATA codes
 */
export function getStationCodeMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const station of Object.values(getData().stations)) {
    if (station.wmataCode) {
      map[station.name] = station.wmataCode
    }
  }
  return map
}
