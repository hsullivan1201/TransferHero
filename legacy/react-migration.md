# TransferHero React Migration Guide

A comprehensive guide for migrating TransferHero from vanilla JavaScript to React + BFF architecture.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture](#2-current-architecture)
3. [Redundant Code Audit](#3-redundant-code-audit)
4. [Target Architecture](#4-target-architecture)
5. [Business Logic Migration Map](#5-business-logic-migration-map)
6. [React Component Design](#6-react-component-design)
7. [BFF API Design](#7-bff-api-design)
8. [Migration Phases](#8-migration-phases)
9. [Recommended Tech Stack](#9-recommended-tech-stack)
10. [File Mapping Reference](#10-file-mapping-reference)

---

## 1. Executive Summary

### Why Migrate?

| Current Pain Point | React + BFF Solution |
|-------------------|---------------------|
| 1,293 lines in single app.js | Modular components, ~10-15 focused files |
| Client-side protobuf decoding (CPU intensive) | Server handles all heavy parsing |
| API key exposed in client bundle | Keys stay server-side only |
| Duplicate code (~100+ lines) | Shared utilities, single source of truth |
| Manual GTFS refresh process | Automated server-side cron job |
| No type safety | TypeScript throughout |
| Bootstrap bloat (~200KB) | Tailwind CSS (~10KB purged) |

### Expected Benefits

- **50-70% reduction** in client-side JavaScript
- **Faster mobile performance** - server handles computation
- **Type-safe codebase** - catch errors at compile time
- **Easier maintenance** - clear separation of concerns
- **Better testing** - isolated components and API endpoints

---

## 2. Current Architecture

### File Structure Overview

```
TransferHero/
├── index.html              # Entry point (226 lines)
├── app.js                  # ALL application logic (1,293 lines)
├── style.css               # Main styles (751 lines)
├── json-box.css            # Additional styles (360 lines)
├── config.js               # API key (gitignored)
├── config.example.js       # API key template
├── schedule-data.js        # GTFS schedule patterns (436 lines)
├── static-trips.js         # Trip ID → destination lookup (~683KB)
├── process-gtfs.py         # Data generation script (495 lines)
│
├── data/
│   ├── stations.js         # ALL_STATIONS array (~100 stations)
│   ├── transfers.js        # TRANSFERS object (transfer points)
│   ├── travel-times.js     # TRAVEL_TIMES lookup (~200 pairs)
│   ├── car-positions.js    # CAR_POSITIONS (boarding guidance)
│   └── line-config.js      # LINE_STATIONS, TERMINI definitions
│
└── metro-gtfs/             # Raw GTFS data (~43MB, gitignored)
    ├── stops.txt
    ├── stop_times.txt
    ├── trips.txt
    └── ...
```

### Script Loading Order (index.html)

Understanding this order is critical - later scripts depend on earlier ones:

```html
1. data/stations.js      → Defines ALL_STATIONS (used everywhere)
2. data/transfers.js     → Defines TRANSFERS (used by pathfinding)
3. data/travel-times.js  → Defines TRAVEL_TIMES (used by routing)
4. data/car-positions.js → Defines CAR_POSITIONS (used by UI)
5. data/line-config.js   → Defines LINE_STATIONS, TERMINI
6. schedule-data.js      → Defines SCHEDULE_CONFIG, getScheduledTrains()
7. config.js             → Defines CONFIG.WMATA_API_KEY
8. protobuf.min.js       → External library (CDN)
9. static-trips.js       → Defines STATIC_TRIPS (trip ID lookup)
10. app.js               → Main application (depends on all above)
```

### Data Flow

```
User Input (From/To stations)
       ↓
findTransfer() → Determines transfer station
       ↓
startTrip() → Sets up currentTrip state
       ↓
fetchAndDisplayTrainInfo() → Parallel fetch:
  ├── WMATA StationPrediction API (JSON)
  ├── WMATA GTFS-RT TripUpdates (Protobuf)
  └── getScheduledTrains() (local calculation)
       ↓
Merge & deduplicate train data
       ↓
renderLeg1Card() → Display first leg trains
       ↓
User clicks train → selectTrain()
       ↓
Calculate arrival time at transfer
       ↓
fetchTransferTrains() → Same parallel fetch pattern
       ↓
renderTrainCard() → Display catchable connections
```

### Key Global State

```javascript
// app.js:5-6
let currentTrip = null;    // Active journey details
let protoRoot = null;      // Cached protobuf schema

// currentTrip structure:
{
  startStation: 'A01',           // Origin station code
  endStation: 'B01',             // Destination code
  startName: 'Metro Center',     // Display name
  endName: 'Gallery Place',      // Display name
  transfer: {                    // Transfer point details
    station: 'A01',
    name: 'Metro Center',
    fromPlatform: 'A01',
    toPlatform: 'C01',
    fromLine: 'RD',
    toLine: 'OR'
  },
  terminusFirst: ['Shady Grove'], // Valid destinations for leg 1
  terminusSecond: ['Vienna'],     // Valid destinations for leg 2
  fromLines: ['RD'],              // Lines serving origin
  toLines: ['OR', 'SV', 'BL']     // Lines serving destination
}
```

---

## 3. Redundant Code Audit

### HIGH Priority - Duplicate Functions

#### 3.1 Train Card Rendering (17+ duplicate lines)

Two nearly identical functions exist:

| Function | Location | Purpose |
|----------|----------|---------|
| `renderTrainCard()` | app.js:1010-1047 | Leg 2 / transfer trains |
| `renderLeg1Card()` | app.js:1226-1262 | Leg 1 trains |

**Difference**: Only the status text differs:
- Leg 1 shows: `${train.Car || '8'}-car train`
- Leg 2 shows: `${statusText}` (wait time / catchability)

**Migration**: Create single `<TrainCard>` component with `variant` prop.

#### 3.2 Train Data Merging (44+ duplicate lines)

The API + GTFS-RT + Schedule merge logic is copy-pasted:

| Location | Function |
|----------|----------|
| app.js:888-940 | `fetchTransferTrains()` |
| app.js:1157-1211 | `fetchAndDisplayTrainInfo()` |

Both contain identical:
- API filtering
- GTFS-RT parsing
- Deduplication logic (±3 min threshold)
- Schedule fallback merging

**Migration**: Extract to `mergeTrainData()` utility in BFF.

### MEDIUM Priority - Repeated Patterns

#### 3.3 Min-to-Integer Conversion (18 occurrences)

This pattern appears throughout the codebase:

```javascript
// Scattered across: lines 246, 850, 909, 911, 923, 955, 986, 987,
// 1016, 1018, 1041, 1177, 1179, 1191, 1207, 1208, 1232, 1234, 1252
const trainMin = train.Min === 'ARR' || train.Min === 'BRD' ? 0 : parseInt(train.Min);
```

**Migration**: Create `getTrainMinutes(train: Train): number` utility.

#### 3.4 Terminus Array Normalization (4 occurrences)

```javascript
// app.js: 903, 1131, 1172, schedule-data.js:389
const terminusList = Array.isArray(terminus) ? terminus : [terminus];
```

**Migration**: Create `ensureArray<T>(value: T | T[]): T[]` utility.

#### 3.5 Platform Code Mappings (3 separate definitions)

Multi-code station logic is defined in three places:

| Location | Type |
|----------|------|
| app.js:341-350 | `PLATFORM_CODES` object |
| app.js:759-764 | Hardcoded in `getTerminus()` |
| app.js:784-788 | Hardcoded in `calculateRouteTravelTime()` |

**Migration**: Single `PLATFORM_MAPPINGS` constant with lookup function.

### LOW Priority - Dead Code

#### 3.6 Never-Called Functions

| Function | Location | Status |
|----------|----------|--------|
| `isPeakHours()` | schedule-data.js:332-341 | Never called |
| `mergeWithSchedule()` | schedule-data.js:407-436 | Never called |

**Migration**: Delete entirely.

#### 3.7 Large Static Data File

`static-trips.js` is ~683KB of trip ID → destination mappings. This should:
1. Move to server-side (don't ship to client)
2. Be regenerated from GTFS automatically

---

## 4. Target Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (React SPA)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ StationSelect│  │  TrainList   │  │  CarDiagram  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                    │
│         └────────────────┬┴─────────────────┘                    │
│                          │                                       │
│              ┌───────────▼───────────┐                          │
│              │   TanStack Query      │  (Data fetching/caching) │
│              └───────────┬───────────┘                          │
└──────────────────────────┼──────────────────────────────────────┘
                           │ JSON
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      BFF (Express + TypeScript)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ /api/trips  │  │/api/stations│  │ /api/health │              │
│  └──────┬──────┘  └─────────────┘  └─────────────┘              │
│         │                                                        │
│  ┌──────▼──────────────────────────────────────────┐            │
│  │              Business Logic Layer                │            │
│  │  • Pathfinding (findTransfer, evaluateRoute)    │            │
│  │  • Travel time calculation                       │            │
│  │  • Train data merging (API + GTFS + Schedule)   │            │
│  │  • Protobuf decoding (GTFS-RT)                  │            │
│  └──────┬──────────────────────────────────────────┘            │
│         │                                                        │
│  ┌──────▼──────┐  ┌─────────────┐  ┌─────────────┐              │
│  │  WMATA API  │  │  GTFS-RT    │  │  Static Data│              │
│  │  (JSON)     │  │  (Protobuf) │  │  (stations) │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
│                                                                  │
│  ┌───────────────────────────────────────────────────┐          │
│  │  Cron Job: GTFS Refresh (daily)                   │          │
│  └───────────────────────────────────────────────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

### Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| **BFF handles all API calls** | API keys never exposed to client |
| **Protobuf decoding on server** | Heavy CPU work off mobile devices |
| **Server-side data merging** | Client receives clean, ready-to-render JSON |
| **TanStack Query for client** | Built-in caching, refetching, loading states |
| **Express over serverless** | Self-hosted requirement, WebSocket ready for future |

---

## 5. Business Logic Migration Map

### Moves to BFF (Server)

| Current Function | New Location | Reason |
|-----------------|--------------|--------|
| `fetchGTFSTripUpdates()` | `server/services/wmata.ts` | Protobuf decoding |
| `parseUpdatesToTrains()` | `server/services/trainParser.ts` | CPU intensive |
| `filterApiResponse()` | `server/services/trainParser.ts` | Data processing |
| `findTransfer()` | `server/services/pathfinding.ts` | Core algorithm |
| `findAllPossibleTransfers()` | `server/services/pathfinding.ts` | Core algorithm |
| `evaluateTransferRoute()` | `server/services/pathfinding.ts` | Core algorithm |
| `calculateRouteTravelTime()` | `server/services/travelTime.ts` | Core algorithm |
| `getTerminus()` | `server/services/pathfinding.ts` | Business logic |
| `getScheduledTrains()` | `server/services/schedule.ts` | Data processing |
| Train data merging | `server/services/trainMerger.ts` | Consolidate duplicates |
| `normalizeDestination()` | `server/utils/normalize.ts` | Shared utility |
| `STATIC_TRIPS` lookup | `server/data/staticTrips.ts` | Large dataset |

### Stays in Client (React)

| Current Function | New Location | Reason |
|-----------------|--------------|--------|
| `toggleTheme()` | `hooks/useTheme.ts` | UI-only |
| `initializeTheme()` | `hooks/useTheme.ts` | UI-only |
| `onStationInput()` | `components/StationSelector.tsx` | UI interaction |
| `selectStation()` | `components/StationSelector.tsx` | UI interaction |
| `renderCarDiagram()` | `components/CarDiagram.tsx` | UI rendering |
| `selectTrain()` | `components/TrainList.tsx` | UI interaction |
| `minutesToClockTime()` | `utils/time.ts` | Display formatting |
| `getLineClass()` | `utils/lineColors.ts` | CSS mapping |
| `getDisplayName()` | `utils/displayNames.ts` | Display formatting |

### Shared Types (Both Client & Server)

```typescript
// packages/shared/types.ts

export interface Station {
  code: string;
  name: string;
  lines: Line[];
}

export type Line = 'RD' | 'OR' | 'SV' | 'BL' | 'YL' | 'GR';

export interface Train {
  line: Line;
  destination: string;
  min: number | 'ARR' | 'BRD';
  cars: number;
  source: 'api' | 'gtfs' | 'schedule';
}

export interface Transfer {
  station: string;
  name: string;
  fromPlatform: string;
  toPlatform: string;
  fromLine: Line;
  toLine: Line;
}

export interface TripPlan {
  origin: Station;
  destination: Station;
  transfer: Transfer | null;
  isDirect: boolean;
  leg1Trains: Train[];
  leg2Trains?: Train[];
  alternatives?: Transfer[];
}

export interface CatchableTrain extends Train {
  waitTime: number;
  canCatch: boolean;
  totalJourneyTime: number;
  arrivalTime: string;
}
```

---

## 6. React Component Design

### Component Tree

```
<App>
├── <ThemeProvider>
│   ├── <Header>
│   │   ├── <Logo />
│   │   └── <ThemeToggle />
│   │
│   ├── <TripSelector>
│   │   ├── <StationSelector field="from" />
│   │   ├── <StationSelector field="to" />
│   │   ├── <WalkTimeInput />
│   │   └── <GoButton />
│   │
│   ├── <TransferDisplay>  (shows selected transfer point)
│   │   └── <AlternativesList />
│   │
│   ├── <TripView>  (main two-column layout)
│   │   ├── <LegPanel leg={1}>
│   │   │   ├── <TrainList>
│   │   │   │   └── <TrainCard /> (repeated)
│   │   │   └── <CarDiagram />
│   │   │
│   │   ├── <JourneyInfo>
│   │   │   ├── <TravelTime />
│   │   │   ├── <TransferTime />
│   │   │   └── <TotalTime />
│   │   │
│   │   └── <LegPanel leg={2}>
│   │       ├── <TrainList>
│   │       │   └── <TrainCard /> (repeated)
│   │       └── <CarDiagram />
│   │
│   └── <EmptyState />  (shown when no trip selected)
│
└── <Footer />
```

### Key Component Specifications

#### StationSelector

```typescript
interface StationSelectorProps {
  field: 'from' | 'to';
  value: Station | null;
  onChange: (station: Station | null) => void;
  stations: Station[];
}
```

Features:
- Typeahead filtering (client-side, stations are small)
- Keyboard navigation (arrow keys, enter, escape)
- Clear button to reset selection
- Line color dots display

#### TrainCard

```typescript
interface TrainCardProps {
  train: Train | CatchableTrain;
  variant: 'selectable' | 'display';
  isSelected?: boolean;
  onClick?: () => void;
}
```

Consolidates both `renderTrainCard()` and `renderLeg1Card()` into one component.

#### CarDiagram

```typescript
interface CarDiagramProps {
  numCars: number;
  highlightCar: number;
  type: 'board' | 'exit';
  legend: string;
}
```

---

## 7. BFF API Design

### Endpoints

#### GET /api/stations

Returns all stations for typeahead.

```typescript
// Response
{
  stations: Station[]
}
```

Cached indefinitely (stations rarely change).

#### GET /api/trips

Main endpoint - returns complete trip plan with trains.

```typescript
// Request
GET /api/trips?from=A01&to=B01&walkTime=3

// Response
{
  trip: {
    origin: Station,
    destination: Station,
    isDirect: boolean,
    transfer: Transfer | null,
    alternatives: Transfer[],
    leg1: {
      trains: Train[],
      carPosition: CarPosition
    },
    leg2?: {
      trains: CatchableTrain[],
      carPosition: CarPosition
    }
  },
  meta: {
    fetchedAt: string,
    sources: ['api', 'gtfs', 'schedule']
  }
}
```

#### GET /api/trips/:tripId/leg2

When user selects a leg 1 train, fetch catchable leg 2 trains.

```typescript
// Request
GET /api/trips/A01-B01/leg2?departureMin=5&walkTime=3

// Response
{
  trains: CatchableTrain[],
  arrivalAtTransfer: number,
  arrivalTime: string
}
```

#### GET /api/health

Health check for monitoring.

```typescript
// Response
{
  status: 'ok',
  gtfsLastUpdated: '2025-11-24T23:17:33Z',
  uptime: 3600
}
```

### Server-Side Caching Strategy

```typescript
// server/middleware/cache.ts

const CACHE_CONFIG = {
  stations: 24 * 60 * 60 * 1000,     // 24 hours
  travelTimes: 24 * 60 * 60 * 1000,  // 24 hours
  tripPlan: 30 * 1000,               // 30 seconds (real-time data)
  gtfsRefresh: 6 * 60 * 60 * 1000    // 6 hours
};
```

### GTFS Automation

```typescript
// server/jobs/gtfsRefresh.ts

import cron from 'node-cron';

// Run daily at 3 AM
cron.schedule('0 3 * * *', async () => {
  await downloadGTFS();
  await processGTFS();
  await reloadStaticData();
  logger.info('GTFS data refreshed');
});
```

---

## 8. Migration Phases

### Phase 1: Project Setup (Foundation)

**Goal**: Set up new React project alongside existing vanilla JS app

**IMPORTANT**: During migration, both projects will coexist:
- **New React project**: Lives in `react/` folder
- **Old vanilla JS app**: Remains in root directory and stays functional

```bash
# Dual-project structure during migration
transferhero/
├── react/                  # NEW React project
│   ├── packages/
│   │   ├── client/         # React app
│   │   ├── server/         # Express BFF
│   │   └── shared/         # Shared types
│   ├── package.json        # Workspace root
│   ├── tsconfig.base.json  # Shared TS config
│   └── turbo.json          # Build orchestration (optional)
│
├── index.html              # OLD app (still functional)
├── app.js                  # OLD app (still functional)
├── style.css               # OLD app styles
├── schedule-data.js        # OLD app data
├── static-trips.js         # OLD app data
├── process-gtfs.py         # OLD GTFS generation script (to be ported)
├── config.js               # OLD API key (gitignored)
├── config.example.js       # OLD API key template
├── data/                   # OLD app data files
│   ├── stations.js
│   ├── transfers.js
│   ├── travel-times.js
│   ├── car-positions.js
│   └── line-config.js
└── metro-gtfs/             # Shared GTFS data (used by both)
```

**Why this structure?**
- Old app remains deployable/testable throughout migration
- Can validate new implementation against working baseline
- Easy rollback if issues arise
- Once migration complete, old files can be archived/deleted

Tasks:
- [x] Create `react/` directory
- [x] Initialize npm workspace in `react/`
- [x] Set up Vite + React + TypeScript in `react/packages/client`
- [x] Set up Express + TypeScript in `react/packages/server`
- [x] Create shared types in `react/packages/shared`
- [x] Add `.env` handling (dotenv)
- [x] Ensure old app still runs from root directory

### Phase 2: Extract Business Logic

**Goal**: Move core algorithms to server, create shared utilities

Tasks:
- [x] Create `server/services/pathfinding.ts` with:
  - `findTransfer()`
  - `findAllPossibleTransfers()`
  - `evaluateTransferRoute()`
  - `getAllTerminiForStation()`
- [x] Create `server/services/travelTime.ts` with:
  - `calculateRouteTravelTime()`
  - `getTerminus()`
  - `minutesToClockTime()`
  - Consolidated platform mappings
- [x] Create `server/services/trainMerger.ts` with:
  - Unified merge logic (remove duplication)
  - `mergeTrainData(apiTrains, gtfsTrains, scheduledTrains)`
  - `sortTrains()`
- [x] Create `shared/utils/` with:
  - `getTrainMinutes()`
  - `ensureArray()`
  - `normalizeDestination()`
  - `getDisplayName()`
- [x] Port static data files to TypeScript:
  - `server/data/stations.ts`
  - `server/data/transfers.ts`
  - `server/data/travelTimes.ts`
  - `server/data/carPositions.ts`
  - `server/data/lineConfig.ts`
  - `server/data/platformCodes.ts`

### Phase 3: Build BFF

**Goal**: Implement all API endpoints

Tasks:
- [x] Set up Express app structure
- [x] Implement `/api/stations` endpoint
- [x] Implement `/api/trips` endpoint
- [x] Implement `/api/trips/:id/leg2` endpoint
- [x] Add WMATA API integration:
  - StationPrediction fetch
  - GTFS-RT protobuf decoding
- [x] Add request validation (zod)
- [x] Add error handling middleware
- [x] Add response caching
- [x] Implement GTFS refresh cron job
- [x] Add health check endpoint

### Phase 4: Build React Components

**Goal**: Create all UI components

Tasks:
- [x] Set up TanStack Query
- [x] Set up Tailwind CSS (v4 with @tailwindcss/postcss)
- [x] Create theme system (useTheme hook)
- [x] Build components:
  - [x] `<Header />`
  - [x] `<StationSelector />` with typeahead
  - [x] `<TripSelector />` form
  - [x] `<TransferDisplay />` with alternatives
  - [x] `<TrainCard />` (unified)
  - [x] `<TrainList />`
  - [x] `<CarDiagram />`
  - [x] `<JourneyInfo />`
  - [x] `<LegPanel />`
  - [x] `<TripView />`
  - [x] `<EmptyState />`
  - [x] `<Footer />`
  - [x] `<LineDot />` / `<LineDots />` (helper components)
- [x] Wire up data fetching with TanStack Query
- [x] Add loading states and error handling

**Component File Structure:**
```
react/packages/client/src/
├── api/
│   └── trips.ts              # API client functions
├── components/
│   ├── index.ts              # Component exports
│   ├── Header.tsx            # App header with theme toggle
│   ├── Footer.tsx            # App footer
│   ├── EmptyState.tsx        # Shown when no trip selected
│   ├── StationSelector.tsx   # Typeahead station input
│   ├── TripSelector.tsx      # Origin/destination form
│   ├── TransferDisplay.tsx   # Transfer station with alternatives
│   ├── TrainCard.tsx         # Unified train card (leg 1 & 2)
│   ├── TrainList.tsx         # List of train cards
│   ├── CarDiagram.tsx        # Car position diagram
│   ├── JourneyInfo.tsx       # Travel time summary
│   ├── LegPanel.tsx          # Panel wrapper for each leg
│   ├── TripView.tsx          # Main trip display layout
│   └── LineDot.tsx           # Metro line color indicators
├── hooks/
│   ├── useTheme.ts           # Dark/light theme hook
│   └── useTrip.ts            # Trip state & data fetching hooks
├── utils/
│   ├── time.ts               # Time formatting utilities
│   ├── lineColors.ts         # Metro line color mappings
│   └── displayNames.ts       # Station/destination name normalization
├── App.tsx                   # Main app component
├── main.tsx                  # React entry point
└── index.css                 # Tailwind + custom CSS variables
```

### Phase 5: Integration & Testing

**Goal**: Connect everything, validate parity

Tasks:
- [ ] Run old and new apps side-by-side
- [ ] Verify pathfinding produces same results
- [ ] Verify travel times match
- [ ] Verify train merging behaves identically
- [ ] Test all station combinations
- [ ] Test alternative transfers
- [ ] Test edge cases (direct routes, single train, etc.)
- [ ] Performance testing (Lighthouse)
- [ ] Mobile testing
- [ ] Configure ESLint + Prettier

### Phase 6: Deploy & Deprecate

**Goal**: Go live, remove old code

Tasks:
- [ ] Set up production environment
- [ ] Configure reverse proxy (nginx)
- [ ] Set up SSL certificate
- [ ] Configure environment variables
- [ ] Deploy BFF
- [ ] Deploy React app
- [ ] Set up monitoring/logging
- [ ] Update DNS/redirect old URL
- [ ] Archive old codebase
- [ ] Document deployment process

---

## 9. Recommended Tech Stack

### Client

| Tool | Version | Purpose |
|------|---------|---------|
| Vite | 5.x | Build tool, dev server |
| React | 18.x | UI framework |
| TypeScript | 5.x | Type safety |
| TanStack Query | 5.x | Data fetching, caching |
| Tailwind CSS | 3.x | Utility-first styling |
| React Router | 6.x | Client routing (if needed) |
| Lucide React | latest | Icons (lighter than Font Awesome) |

### Server

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20.x LTS | Runtime |
| Express | 4.x | HTTP server |
| TypeScript | 5.x | Type safety |
| protobufjs | 7.x | GTFS-RT decoding |
| node-cron | 3.x | GTFS refresh scheduling |
| zod | 3.x | Request validation |
| dotenv | 16.x | Environment variables |
| cors | 2.x | CORS middleware |
| helmet | 7.x | Security headers |

### Development

| Tool | Purpose |
|------|---------|
| ESLint | Linting |
| Prettier | Code formatting |
| Vitest | Testing (Vite native) |
| Turborepo | Monorepo builds (optional) |

### package.json Dependencies (Client)

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tanstack/react-query": "^5.0.0",
    "lucide-react": "^0.300.0"
  },
  "devDependencies": {
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.3.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

### package.json Dependencies (Server)

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.0",
    "helmet": "^7.1.0",
    "protobufjs": "^7.2.0",
    "node-cron": "^3.0.0",
    "zod": "^3.22.0",
    "dotenv": "^16.3.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/express": "^4.17.0",
    "@types/cors": "^2.8.0",
    "@types/node": "^20.10.0",
    "tsx": "^4.0.0",
    "vitest": "^1.0.0"
  }
}
```

---

## 10. File Mapping Reference

### Old → New Location

| Old File | New Location | Notes |
|----------|--------------|-------|
| `app.js` (all) | Split across multiple files | See breakdown below |
| `index.html` | `client/index.html` | Minimal shell |
| `style.css` | `client/src/index.css` + Tailwind | Migrate to utilities |
| `json-box.css` | Deleted | Unused styles |
| `config.js` | `server/.env` | Server-side only |
| `schedule-data.js` | `server/services/schedule.ts` | TypeScript |
| `static-trips.js` | `server/data/staticTrips.ts` | Server-side only |
| `process-gtfs.py` | `server/scripts/processGtfs.ts` | Convert to TS |
| `data/stations.js` | `shared/data/stations.ts` | TypeScript |
| `data/transfers.js` | `server/data/transfers.ts` | Server-side |
| `data/travel-times.js` | `server/data/travelTimes.ts` | Server-side |
| `data/car-positions.js` | `shared/data/carPositions.ts` | Used by both |
| `data/line-config.js` | `server/data/lineConfig.ts` | Server-side |

### app.js Function Breakdown

| Function | Lines | New Location |
|----------|-------|--------------|
| `toggleTheme()` | 9-19 | `client/hooks/useTheme.ts` |
| `initializeTheme()` | 21-30 | `client/hooks/useTheme.ts` |
| `onStationInput()` | 33-60 | `client/components/StationSelector.tsx` |
| `selectStation()` | 73-79 | `client/components/StationSelector.tsx` |
| `showSelectedStation()` | 81-109 | `client/components/StationSelector.tsx` |
| `clearStation()` | 111-127 | `client/components/StationSelector.tsx` |
| `checkCanGo()` | 129-142 | `client/components/TripSelector.tsx` |
| `updateTransferDisplay()` | 144-191 | `client/components/TransferDisplay.tsx` |
| `selectAlternativeTransfer()` | 193-268 | `client/components/TransferDisplay.tsx` |
| `PLATFORM_CODES` | 341-350 | `server/data/platformCodes.ts` |
| `getPlatformForLine()` | 352-358 | `server/utils/platforms.ts` |
| `findAllPossibleTransfers()` | 361-436 | `server/services/pathfinding.ts` |
| `evaluateTransferRoute()` | 438-457 | `server/services/pathfinding.ts` |
| `findTransfer()` | 459-515 | `server/services/pathfinding.ts` |
| `renderCarDiagram()` | 518-531 | `client/components/CarDiagram.tsx` |
| `showCarDiagrams()` | 534-547 | `client/components/CarDiagram.tsx` |
| `initProto()` | 550-590 | `server/services/gtfs.ts` |
| `fetchGTFSTripUpdates()` | 592-611 | `server/services/wmata.ts` |
| `parseUpdatesToTrains()` | 613-691 | `server/services/trainParser.ts` |
| `getAllTerminiForStation()` | 693-705 | `server/services/pathfinding.ts` |
| `startTrip()` | 708-751 | Client: dispatches API call |
| `getTerminus()` | 753-768 | `server/services/pathfinding.ts` |
| `getTransferWalkTime()` | 770-772 | Client: form state |
| `calculateRouteTravelTime()` | 775-825 | `server/services/travelTime.ts` |
| `minutesToClockTime()` | 827-831 | `client/utils/time.ts` |
| `selectTrain()` | 842-885 | `client/components/TrainList.tsx` |
| `fetchTransferTrains()` | 888-940 | `server/routes/trips.ts` |
| `renderTrainList()` | 942-1065 | `client/components/TrainList.tsx` |
| `renderTrainCard()` | 1010-1047 | `client/components/TrainCard.tsx` |
| `DESTINATION_ALIASES` | 1068-1092 | `shared/data/destinations.ts` |
| `DISPLAY_NAMES` | 1094-1107 | `shared/data/destinations.ts` |
| `normalizeDestination()` | 1109-1119 | `shared/utils/normalize.ts` |
| `getDisplayName()` | 1121-1126 | `client/utils/displayNames.ts` |
| `filterApiResponse()` | 1128-1150 | `server/services/trainParser.ts` |
| `getLineClass()` | 1152-1155 | `client/utils/lineColors.ts` |
| `fetchAndDisplayTrainInfo()` | 1157-1285 | `server/routes/trips.ts` |
| `renderLeg1Card()` | 1226-1262 | `client/components/TrainCard.tsx` |
| `escapeHtml()` | 1287-1290 | Deleted (React handles) |

---

## Appendix: Quick Reference

### Environment Variables

```bash
# server/.env
WMATA_API_KEY=your_api_key_here
PORT=3001
NODE_ENV=production
GTFS_REFRESH_CRON="0 3 * * *"
```

### Useful Commands

```bash
# Development
npm run dev          # Start both client and server
npm run dev:client   # Start client only
npm run dev:server   # Start server only

# Building
npm run build        # Build all packages
npm run build:client # Build client only
npm run build:server # Build server only

# Testing
npm run test         # Run all tests
npm run test:client  # Test client
npm run test:server  # Test server

# GTFS
npm run gtfs:refresh # Manually refresh GTFS data
```

### API Rate Limits

WMATA API limits:
- 10 calls per second
- 50,000 calls per day

Mitigation:
- Server-side caching (30s TTL for train data)
- Debounce client requests
- Batch station lookups

---

*Document generated: 2025-11-25*
*Last updated: 2025-11-25*
