/**
 * Process DCMetroStationExits CSV data into JSON format for TransferHero
 * 
 * Data source: https://github.com/eable2/DCMetroStationExits
 */

import { readFileSync, writeFileSync } from 'fs'
import { parse } from 'csv-parse/sync'

// ============================================================================
// Types
// ============================================================================

interface RawStation {
  nameStd: string
  nameAlt: string
  subtitile: string
  hasRD: string
  hasGR: string
  hasYL: string
  hasBL: string
  hasOR: string
  hasSV: string
  platformType: string
  WBDir: string
  EBDir: string
  compassN: string
}

interface RawEgress {
  nameStd: string
  icon: string
  y: string
  x: string
  dir: string
  zDir: string
  pref: string
  x2: string
  exitLabel: string
  group: string
}

interface RawExit {
  nameStd: string
  exitLabel: string
  description: string
}

interface RawDoor {
  Car: string
  x: string
}

// Output types
interface Egress {
  x: number
  x2?: number
  type: 'escalator' | 'elevator' | 'stairs' | 'exit'
  y: number
  preferred: boolean
  exitLabel?: number
  description?: string
}

interface Platform {
  level?: 'lower' | 'upper'
  lines: string[]
  track1Destinations: string[]  // "Westbound" / front of diagram
  track2Destinations: string[]  // "Eastbound" / back of diagram
  platformType: 'island' | 'side' | 'terminus_wb' | 'terminus_eb' | 'gap_island'
  egresses: {
    track1: Egress[]  // For side/gap platforms: egresses for track 1
    track2: Egress[]  // For side/gap platforms: egresses for track 2
    shared: Egress[]  // For island platforms: shared egresses
  }
}

interface Station {
  name: string
  nameAlt?: string
  subtitle?: string
  platforms: Platform[]
  wmataCode?: string
  transfers?: Record<string, { x: number; description: string }>
}

interface DoorPosition {
  car: number
  positions: number[]
}

interface OutputData {
  stations: Record<string, Station>
  doorPositions: DoorPosition[]
  carBoundaries: number[]  // x values where each car ends
}

// ============================================================================
// WMATA Station Code Mapping
// ============================================================================

