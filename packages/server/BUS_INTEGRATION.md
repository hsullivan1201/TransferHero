# Bus Integration

How Metrobus data flows through TransferHero: GTFS download → parse → spatial index → route finding → predictions → UI.

## Data Pipeline

**Source**: WMATA Bus GTFS Static Feed (`https://api.wmata.com/gtfs/bus-gtfs-static.zip`)

**Parsed files**:
- `stops.txt` → ~8,000 bus stops with lat/lon
- `routes.txt` → ~300 bus routes
- `trips.txt` → trip→route→direction mapping with headsigns
- `stop_times.txt` → ordered stop sequences per trip (largest file)

**Data structures** (in-memory):
- `busStops: Map<stopId, BusStop>` — all bus stops
- `busRoutes: Map<routeId, BusRoute>` — route metadata
- `busTrips: Map<tripId, BusTrip>` — trip→route+direction
- `routeStopSequences: Map<routeId_directionId, stopId[]>` — ordered stop list per route+direction
- `stopRoutes: Map<stopId, Set<routeId>>` — reverse index: routes serving each stop

**Refresh**: Re-downloaded every 24 hours via `setInterval`. Atomic swap of data structures.

## Spatial Index

Grid-based spatial index for "bus stops near a point" queries:
- 0.0045° grid cells (~500m)
- Each bus stop hashed to a cell
- Queries check target cell + 8 neighbors, filter by Haversine distance
- <5ms for 400m radius queries

## Station-Stop Proximity Map

Pre-computed at startup after both Metro exits and bus stops are loaded:
- For each Metro station exit, find bus stops within 400m
- `stationBusStops: Map<stationCode, BusStop[]>` — bus stops near each Metro station
- `busStopStations: Map<stopId, {stationCode, walkMeters, exitName}[]>` — Metro stations near each bus stop
- Also stores the nearest exit name per stop+station pair for car positioning

This is the key link between the two networks.

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

### Time Estimation & Ranking

All five candidate trips are ranked by estimated total time. The estimate uses pure math (Haversine + heuristics) — no API calls at this stage:

- **Walk time**: Haversine distance × 1.4 (grid factor for non-straight-line walking) ÷ 1.33 m/s walking speed
- **Bus ride**: stop count × 2 min/stop (rough DC average)
- **Metro ride**: Haversine distance between station centroids × 2.5 min/km (~24 km/h average including stops, dwell, transfers)
- **Outside walk**: The walk that falls outside the hybrid trip itself — origin→first Metro station for metro-bus, or destination Metro station→final destination for bus-metro. Computed via Haversine to station centroids.

**Why Haversine instead of Google Directions API?** We show 5 candidate trips before the user selects one. Calling Google's Directions API for all 5 would be expensive and slow (~200ms each, $5/1000 calls). Haversine with scaling factors gives surprisingly accurate ranking for DC's grid — typically within 1-2 minutes of Google's walking estimates. We only call the Directions API once the user selects a specific trip (via `/api/buses/walk`), enriching the two walk segments with precise distances and times.

### Deduplication

When multiple stops on the same route connect to the same Metro station, we keep only the candidate with the shortest Metro exit walk. Walking further to catch a bus one stop later is never faster — the bus covers that distance quicker.

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
- Predictions fetched in parallel for all unique boarding stops across the top 5 trips

## Client-Side Bus Wait Times

For metro-bus trips, after the user selects a Metro train, the client computes when they'll arrive at the bus boarding stop and filters bus predictions to show only catchable buses with wait times:

- **Direct Metro trip**: Uses `_destArrivalTimestamp` from the selected train + board walk minutes
- **Transfer Metro trip**: Uses the selected (or first catchable) leg 2 train's `_destArrivalTimestamp` + board walk minutes
- **Catchable**: `prediction.minutes >= arrivalAtBusStopMin - 1` (1-min grace period)
- **Display**: "X min wait" or "Bus waiting" on each prediction card
- Before train selection, predictions show unfiltered (no wait times)

Leg 2 trains are selectable in metro-bus trips — selecting a later leg 2 train recalculates which buses are catchable.

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
- **Irrational bus-metro suggestions**: The 1km origin-to-station distance filter may need tuning. Check `getOriginToStation` distances in logs.
- **Stale predictions**: Cache TTL is 15s. Check WMATA API status.
- **Missing route sequences**: Some GTFS trips may not have stop_times. Check `routeStopSequences` map size.
