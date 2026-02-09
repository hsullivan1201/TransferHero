# Bus Integration

How Metrobus data flows through TransferHero: GTFS download → parse → spatial index → schedule index → route finding → predictions → UI.

## Data Pipeline

**Source**: WMATA Bus GTFS Static Feed (`https://api.wmata.com/gtfs/bus-gtfs-static.zip`)

**Parsed files**:
- `stops.txt` → ~8,000 bus stops with lat/lon
- `routes.txt` → ~300 bus routes
- `trips.txt` → trip→route→direction mapping with headsigns
- `stop_times.txt` → ordered stop sequences per trip (largest file)
- `calendar.txt` + `calendar_dates.txt` → service calendars and exceptions

**Data structures** (in-memory):
- `busStops: Map<stopId, BusStop>` — all bus stops
- `busRoutes: Map<routeId, BusRoute>` — route metadata
- `busTrips: Map<tripId, BusTrip>` — trip→route+direction+serviceId
- `routeStopSequences: Map<routeId_directionId, stopId[]>` — ordered stop list per route+direction
- `stopRoutes: Map<stopId, Set<routeId>>` — reverse index: routes serving each stop
- `tripStopTimes: Map<tripId, StopTime[]>` — departure times per trip (for schedule index)
- `calendar: Map<serviceId, CalendarEntry>` — day-of-week service patterns
- `calendarDates: Map<serviceId, Exception[]>` — date-specific overrides

**Refresh**: Re-downloaded every 24 hours via `setInterval`. Atomic swap of data structures.

## Spatial Index

Grid-based spatial index for "bus stops near a point" queries:
- 0.0045° grid cells (~500m)
- Each bus stop hashed to a cell
- Queries check target cell + 8 neighbors, filter by Haversine distance, **sorted by distance** (closest first)
- <5ms for 400m radius queries

## Station-Stop Proximity Map

Pre-computed at startup after both Metro exits and bus stops are loaded:
- For each Metro station exit, find bus stops within 400m
- `stationBusStops: Map<stationCode, BusStop[]>` — bus stops near each Metro station
- `busStopStations: Map<stopId, {stationCode, walkMeters, exitName, exitLat, exitLon}[]>` — Metro stations near each bus stop
- Stores the nearest exit name and precise coordinates per stop+station pair for walk cards and car positioning

This is the key link between the two networks.

## Schedule Index

`busScheduleIndex.ts` — a lazy, day-scoped index for GTFS schedule lookups.

**Build**: On first query (or day change), computes active service IDs from `calendar.txt` + `calendar_dates.txt`, then indexes all departures by stop ID. Sorted by departure time for binary search.

**Exports**:
- `getNextScheduledDepartures(stopId, routeId, directionId, limit?, afterMinFromNow?, extraRouteIds?)` — next N departures for a stop+route+direction, with optional variant route inclusion
- `getNextDeparture(stopId, routeId, directionId, afterMinFromNow?)` — single next departure with tripId (used for ride time lookups)
- `getScheduledRideMinutes(tripId, boardStopId, alightStopId)` — GTFS-accurate ride time between two stops on a specific trip

These power the `scheduledDepartures` and `scheduledRideMinutes` fields on `BusLeg`.

## Routing Algorithms

### Metro→Bus (last mile)
1. Find bus stops within 400m of destination
2. For each dest stop, get routes serving it
3. Walk route stop sequences backwards from dest stop
4. Check if any earlier stop is near a Metro station (via `busStopStations`)
5. Skip if the transfer station is the user's origin station (no point riding Metro to yourself)
6. If yes → viable hybrid trip: Metro to that station, walk to bus stop, ride bus to destination

### Bus→Metro (first mile)
1. Find bus stops within 400m of origin
2. For each origin stop, get routes serving it
3. Walk route stop sequences forward from origin stop
4. Check if any later stop is near a Metro station
5. Skip if the transfer station is the destination station, or if the origin is already within 1km of the transfer station (bussing to a station you can walk to is irrational)
6. If yes → viable hybrid trip: walk to bus stop, ride bus, walk to Metro station, ride Metro

### Route Variant Detection