// Map from dataset station names to WMATA station codes
const WMATA_CODES: Record<string, string> = {
  'Addison Road': 'G03',
  'Anacostia': 'F06',
  'Archives': 'F02',
  'Arlington Cemetery': 'C06',
  'Ashburn': 'N12',
  'Ballston-MU': 'K04',
  'Benning Road': 'G01',
  'Bethesda': 'A09',
  'Braddock Road': 'C12',
  'Branch Avenue': 'F11',
  'Brookland-CUA': 'B05',
  'Capitol Heights': 'G02',
  'Capitol South': 'D05',
  'Cheverly': 'D11',
  'Clarendon': 'K02',
  'Cleveland Park': 'A05',
  'College Park-U of Md': 'E09',
  'Columbia Heights': 'E04',
  'Congress Heights': 'F07',
  'Court House': 'K01',
  'Crystal City': 'C09',
  'Deanwood': 'D10',
  'Downtown Largo': 'G05',
  'Dunn Loring': 'K07',
  'Dupont Circle': 'A03',
  'East Falls Church': 'K05',
  'Eastern Market': 'D06',
  'Eisenhower Avenue': 'C14',
  'Farragut North': 'A02',
  'Farragut West': 'C03',
  'Federal Center SW': 'D04',
  'Federal Triangle': 'D01',
  'Foggy Bottom-GWU': 'C04',
  'Forest Glen': 'B09',
  'Fort Totten (Lower Level)': 'E06',  // Green/Yellow
  'Fort Totten (Upper Level)': 'B06',  // Red
  'Franconia-Springfield': 'J03',
  'Friendship Heights': 'A08',
  'Gallery Place (Lower Level)': 'F01',  // Green/Yellow
  'Gallery Place (Upper Level)': 'B01',  // Red
  'Georgia Avenue-Petworth': 'E05',
  'Glenmont': 'B11',
  'Greenbelt': 'E10',
  'Greensboro': 'N03',
  'Grosvenor-Strathmore': 'A11',
  'Herndon': 'N08',
  'Huntington': 'C15',
  'Hyattsville Crossing': 'E08',
  'Innovation Center': 'N09',
  'Judiciary Square': 'B02',
  'King Street-Old Town': 'C13',
  'L\'Enfant Plaza (Lower Level)': 'D03',  // Blue/Orange/Silver
  'L\'Enfant Plaza (Upper Level)': 'F03',  // Green/Yellow
  'Landover': 'D12',
  'Loudoun Gateway': 'N11',
  'McLean': 'N01',
  'McPherson Square': 'C02',
  'Medical Center': 'A10',
  'Metro Center (Lower Level)': 'C01',  // Blue/Orange/Silver
  'Metro Center (Upper Level)': 'A01',  // Red
  'Minnesota Avenue': 'D09',
  'Morgan Boulevard': 'G04',
  'Mount Vernon Square': 'E01',
  'Navy Yard-Ballpark': 'F05',
  'Naylor Road': 'F09',
  'New Carrollton': 'D13',
  'NoMa-Gallaudet U': 'B35',
  'North Bethesda': 'A12',
  'Pentagon': 'C07',
  'Pentagon City': 'C08',
  'Potomac Avenue': 'D07',
  'Potomac Yard': 'C11',
  'Reston Town Center': 'N07',
  'Rhode Island Avenue': 'B04',
  'Rockville': 'A14',
  'Rosslyn': 'C05',
  'Shady Grove': 'A15',
  'Shaw-Howard U': 'E02',
  'Silver Spring': 'B08',
  'Smithsonian': 'D02',
  'Southern Avenue': 'F08',
  'Spring Hill': 'N04',
  'Stadium-Armory': 'D08',
  'Suitland': 'F10',
  'Takoma': 'B07',
  'Tenleytown-AU': 'A07',
  'Twinbrook': 'A13',
  'Tysons': 'N02',
  'U Street': 'E03',
  'Union Station': 'B03',
  'Van Dorn Street': 'J02',
  'Van Ness-UDC': 'A06',
  'Vienna': 'K08',
  'Virginia Square-GMU': 'K03',
  'Washington Dulles International Airport': 'N10',
  'Washington National Airport': 'C10',
  'Waterfront': 'F04',
  'West Falls Church': 'K06',
  'West Hyattsville': 'E07',
  'Wheaton': 'B10',
  'Wiehle-Reston East': 'N06',
  'Woodley Park': 'A04',
}

// ============================================================================
// Parsing Functions
// ============================================================================

