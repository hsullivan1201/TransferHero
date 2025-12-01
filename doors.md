# Car Position Recommendation System - Implementation Plan

## Overview

TransferHero currently uses placeholder data for car position recommendations. This document outlines how to replace it with **real data** from the [DCMetroStationExits](https://github.com/eable2/DCMetroStationExits) dataset, which provides precise exit locations for all 98 DC Metro stations.

## Data Source

**GitHub Repository**: https://github.com/eable2/DCMetroStationExits

### CSV Files Available

| File | Description |
|------|-------------|
| `meta.csv` | Variable definitions and metadata |
| `Doors.csv` | X-coordinates where train doors line up (platform light pair numbers) |
| `Stations.csv` | Station info: name, code, platform type, track layout |
| `Egresses.csv` | Exit point locations: x-position, type (escalator/elevator/stairs), destination text |
| `Exits.csv` | Exit labels for stations with multiple exits |

### Coordinate System

The dataset uses a **platform light pair** coordinate system:
- Metro platforms have **72 pairs of flashing lights** along the edge
- 8-car trains span positions 1-72 (9 light pairs per car)
- Car 1 (front) = positions 1-9
- Car 2 = positions 10-18
- Car 3 = positions 19-27
- Car 4 = positions 28-36
- Car 5 = positions 37-45
- Car 6 = positions 46-54
- Car 7 = positions 55-63
- Car 8 (rear) = positions 64-72

### Door Positions

From the PDF documentation, train doors align at specific light pairs:

| Car | Door Positions (Light Pairs) |
|-----|------------------------------|
| 1 | 2, 4, 6, 8 |
| 2 | 11, 13, 15, 17 |
| 3 | 20, 22, 24, 26 |
| 4 | 29, 31, 33, 35 |
| 5 | 38, 40, 42, 44 |
| 6 | 47, 49, 51, 53 |
| 7 | 56, 58, 60, 62 |
| 8 | 65, 67, 69, 71 |

## Use Cases

### 1. Non-Transfer Trips (Direct Routes)
**Goal**: Recommend the car closest to the station exit at the destination.

**Algorithm**:
1. Look up destination station in `Egresses.csv`
2. Get the x-position(s) of egress points
3. If multiple egresses, use the "preferred" one (marked in dataset) or the one closest to a street exit
4. Convert x-position to car number using the mapping above
5. Return car recommendation

### 2. Transfer Trips
**Goal**: Recommend the car that positions you best for walking to the connecting platform.

**Algorithm**:
1. Look up transfer station in `Egresses.csv`
2. Find the egress that leads to the **connecting platform** (not street exit)
3. Get its x-position
4. Convert to car number for **Leg 1** (board car)
5. For **Leg 2**, find the egress leading to the final destination exit
6. Return both recommendations

### 3. Multi-Platform Stations (Complex Transfers)

Some stations have multiple platforms that require special handling:

| Station | Platforms | Notes |
|---------|-----------|-------|
| Metro Center | Lower (RD), Upper (BL/OR/SV) | Cross-platform transfer via mezzanine |
| Gallery Place | Lower (RD), Upper (GR/YL) | Cross-platform transfer |
| L'Enfant Plaza | Lower (BL/OR/SV), Upper (GR/YL) | Complex with multiple exits |
| Fort Totten | Platform 1 (RD), Platform 2 (GR/YL) | Side platforms |

**Strategy**: The `Stations.csv` file should indicate platform type. For multi-platform stations, we need to:
1. Determine which platform the incoming train uses
2. Find the egress that connects to the outgoing platform
3. The egress x-position on the incoming platform determines the board car
4. The arrival point on the outgoing platform determines the exit car

## Data Model

### TypeScript Interfaces

```typescript
// Egress point (escalator, elevator, stairs)
interface Egress {
  stationCode: string       // e.g., "A01"
  platform: number          // 1 or 2 for multi-platform stations
  x: number                 // Light pair position (1-72)
  type: 'escalator' | 'elevator' | 'stairs'
  destination: string       // e.g., "11th & G", "Platform", "Street"
  isPreferred: boolean      // Closest to main exit
  connectsTo?: string       // For transfer connections: "platform_2" or station code
}

// Station platform info
interface StationPlatform {
  stationCode: string
  name: string
  platformCount: number     // 1 or 2
  track1Destinations: string[]  // Terminus names for track 1
  track2Destinations: string[]  // Terminus names for track 2
  egresses: Egress[]
}

// Car position recommendation
interface CarPosition {
  boardCar: number          // 1-8: which car to board
  exitCar: number           // 1-8: which car to exit from
  legend: string            // Human-readable explanation
  confidence: 'high' | 'medium' | 'low'
}
```

### JSON Data Structure

```json
{
  "stations": {
    "A01": {
      "name": "Metro Center",
      "platforms": [
        {
          "platform": 1,
          "level": "lower",
          "lines": ["RD"],
          "track1": ["Shady Grove"],
          "track2": ["Glenmont"],
          "egresses": [
            { "x": 15, "type": "escalator", "dest": "11th & G, 13th & G", "preferred": true },
            { "x": 58, "type": "escalator", "dest": "11th & G, 13th & G" },
            { "x": 25, "type": "stairs", "dest": "12th & F" },
            { "x": 48, "type": "stairs", "dest": "12th & G" },
            { "x": 20, "type": "elevator", "dest": "Platform & Street" },
            { "x": 52, "type": "elevator", "dest": "Platform Only" }
          ]
        },
        {
          "platform": 2,
          "level": "upper",
          "lines": ["BL", "OR", "SV"],
          "track1": ["Shady Grove"],
          "track2": ["Glenmont"],
          "egresses": [...]
        }
      ],
      "transfers": {
        "RD_to_BL": { "fromPlatform": 1, "toPlatform": 2, "viaX": 20 },
        "BL_to_RD": { "fromPlatform": 2, "toPlatform": 1, "viaX": 20 }
      }
    }
  },
  "doorPositions": {
    "1": [2, 4, 6, 8],
    "2": [11, 13, 15, 17],
    ...
  }
}
```

## Implementation Steps

### Phase 1: Data Extraction & Processing

1. **Download CSV files** from GitHub repository
2. **Parse and validate** the data
3. **Create JSON lookup file** (`stationExits.json`)
4. **Map station codes** between WMATA API codes and dataset codes

```bash
# Location in project
react/packages/server/src/data/
├── stationExits.json     # Processed exit data
├── exitDataLoader.ts     # Loader and lookup functions
└── carPositionService.ts # Business logic
```

### Phase 2: Core Algorithm

```typescript
// carPositionService.ts

interface CarRecommendation {
  car: number
  x: number
  reason: string
}

/**
 * Convert x-position (light pair) to car number
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
 * Find the best egress for a station exit
 */
function findBestEgress(
  station: StationPlatform,
  platform: number,
  preferType?: 'escalator' | 'elevator' | 'stairs'
): Egress {
  const egresses = station.egresses.filter(e => e.platform === platform)
  
  // Prefer the "preferred" exit (usually closest to street)
  const preferred = egresses.find(e => e.isPreferred)
  if (preferred && (!preferType || preferred.type === preferType)) {
    return preferred
  }
  
  // Otherwise, prefer escalators > stairs > elevators for speed
  const priority = ['escalator', 'stairs', 'elevator']
  for (const type of priority) {
    const egress = egresses.find(e => e.type === type)
    if (egress) return egress
  }
  
  return egresses[0]
}

/**
 * Get car position for a direct (non-transfer) trip
 */
function getDirectTripCarPosition(
  destinationCode: string,
  incomingLine: string,
  direction: 'track1' | 'track2'
): CarPosition {
  const station = loadStation(destinationCode)
  const platform = findPlatformForLine(station, incomingLine)
  const egress = findBestEgress(station, platform)
  
  const exitCar = xToCar(egress.x)
  
  return {
    boardCar: exitCar,  // Same car for direct trips
    exitCar: exitCar,
    legend: `Board car ${exitCar} (${direction === 'track1' ? 'front' : 'back'} of train) for fastest exit at ${station.name}`,
    confidence: 'high'
  }
}

/**
 * Get car positions for a transfer trip
 */
function getTransferCarPosition(
  transferCode: string,
  incomingLine: string,
  outgoingLine: string,
  destinationCode: string
): CarPosition {
  const transferStation = loadStation(transferCode)
  const destStation = loadStation(destinationCode)
  
  // Find the egress connecting the two platforms
  const inPlatform = findPlatformForLine(transferStation, incomingLine)
  const outPlatform = findPlatformForLine(transferStation, outgoingLine)
  
  let boardCar: number
  let legend: string
  
  if (inPlatform === outPlatform) {
    // Same platform (cross-platform transfer)
    // Just stay on the platform
    boardCar = 4  // Middle of train is usually safe
    legend = 'Cross-platform transfer - stay near the middle'
  } else {
    // Different platforms - find connecting egress
    const transfer = transferStation.transfers?.[`${incomingLine}_to_${outgoingLine}`]
    if (transfer) {
      boardCar = xToCar(transfer.viaX)
      legend = `Board car ${boardCar} for quick transfer to ${outgoingLine} line`
    } else {
      // Fallback: use the egress closest to elevators/escalators
      const egress = findBestEgress(transferStation, inPlatform)
      boardCar = xToCar(egress.x)
      legend = `Board car ${boardCar} for transfer at ${transferStation.name}`
    }
  }
  
  // Exit car at destination
  const destEgress = findBestEgress(destStation, findPlatformForLine(destStation, outgoingLine))
  const exitCar = xToCar(destEgress.x)
  
  return {
    boardCar,
    exitCar,
    legend,
    confidence: 'high'
  }
}
```

### Phase 3: Track Direction Handling

**Critical**: The car numbering flips depending on which direction the train is traveling!

- **Track 1** (e.g., toward Shady Grove): Car 1 is at the front (position 1-9)
- **Track 2** (e.g., toward Glenmont): Car 1 is at the back (position 64-72)

```typescript
function adjustCarForDirection(
  car: number,
  track: 'track1' | 'track2'
): number {
  // Track 2 trains are oriented opposite to Track 1
  if (track === 'track2') {
    return 9 - car  // Flip: 1→8, 2→7, 3→6, etc.
  }
  return car
}
```

To determine track direction, we need to know:
1. The terminus of the train (from WMATA API `DestinationName`)
2. Which track at the station goes to that terminus

### Phase 4: Integration with Existing Code

Update the trip response to include real car positions:

```typescript
// In trips.ts route handler

import { getTransferCarPosition, getDirectTripCarPosition } from '../data/carPositionService'

// For transfer trips
const carPosition = getTransferCarPosition(
  transfer.station,
  leg1Line,
  leg2Line,
  destination.code
)

// For direct trips  
const carPosition = getDirectTripCarPosition(
  destination.code,
  trainLine,
  getTrackDirection(trainDestination, destination.code)
)
```

## Data Processing Script

Create a script to process the GitHub CSV data into our JSON format:

```typescript
// scripts/processExitData.ts

import { parse } from 'csv-parse/sync'
import { readFileSync, writeFileSync } from 'fs'

interface RawEgress {
  station: string
  platform: string
  x: string
  type: string
  destination: string
  preferred: string
}

function processExitData() {
  // Read CSV files
  const egresses = parse(readFileSync('data/Egresses.csv'), { columns: true }) as RawEgress[]
  const stations = parse(readFileSync('data/Stations.csv'), { columns: true })
  
  // Build station lookup
  const stationData: Record<string, StationPlatform> = {}
  
  for (const egress of egresses) {
    const code = egress.station
    if (!stationData[code]) {
      stationData[code] = {
        stationCode: code,
        name: stations.find(s => s.code === code)?.name ?? code,
        platformCount: 1,
        track1Destinations: [],
        track2Destinations: [],
        egresses: []
      }
    }
    
    stationData[code].egresses.push({
      stationCode: code,
      platform: parseInt(egress.platform) || 1,
      x: parseFloat(egress.x),
      type: egress.type as 'escalator' | 'elevator' | 'stairs',
      destination: egress.destination,
      isPreferred: egress.preferred === 'true'
    })
  }
  
  writeFileSync(
    'src/data/stationExits.json',
    JSON.stringify({ stations: stationData }, null, 2)
  )
}
```

## Testing Strategy

### Unit Tests

1. **X-to-car conversion**: Verify all 72 positions map to correct cars
2. **Direction flipping**: Verify Track 2 inverts correctly
3. **Multi-platform stations**: Test Metro Center, Gallery Place, L'Enfant Plaza

### Integration Tests

1. **Shady Grove → Glenmont via Metro Center**: Red line, should recommend correct car for RD→RD transfer
2. **Vienna → Branch Ave via L'Enfant**: SV/OR→GR transfer, complex multi-level
3. **Greenbelt → Largo via Gallery Place**: GR→BL transfer

### Manual Validation

Compare recommendations against the PDF diagrams for 10-15 common routes.

## Edge Cases

### 6-Car vs 8-Car Trains

The dataset assumes 8-car trains. For 6-car trains:
- Cars 1-6 are present
- Recommend cars 1-6 only
- Adjust x-position ranges accordingly

```typescript
function xToCar(x: number, numCars: 6 | 8): number {
  if (numCars === 6) {
    // 6-car trains use different positioning
    // Each car spans ~12 light pairs instead of 9
    if (x <= 12) return 1
    if (x <= 24) return 2
    if (x <= 36) return 3
    if (x <= 48) return 4
    if (x <= 60) return 5
    return 6
  }
  // 8-car logic (default)
  ...
}
```

### Stations Without Data

If a station isn't in the dataset:
- Return `confidence: 'low'`
- Default to middle car (4) with generic message
- Log warning for investigation

### Elevator-Only Access

For accessibility, some users need elevator routes:
- Add `preferElevator` option to API
- Filter egresses to only elevators
- May result in different car recommendation

## File Locations

```
react/
├── packages/
│   └── server/
│       └── src/
│           └── data/
│               ├── stationExits.json      # Processed exit data
│               ├── exitDataLoader.ts      # JSON loader + caching
│               └── carPositionService.ts  # Algorithm implementation
│
├── scripts/
│   └── processExitData.ts                 # CSV → JSON processor
│
└── data/
    └── raw/                               # Downloaded CSV files
        ├── Egresses.csv
        ├── Stations.csv
        ├── Doors.csv
        └── meta.csv
```

## Dependencies

```json
{
  "csv-parse": "^5.5.0"  // For processing CSV files
}
```

## Estimated Effort

| Task | Time |
|------|------|
| Download and validate CSV data | 30 min |
| Write data processing script | 1-2 hours |
| Implement core algorithm | 2-3 hours |
| Handle track direction logic | 1-2 hours |
| Multi-platform station handling | 2-3 hours |
| Integration with existing code | 1 hour |
| Testing and validation | 2-3 hours |
| **Total** | **10-15 hours** |

## Next Steps

1. ✅ Document the data source and structure (this file)
2. ✅ Download CSV files from GitHub
3. ✅ Write data processing script (`processExitData.ts`)
4. ✅ Implement `carPositionService.ts`
5. ⬜ Update trip routes to use real data
6. ⬜ Test with common routes
7. ⬜ Handle edge cases (6-car trains, missing data)

---

## Phase 1 Completion Notes

### Generated Files

| File | Size | Description |
|------|------|-------------|
| `stationExits.json` | 122 KB | Processed exit data for all 98 stations, 405 egresses |
| `carPositionService.ts` | ~10 KB | TypeScript service with lookup and calculation functions |
| `processExitData.ts` | ~10 KB | CSV → JSON processor script |

### Test Results

| Test Case | Result | Recommendation |
|-----------|--------|----------------|
| Direct trip (Bethesda toward Shady Grove) | ✅ | Car 3 - stairs at x=21 |
| Direct trip (Bethesda toward Glenmont) | ✅ | Car 6 - correctly flipped |
| Transfer (Metro Center RD→BL) | ✅ | Car 5 - "Exit to BL/OR/SV trains, 12th & G" |
| Transfer (Gallery Place RD→GR) | ✅ | Car 7 - "Escalator to GR/YL platform" |
| Transfer (L'Enfant Plaza OR→GR) | ✅ | Car 2 - "Escalator to GR/YL trains" |
| Side platform (Dupont Circle) | ✅ | Car 3 (Shady Grove) / Car 6 (Glenmont) |
| Multi-exit (Anacostia) | ✅ | Car 1 (from Branch Ave) / Car 8 (toward Branch Ave) |
| Terminus (Shady Grove) | ✅ | Car 5 |

### Key Features Implemented

1. **X-to-car conversion**: Accurate mapping from platform position (1-72) to car number (1-8)
2. **Track direction handling**: Correct car flip for opposite-direction trains
3. **Multi-platform stations**: Explicit transfer mappings for Metro Center, Gallery Place, L'Enfant Plaza, Fort Totten
4. **Station lookup**: Works with names, WMATA codes, and multi-level station codes (A01, B01, etc.)
5. **Egress prioritization**: Prefers preferred exits, then escalators > stairs > elevators

### Data Processing Notes

- **Transfer Mappings**: Added explicit `transfers` field to multi-platform stations with x-coordinates for platform connections
- **Exit Labels**: 71 exit descriptions linked from Exits.csv
- **Side Platforms**: Egresses correctly separated by track (y=1 for track2, y=2 for track1)

### Remaining Work

1. **Integration**: Update trip routes to use `carPositionService` instead of placeholder data
2. **6-car trains**: Adjust car boundaries for shorter trains (x/12 instead of x/9)
3. **Elevator preference**: Add API option for accessibility routing

## References

- **Dataset**: https://github.com/eable2/DCMetroStationExits
- **PDF Guide**: WMATA Metro Station Platform Exit Guide (June 2025)
- **Reddit Post**: https://www.reddit.com/r/washingtondc/comments/15mbos4/
- **WMATA Station Codes**: https://developer.wmata.com/docs/services/
