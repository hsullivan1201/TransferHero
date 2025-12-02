/**
 * Car Position Service
 * 
 * Provides optimal car recommendations for DC Metro trips based on exit locations.
 * Uses data from DCMetroStationExits dataset.
 */

import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// ============================================================================
// Types
// ============================================================================

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

export interface ExitOption {
  car: number
  position: 'front' | 'middle' | 'back'
  type: 'escalator' | 'elevator' | 'stairs' | 'exit'
  label: string
  description?: string
  xPosition?: number
}

export interface CarPosition {
  boardCar: number
  exitCar: number
  boardPosition: 'front' | 'middle' | 'back'
  legend: string
  confidence: 'high' | 'medium' | 'low'
  exits?: ExitOption[]
  details?: {
    exitType?: string
    exitDescription?: string
    xPosition?: number
  }
}

export type TrackDirection = 'track1' | 'track2'

// ============================================================================
// Data Loading
// ============================================================================

interface StationData {
  stations: Record<string, Station>
  doorPositions: { car: number; positions: number[] }[]
  carBoundaries: number[]
}

let cachedData: StationData | null = null

function loadStationData(): StationData {
  if (cachedData) return cachedData
  
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const jsonPath = join(__dirname, 'stationExits.json')
    const content = readFileSync(jsonPath, 'utf-8')
    cachedData = JSON.parse(content) as StationData
    console.log(`[CarPosition] Loaded ${Object.keys(cachedData.stations).length} stations`)
    return cachedData
  } catch (error) {
    console.error('[CarPosition] Failed to load stationExits.json:', error)
    // Return empty data structure
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

// Additional WMATA code mappings for multi-level stations
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

/**
 * Get station by name or WMATA code
 */
export function getStation(nameOrCode: string): Station | null {
  const data = getData()
  
  // Try direct name lookup first
  if (data.stations[nameOrCode]) {
    return data.stations[nameOrCode]
  }

  // Check multi-level code map
  if (MULTI_LEVEL_CODE_MAP[nameOrCode]) {
    const stationName = MULTI_LEVEL_CODE_MAP[nameOrCode]
    if (data.stations[stationName]) {
      return data.stations[stationName]
    }
  }

  // Try to find by WMATA code
  for (const station of Object.values(data.stations)) {
    if (station.wmataCode === nameOrCode) {
      return station
    }
  }

  // Try case-insensitive name match
  const lowerName = nameOrCode.toLowerCase()
  for (const [name, station] of Object.entries(data.stations)) {
    if (name.toLowerCase() === lowerName || station.nameAlt?.toLowerCase() === lowerName) {
      return station
    }
  }

  return null
}

/**
 * Find the platform at a station that serves a given line
 */
export function findPlatformForLine(station: Station, line: string): Platform | null {
  for (const platform of station.platforms) {
    if (platform.lines.includes(line)) {
      return platform
    }
  }
  return null
}

/**
 * Determine which track a train is on based on its destination
 */
export function getTrackDirection(platform: Platform, destination: string): TrackDirection {
  const destLower = destination.toLowerCase()
  
  // Check track1 destinations
  for (const d of platform.track1Destinations) {
    if (destLower.includes(d.toLowerCase()) || d.toLowerCase().includes(destLower)) {
      return 'track1'
    }
  }
  
  // Check track2 destinations
  for (const d of platform.track2Destinations) {
    if (destLower.includes(d.toLowerCase()) || d.toLowerCase().includes(destLower)) {
      return 'track2'
    }
  }
  
  // Default to track1 if we can't determine
  return 'track1'
}

// ============================================================================
// Car Calculation
// ============================================================================

/**
 * Convert x-position (light pair 1-72) to car number (1-8)
 */
export function xToCar(x: number): number {
  const data = getData()
  for (let i = 0; i < data.carBoundaries.length; i++) {
    if (x <= data.carBoundaries[i]) {
      return i + 1
    }
  }
  return 8
}

/**
 * Find the closest door position to a given x coordinate
 */
export function findClosestDoor(x: number): { car: number; doorX: number; distance: number } {
  const data = getData()
  let closest = { car: 1, doorX: 2.25, distance: Infinity }

  for (const carDoors of data.doorPositions) {
    for (const doorX of carDoors.positions) {
      const distance = Math.abs(x - doorX)
      if (distance < closest.distance) {
        closest = { car: carDoors.car, doorX, distance }
      }
    }
  }

  return closest
}

/**
 * Get human-readable position in train
 */
function getPositionDescription(car: number): 'front' | 'middle' | 'back' {
  if (car <= 2) return 'front'
  if (car >= 7) return 'back'
  return 'middle'
}

/**
 * Adjust car number for track direction
 * Track 2 trains are oriented opposite to Track 1
 */
export function adjustCarForTrack(car: number, track: TrackDirection): number {
  if (track === 'track2') {
    return 9 - car // Flip: 1→8, 2→7, 3→6, etc.
  }
  return car
}

/**
 * Get egresses for a platform based on track direction
 */
function getEgressesForTrack(platform: Platform, track: TrackDirection): Egress[] {
  if (platform.platformType === 'island' || platform.platformType.startsWith('terminus')) {
    return platform.egresses.shared
  }
  
  // Side or gap island platforms have separate egresses per track
  const trackEgresses = track === 'track1' ? platform.egresses.track1 : platform.egresses.track2
  return trackEgresses.length > 0 ? trackEgresses : platform.egresses.shared
}

/**
 * Filter egresses based on accessibility mode
 * When accessible=false, filter out elevators
 * When accessible=true, prioritize elevators
 */
function filterEgressesByAccessibility(egresses: Egress[], accessible: boolean): Egress[] {
  if (accessible) {
    // Accessible mode: prioritize elevators, but include all if no elevators
    const elevators = egresses.filter(e => e.type === 'elevator')
    return elevators.length > 0 ? elevators : egresses
  }
  // Non-accessible mode: filter out elevators
  return egresses.filter(e => e.type !== 'elevator')
}

/**
 * Find the best egress from a list
 * Prioritizes: preferred > escalator > stairs > exit > elevator
 * @param accessible - When true, prioritize elevators; when false, filter them out
 */
function findBestEgress(egresses: Egress[], accessible: boolean = false, preferType?: Egress['type']): Egress | null {
  const filtered = filterEgressesByAccessibility(egresses, accessible)
  if (filtered.length === 0) return null

  // First check for preferred egress
  const preferred = filtered.find(e => e.preferred)
  if (preferred && (!preferType || preferred.type === preferType)) {
    return preferred
  }

  // If specific type requested, try to find it
  if (preferType) {
    const ofType = filtered.find(e => e.type === preferType)
    if (ofType) return ofType
  }

  // Priority order for speed: escalator > stairs > exit > elevator
  const priority: Egress['type'][] = accessible 
    ? ['elevator', 'escalator', 'stairs', 'exit']
    : ['escalator', 'stairs', 'exit', 'elevator']
  for (const type of priority) {
    const egress = filtered.find(e => e.type === type)
    if (egress) return egress
  }

  return filtered[0]
}

/**
 * Build a label for an exit from exitLabel and description
 */
function buildExitLabel(egress: Egress): string {
  if (egress.exitLabel && egress.description) {
    return `Exit ${egress.exitLabel}: ${egress.description}`
  }
  if (egress.exitLabel) {
    return `Exit ${egress.exitLabel}`
  }
  if (egress.description) {
    return egress.description
  }
  // Fallback: use type
  return egress.type.charAt(0).toUpperCase() + egress.type.slice(1)
}

/**
 * Get all valid exits for a destination (used for direct trips and leg2)
 * Returns an array of labeled exit options with preferred status from source data
 */
function getAllValidExits(
  egresses: Egress[],
  track: TrackDirection,
  accessible: boolean
): ExitOption[] {
  const filtered = filterEgressesByAccessibility(egresses, accessible)
  
  return filtered.map(egress => {
    const rawCar = xToCar(egress.x)
    const adjustedCar = adjustCarForTrack(rawCar, track)
    return {
      car: adjustedCar,
      position: getPositionDescription(adjustedCar),
      type: egress.type,
      label: buildExitLabel(egress),
      description: egress.description,
      xPosition: egress.x,
      preferred: egress.preferred,
    }
  })
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
  if (!station) {
    return {
      boardCar: 4,
      exitCar: 4,
      boardPosition: 'middle',
      legend: 'Board middle of train',
      confidence: 'low',
    }
  }

  const platform = findPlatformForLine(station, line)
  if (!platform) {
    return {
      boardCar: 4,
      exitCar: 4,
      boardPosition: 'middle',
      legend: 'Board middle of train',
      confidence: 'low',
    }
  }

  const track = getTrackDirection(platform, trainDestination)
  const egresses = getEgressesForTrack(platform, track)
  const bestEgress = findBestEgress(egresses, accessible)

  if (!bestEgress) {
    return {
      boardCar: 4,
      exitCar: 4,
      boardPosition: 'middle',
      legend: 'Board middle of train',
      confidence: 'low',
    }
  }

  const rawCar = xToCar(bestEgress.x)
  const adjustedCar = adjustCarForTrack(rawCar, track)

  // Get all valid exits for destinations
  const exits = getAllValidExits(egresses, track, accessible)
  // getAllValidExits already preserves preferred status from source data

  return {
    boardCar: adjustedCar,
    exitCar: adjustedCar,
    boardPosition: getPositionDescription(adjustedCar),
    legend: `Board car ${adjustedCar} for quick exit at ${station.name}`,
    confidence: 'high',
    exits,
    details: {
      exitType: bestEgress.type,
      exitDescription: bestEgress.description,
      xPosition: bestEgress.x,
    },
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

  // Default fallback
  const fallback: CarPosition = {
    boardCar: 4,
    exitCar: 4,
    boardPosition: 'middle',
    legend: 'Board middle of train',
    confidence: 'low',
  }

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
  const outTrack = getTrackDirection(outPlatform, finalDestination)

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

  if (explicitTransfer) {
    // Use the explicit transfer mapping
    const rawCar = xToCar(explicitTransfer.x)
    leg1Car = adjustCarForTrack(rawCar, inTrack)
    leg1Legend = `Board car ${leg1Car} for ${explicitTransfer.description}`
    leg1Details = {
      exitDescription: explicitTransfer.description,
      xPosition: explicitTransfer.x,
    }
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
      const rawCar = xToCar(transferEgress.x)
      leg1Car = adjustCarForTrack(rawCar, inTrack)
      leg1Legend = `Board car ${leg1Car} for quick transfer to ${outgoingLine} line`
      leg1Details = {
        exitType: transferEgress.type,
        exitDescription: transferEgress.description,
        xPosition: transferEgress.x,
      }
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

  if (destStation) {
    const destPlatform = findPlatformForLine(destStation, outgoingLine)
    if (destPlatform) {
      const destTrack = getTrackDirection(destPlatform, finalDestination)
      const destEgresses = getEgressesForTrack(destPlatform, destTrack)
      const destEgress = findBestEgress(destEgresses, accessible)

      if (destEgress) {
        const rawCar = xToCar(destEgress.x)
        leg2Car = adjustCarForTrack(rawCar, destTrack)
        leg2Legend = `Exit car ${leg2Car} at ${destStation.name}`
        leg2Confidence = 'high'
        leg2Details = {
          exitType: destEgress.type,
          exitDescription: destEgress.description,
          xPosition: destEgress.x,
        }
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
      // leg1 does NOT get exits array - single preferred position only
    },
    leg2: {
      boardCar: leg2Car,
      exitCar: leg2Car,
      boardPosition: getPositionDescription(leg2Car),
      legend: leg2Legend,
      confidence: leg2Confidence,
      details: leg2Details,
      exits: leg2Exits,
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