Under WMATA's Better Bus network, express variants use an `X` suffix (e.g. D5X for D50). The route finder detects these automatically:

1. For each candidate, look up all routes serving both the board and alight stops via `stopRoutes`
2. For each candidate route (other than the primary), verify via GTFS stop sequences that both stops appear in order
3. Verified variants are passed as `extraRouteIds` to `getNextScheduledDepartures`, so scheduled departures include express variants

The same logic runs in `filterPredictionsForRoute` for RT predictions — any prediction whose `routeId` differs from the primary but serves both stops in order is included.

### Time Estimation & Ranking

All candidate trips are ranked by estimated total time. The estimate uses pure math (Haversine + heuristics) — no API calls at this stage:

- **Walk time**: Haversine distance × 1.4 (grid factor for non-straight-line walking) ÷ 1.33 m/s walking speed
- **Bus ride**: `scheduledRideMinutes` from GTFS when available, otherwise stop count × 1 min/stop (DC urban average)
- **Metro ride**: Haversine distance between station centroids × 2.5 min/km (~24 km/h average including stops, dwell, transfers)
- **Outside walk**: The walk that falls outside the hybrid trip itself — origin→first Metro station for metro-bus, or destination Metro station→final destination for bus-metro. Computed via Haversine to station centroids.

**Why Haversine instead of Google Directions API?** We show 5 candidate trips before the user selects one. Calling Google's Directions API for all 5 would be expensive and slow (~200ms each, $5/1000 calls). Haversine with scaling factors gives surprisingly accurate ranking for DC's grid — typically within 1-2 minutes of Google's walking estimates. We only call the Directions API once the user selects a specific trip (via `/api/buses/walk`), enriching the two walk segments with precise distances and times.

### Deduplication

When multiple stops on the same route connect to the same Metro station, we keep only the candidate with the least total walking distance (`boardWalkMeters + alightWalkMeters`). Within the same route, riding extra bus stops is essentially free — you're already on the bus. The actual ride time comes from GTFS schedule data later, so the dedup only needs to minimize walking.

## API Endpoints

### Route Finding
```
GET /api/buses/trips?originLat=X&originLon=Y&destLat=Z&destLon=W&originStation=A01&destStation=B01
```

**Response**:
```json
{
  "trips": [HybridTrip, ...],
  "busDataAvailable": true
}
```

Both Metro→Bus and Bus→Metro candidates are computed, merged, sorted by total time, and the top 5 returned. Route-finding results cached 5 minutes.

Each `HybridTrip.busLeg` includes:
- `predictions`: RT predictions from WMATA NextBusService
- `scheduledDepartures`: next departures from GTFS static schedule
- `scheduledRideMinutes`: GTFS-accurate ride time (when available)
- `nearestExitName`, `nearestExitLat`, `nearestExitLon`: precise Metro entrance/exit for walk cards

### Predictions (on detail view)
```
GET /api/buses/predictions?stopCode=1001234&routeId=D50&boardStopId=12345&alightStopId=67890
```

Fetches fresh RT predictions for a specific stop. `boardStopId` and `alightStopId` enable variant route detection — predictions from express variants (e.g. D5X) that serve both stops in order are included automatically.

### Walk Enrichment (on selection)
```
GET /api/buses/walk?boardStopLat=...&boardStopLon=...&alightStopLat=...&alightStopLon=...&boardFromLat=...&boardFromLon=...&alightToLat=...&alightToLon=...
```

Called only when the user taps a bus trip card. Makes up to 2 Google Directions API calls to get precise walking distances/times for the board and alight walk segments.

## WMATA Bus APIs

- **Predictions**: `https://api.wmata.com/NextBusService.svc/json/jPredictions?StopID={stopCode}`
- Uses the stop's public `stopCode` (7-digit), NOT the internal `stopId`
- Uses same `WMATA_API_KEY` as rail
- 15s cache TTL (matches rail prediction caching)

## Client-Side Features

### Mode Toggle & Trip List

When a Metro trip is active, a Metro | Metro+Bus toggle appears. The Metro+Bus tab shows up to 5 hybrid trip cards ranked by estimated time, each showing pattern (metro→bus or bus→metro), route name, and time estimate.