function parseCSV<T>(filePath: string): T[] {
  const content = readFileSync(filePath, 'utf-8')
  // Handle Windows line endings
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  return parse(normalized, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as T[]
}

function parseIconType(icon: string): 'escalator' | 'elevator' | 'stairs' | 'exit' {
  switch (icon) {
    case 'esc': return 'escalator'
    case 'el': return 'elevator'
    case 'stair': return 'stairs'
    case 'exit': return 'exit'
    default: return 'exit'
  }
}

function parsePlatformType(type: string): Platform['platformType'] {
  switch (type) {
    case 'Island': return 'island'
    case 'Side': return 'side'
    case 'Terminus WB': return 'terminus_wb'
    case 'Terminus EB': return 'terminus_eb'
    case 'Gap Island': return 'gap_island'
    default: return 'island'
  }
}

function parseLines(station: RawStation): string[] {
  const lines: string[] = []
  if (station.hasRD === 'TRUE') lines.push('RD')
  if (station.hasGR === 'TRUE') lines.push('GR')
  if (station.hasYL === 'TRUE') lines.push('YL')
  if (station.hasBL === 'TRUE') lines.push('BL')
  if (station.hasOR === 'TRUE') lines.push('OR')
  if (station.hasSV === 'TRUE') lines.push('SV')
  return lines
}

function parseDestinations(dirStr: string): string[] {
  if (!dirStr) return []
  return dirStr.split('/').map(d => d.trim())
}

// ============================================================================
// Processing Functions
// ============================================================================

function processData(
  stations: RawStation[],
  egresses: RawEgress[],
  exits: RawExit[],
  doors: RawDoor[]
): OutputData {
  // Build exit descriptions lookup
  const exitDescriptions: Record<string, Record<number, string>> = {}
  for (const exit of exits) {
    if (!exitDescriptions[exit.nameStd]) {
      exitDescriptions[exit.nameStd] = {}
    }
    exitDescriptions[exit.nameStd][parseInt(exit.exitLabel)] = exit.description
  }

  // Build door positions
  const doorPositions: DoorPosition[] = []
  const doorsBycar: Record<number, number[]> = {}
  for (const door of doors) {
    const car = parseInt(door.Car)
    if (!doorsBycar[car]) doorsBycar[car] = []
    doorsBycar[car].push(parseFloat(door.x))
  }
  for (let car = 1; car <= 8; car++) {
    doorPositions.push({
      car,
      positions: doorsBycar[car] || []
    })
  }

  // Calculate car boundaries (where each car ends)
  // Each car spans 9 light pairs (72 total / 8 cars)
  const carBoundaries = [9, 18, 27, 36, 45, 54, 63, 72]

  // Group egresses by station
  const egressesByStation: Record<string, RawEgress[]> = {}
  for (const egress of egresses) {
    if (!egressesByStation[egress.nameStd]) {
      egressesByStation[egress.nameStd] = []
    }
    egressesByStation[egress.nameStd].push(egress)
  }

  // Process stations
  const outputStations: Record<string, Station> = {}

  for (const rawStation of stations) {
    const stationName = rawStation.nameStd
    const stationEgresses = egressesByStation[stationName] || []
    const stationExits = exitDescriptions[stationName] || {}

    // Check if this is a multi-platform station (name contains level indicator)
    const isLowerLevel = stationName.includes('(Lower Level)')
    const isUpperLevel = stationName.includes('(Upper Level)')
    const baseName = stationName
      .replace(' (Lower Level)', '')
      .replace(' (Upper Level)', '')

    // Get or create station entry
    if (!outputStations[baseName]) {
      outputStations[baseName] = {
        name: baseName,
        nameAlt: rawStation.nameAlt || undefined,
        subtitle: rawStation.subtitile || undefined,
        platforms: [],
        wmataCode: WMATA_CODES[stationName] || WMATA_CODES[baseName],
      }
    }

    const platformType = parsePlatformType(rawStation.platformType)
    const lines = parseLines(rawStation)

    // Process egresses for this platform
    const track1Egresses: Egress[] = []
    const track2Egresses: Egress[] = []
    const sharedEgresses: Egress[] = []

    for (const rawEgress of stationEgresses) {
      const egress: Egress = {
        x: parseFloat(rawEgress.x),
        x2: rawEgress.x2 ? parseFloat(rawEgress.x2) : undefined,
        type: parseIconType(rawEgress.icon),
        y: parseInt(rawEgress.y) || 2,
        preferred: rawEgress.pref === 'TRUE',
        exitLabel: rawEgress.exitLabel ? parseInt(rawEgress.exitLabel) : undefined,
        description: rawEgress.exitLabel ? stationExits[parseInt(rawEgress.exitLabel)] : undefined,
      }

      // For side and gap platforms, y=1 is eastbound (track2), y=2 is westbound (track1)
      // For island platforms, all egresses are shared
      if (platformType === 'side' || platformType === 'gap_island') {
        if (egress.y === 1) {
          track2Egresses.push(egress)
        } else {
          track1Egresses.push(egress)
        }
      } else {
        sharedEgresses.push(egress)
      }
    }

    const platform: Platform = {
      level: isLowerLevel ? 'lower' : isUpperLevel ? 'upper' : undefined,
      lines,
      track1Destinations: parseDestinations(rawStation.WBDir),
      track2Destinations: parseDestinations(rawStation.EBDir),
      platformType,
      egresses: {
        track1: track1Egresses,
        track2: track2Egresses,
        shared: sharedEgresses,
      }
    }

    outputStations[baseName].platforms.push(platform)
  }

  // For multi-platform stations, ensure we have WMATA codes for both levels
  for (const [name, station] of Object.entries(outputStations)) {
    if (!station.wmataCode && station.platforms.length > 1) {
      // Try to find code from level-specific entries
      station.wmataCode = WMATA_CODES[`${name} (Lower Level)`] || WMATA_CODES[`${name} (Upper Level)`]
    }
  }

  // Add explicit transfer mappings for multi-platform stations
  addTransferMappings(outputStations)

  return {
    stations: outputStations,
    doorPositions,
    carBoundaries,
  }
}

/**
 * Add explicit transfer information for multi-platform stations
 * These are manually curated based on the PDF diagrams
 */
function addTransferMappings(stations: Record<string, Station>) {
  // Metro Center: Lower (BL/OR/SV) ↔ Upper (RD)
  // Transfer via escalators at x≈23 (to Shady Grove RD) and x≈33 (to Glenmont RD)
  if (stations['Metro Center']) {
    const mc = stations['Metro Center']
    mc.transfers = {
      // From BL/OR/SV (lower) to RD (upper)
      'BL_to_RD': { x: 23, description: 'Escalator to RD trains to Shady Grove' },
      'OR_to_RD': { x: 23, description: 'Escalator to RD trains to Shady Grove' },
      'SV_to_RD': { x: 23, description: 'Escalator to RD trains to Shady Grove' },
      // From RD (upper) to BL/OR/SV (lower)
      'RD_to_BL': { x: 34, description: 'Exit to BL/OR/SV trains, 12th & G' },
      'RD_to_OR': { x: 34, description: 'Exit to BL/OR/SV trains, 12th & G' },
      'RD_to_SV': { x: 34, description: 'Exit to BL/OR/SV trains, 12th & G' },
    }
  }

  // Gallery Place: Lower (GR/YL) ↔ Upper (RD)
  // Transfer via escalators/stairs on each end
  if (stations['Gallery Place']) {
    const gp = stations['Gallery Place']
    gp.transfers = {
      // From GR/YL (lower) to RD (upper)
      'GR_to_RD': { x: 17, description: 'Escalator to RD platform' },
      'YL_to_RD': { x: 17, description: 'Escalator to RD platform' },
      // From RD (upper) to GR/YL (lower)
      'RD_to_GR': { x: 17, description: 'Escalator to GR/YL platform' },
      'RD_to_YL': { x: 17, description: 'Escalator to GR/YL platform' },
    }
  }

  // L'Enfant Plaza: Lower (BL/OR/SV) ↔ Upper (GR/YL)
  // Transfer via elevator at x≈5 or escalators at x≈17/50
  if (stations["L'Enfant Plaza"]) {
    const lep = stations["L'Enfant Plaza"]
    lep.transfers = {
      // From BL/OR/SV (lower) to GR/YL (upper)
      'BL_to_GR': { x: 17, description: 'Escalator to GR/YL trains to Branch Ave/Huntington' },
      'BL_to_YL': { x: 17, description: 'Escalator to GR/YL trains to Branch Ave/Huntington' },
      'OR_to_GR': { x: 17, description: 'Escalator to GR/YL trains to Branch Ave/Huntington' },
      'OR_to_YL': { x: 17, description: 'Escalator to GR/YL trains to Branch Ave/Huntington' },
      'SV_to_GR': { x: 17, description: 'Escalator to GR/YL trains to Branch Ave/Huntington' },
      'SV_to_YL': { x: 17, description: 'Escalator to GR/YL trains to Branch Ave/Huntington' },
      // From GR/YL (upper) to BL/OR/SV (lower)
      'GR_to_BL': { x: 20, description: 'Exit to BL/OR/SV platform' },
      'GR_to_OR': { x: 20, description: 'Exit to BL/OR/SV platform' },
      'GR_to_SV': { x: 20, description: 'Exit to BL/OR/SV platform' },
      'YL_to_BL': { x: 20, description: 'Exit to BL/OR/SV platform' },
      'YL_to_OR': { x: 20, description: 'Exit to BL/OR/SV platform' },
      'YL_to_SV': { x: 20, description: 'Exit to BL/OR/SV platform' },
    }
  }

  // Fort Totten: Lower (GR) ↔ Upper (RD)
  // Single mezzanine transfer point
  if (stations['Fort Totten']) {
    const ft = stations['Fort Totten']
    ft.transfers = {
      // From GR (lower) to RD (upper)
      'GR_to_RD': { x: 35, description: 'Escalator to RD platform' },
      // From RD (upper) to GR (lower)
      'RD_to_GR': { x: 35, description: 'Escalator to GR platform' },
    }
  }
}

// ============================================================================
// Car Calculation Utilities (included in output for reference)
// ============================================================================

/**
 * Convert x-position to car number (1-8)
 * Platform positions 1-72, with each car spanning 9 positions
 */
function xToCar(x: number): number {
  if (x <= 9) return 1
  if (x <= 18) return 2
  if (x <= 27) return 3
  if (x <= 36) return 4
  if (x <= 45) return 5
  if (x <= 54) return 6
  if (x <= 63) return 7
  return 8
}

/**
 * Find the closest door position to a given x coordinate
 */
function findClosestDoor(x: number, doorPositions: DoorPosition[]): { car: number, doorX: number, distance: number } {
  let closest = { car: 1, doorX: 2.25, distance: Infinity }
  
  for (const carDoors of doorPositions) {
    for (const doorX of carDoors.positions) {
      const distance = Math.abs(x - doorX)
      if (distance < closest.distance) {
        closest = { car: carDoors.car, doorX, distance }
      }
    }
  }
  
  return closest
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const baseDir = '/mnt/user-data/uploads'
  
  console.log('Loading CSV files...')
  const stations = parseCSV<RawStation>(`${baseDir}/Stations.csv`)
  const egresses = parseCSV<RawEgress>(`${baseDir}/Egresses.csv`)
  const exits = parseCSV<RawExit>(`${baseDir}/Exits.csv`)
  const doors = parseCSV<RawDoor>(`${baseDir}/Doors.csv`)

  console.log(`Loaded: ${stations.length} stations, ${egresses.length} egresses, ${exits.length} exits, ${doors.length} doors`)

  console.log('Processing data...')
  const output = processData(stations, egresses, exits, doors)

  console.log(`Processed: ${Object.keys(output.stations).length} unique stations`)

  // Write output
  const outputPath = '/home/claude/exit-data/stationExits.json'
  writeFileSync(outputPath, JSON.stringify(output, null, 2))
  console.log(`Written to: ${outputPath}`)

  // Print some stats
  let totalEgresses = 0
  let multiPlatformStations = 0
  for (const station of Object.values(output.stations)) {
    if (station.platforms.length > 1) multiPlatformStations++
    for (const platform of station.platforms) {
      totalEgresses += platform.egresses.shared.length
      totalEgresses += platform.egresses.track1.length
      totalEgresses += platform.egresses.track2.length
    }
  }
  console.log(`Total egresses mapped: ${totalEgresses}`)
  console.log(`Multi-platform stations: ${multiPlatformStations}`)

  // Verify some key stations
  console.log('\n--- Sample Station Data ---')
  const testStations = ['Metro Center', 'Gallery Place', 'L\'Enfant Plaza', 'Fort Totten', 'Anacostia']
  for (const name of testStations) {
    const station = output.stations[name]
    if (station) {
      console.log(`\n${name}:`)
      console.log(`  WMATA Code: ${station.wmataCode || 'MISSING'}`)
      console.log(`  Platforms: ${station.platforms.length}`)
      for (let i = 0; i < station.platforms.length; i++) {
        const p = station.platforms[i]
        const egressCount = p.egresses.shared.length + p.egresses.track1.length + p.egresses.track2.length
        console.log(`    Platform ${i + 1}: ${p.lines.join('/')} (${p.platformType}) - ${egressCount} egresses`)
        console.log(`      Track 1 → ${p.track1Destinations.join('/')}`)
        console.log(`      Track 2 → ${p.track2Destinations.join('/')}`)
      }
    }
  }
}

main()