### Bus Predictions Display

The detail view (`BusTripDetail`) fetches fresh RT predictions via `useBusPredictions`. Predictions and scheduled departures are merged into a single time-sorted list:

- **RT predictions**: Live-tracked buses with vehicle IDs and minute countdown
- **Scheduled departures**: GTFS-based, shown when no RT prediction is within 2 minutes (proximity dedup avoids showing the same bus twice)
- Both show arrival clock times (departure + ride time)

### Bus Departure Selection (Bus→Metro)

For bus→metro trips, bus departures are selectable. Selecting a bus chains timing downstream:

1. **Bus selected** → compute `arrivalAtMetroMin = busDeparture + rideTime + alightWalk`
2. **Metro trains annotated** as `CatchableTrain[]` with `_waitTime` relative to metro arrival, `_canCatch` (threshold: -5 min, wider than metro transfers due to bus timing imprecision), `_arrivalClock`
3. **Missed trains filtered out**, remaining sorted live-first then by departure
4. **Selecting a metro train** enables leg 2 fetch (for transfer trips) — same as pure Metro mode
5. **Journey card** updates: `busWait` becomes deterministic, `metroWait` shows station wait time (not time-from-now), ride times flow through

Clearing bus selection resets all downstream state (metro train, leg 2 train).

### Metro→Bus Wait Times

For metro→bus trips, after the user selects a Metro train, the client computes when they'll arrive at the bus boarding stop and filters bus predictions to show only catchable buses with wait times:

- **Direct Metro trip**: Uses `_destArrivalTimestamp` from the selected train + board walk minutes
- **Transfer Metro trip**: Uses the selected (or first catchable) leg 2 train's `_destArrivalTimestamp` + board walk minutes
- **Catchable**: `prediction.minutes >= arrivalAtBusStopMin - 1` (1-min grace period)
- Before train selection, predictions show unfiltered (no wait times)

Leg 2 trains are selectable in metro-bus trips — selecting a later leg 2 train recalculates which buses are catchable.

### Walk Cards

Walk segments show precise entrance/exit info:
- **Bus→Metro**: "Walk to Metro" card uses `nearestExitLat/Lon` for maps link and shows entrance name
- **Metro→Bus**: "Walk to Bus Stop" card uses exit coordinates from the proximity map
- Maps links go to Apple Maps (iOS) or Google Maps (others) with walking directions

### Exit & Car Position

Destination exit info is shown on the car position diagram:
- **Bus→Metro**: exit name from `destPlaceContext` (the final Metro destination station)
- **Metro→Bus**: exit name from `busLeg.nearestExitName` (the Metro station where you exit to catch the bus)

## Regional Expansion

To add a new bus operator:
1. Add GTFS feed URL to `busGtfsLoader.ts`
2. Download and parse alongside Metrobus data
3. Spatial index and route finder are operator-agnostic
4. Add operator-specific prediction API in `busPredictions.ts`

Candidates: ART (Arlington), DASH (Alexandria), Ride On (Montgomery), TheBus (PG County), Fairfax Connector.

## Troubleshooting

- **GTFS download fails**: Bus features disabled, Metro works normally. Check WMATA API key and network.
- **No bus options shown**: Check if `stationBusStops` map has entries for the relevant Metro stations. Destination may be >400m from any bus stop.
- **Only bus-metro showing (no metro-bus)**: Likely no bus stops within 400m of the destination. Check `queryNearbyStops` results. Area may only have non-WMATA transit (ART, DASH, etc.).
- **Missing express variants**: Variant detection requires both stops to appear in the GTFS stop sequence for the express route. Some express routes skip stops — this is correct behavior (the express doesn't serve that segment).
- **Scheduled departures not showing**: Check schedule index build log. If `activeServiceIds` is empty, `calendar.txt` may not cover today's date (common during GTFS feed transitions).
- **Irrational bus-metro suggestions**: The 1km origin-to-station distance filter may need tuning. Check `getOriginToStation` distances in logs.
- **Stale predictions**: Cache TTL is 15s. Check WMATA API status.
- **Missing route sequences**: Some GTFS trips may not have stop_times. Check `routeStopSequences` map size.
