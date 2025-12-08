# destination-based routing (implementation spec)

## 1. ui toggle & search
- **client state**: add `mode` ('station' | 'destination') to `TripSearch` component state. persist preference in `localStorage`.
- **input component**:
  - reuse existing `StationSearch` styles but swap logic.
  - on 'destination' mode:
    - input becomes free-text search.
    - debounced (300ms) calls to backend search endpoint.
    - render dropdown with `place_name`, `context` (neighborhood), and linear distance from search center.
  - on 'station' mode: retain existing typeahead behavior.
- **selection**:
  - user picks result → client sends coords + place id to backend.
  - UI enters "loading route" state while server calculates optimal exit.
  - result displays: "Closest Station: [Name]", "Best Exit: [Exit Name]", "Walk: [X] min".

## 2. mapbox api usage (server-side)
**never expose these tokens to the client.**

### A. Geocoding v5 (Search)
- **purpose**: autocomplete places.
- **endpoint**: `GET https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json`
- **params**:
  - `types=poi,address`
  - `autocomplete=true`
  - `limit=8`
  - `bbox=-77.4,38.7,-76.8,39.1` (approx DC metro area; refine to exact service area)
  - `proximity={dc_center_lon},{dc_center_lat}` (bias results to center)
  - `session_token`: generate uuid per user session to group billing.

### B. Matrix v1 (Walking Optimization)
- **purpose**: find *actual* closest exit by walking time (haversine is too dumb for DC diagonal streets).
- **endpoint**: `GET https://api.mapbox.com/directions-matrix/v1/mapbox/walking/{coordinates}`
- **params**:
  - `sources=0` (the user's destination).
  - `destinations=1;2;3;...` (indices of candidate station exits).
  - `annotations=duration,distance`.

## 3. backend api surface
### `GET /api/destinations/search`
- **query**: `q` (string), `session` (uuid).
- **logic**:
  - validate `q` (3 < len < 100).
  - check in-memory cache (LRU, 60s TTL) keyed by `q`.
  - if miss: call Mapbox Geocoding.
  - transform mapbox geojson → simplified list:
    ```typescript
    { id: string; name: string; context: string; lat: number; lng: number }[]
    ```
- **error**: 400 if empty; 429 if rate limit hit.

### `POST /api/destinations/select`
- **body**: `{ lat: number; lng: number; placeId: string }`
- **logic**:
  1. **Station Filtering (Haversine)**:
     - [cite_start]Load all exits from `stops.txt` (filtered by `location_type=2` and `ENT_` prefix). [cite: 1103, 1104, 1105]
     - Filter to find exits within ~0.8 miles (1.3km) of target.
     - Group exits by `parent_station`.
     - Select top 3 closest stations (by straight-line distance to their nearest exit).
  2. **Exit Selection (Matrix)**:
     - Construct coordinate string: `[dest_lng,dest_lat];[exit1_lng,exit1_lat];...`
     - Call Mapbox Matrix API.
     - Parse `durations[0]` array to find index of lowest walking time.
  3. **Response Assembly**:
     - Return optimal station + exit details.
     - If walking time > 20 mins, flag as `warning: long walk`.
- **response**:
  ```typescript
  {
    station: Station; // existing Station type
    recommendedExit: {
      name: string; // e.g. "Entrance B - 9 St & G St" [cite: 1222]
      lat: number;
      lng: number;
      walkTimeMinutes: number;
    };
    alternatives: { stationCode: string; walkTimeMinutes: number }[]; // optional for "Try X instead"
  }
  ```
  ## 4. data structures
- **stationExits**:
  - Parse `stops.txt` at startup.
  - Store as `Map<StationCode, Exit[]>`.
  - `Exit` type: `{ id: string; name: string; lat: number; lon: number }`.
  - [cite_start]Example source: `ENT_A01_C01_W` (Metro Center 13th & G)[cite: 327].

## 5. safeguards & perf
- **Rate Limiting**:
  - Strict leaky bucket on `/api/destinations/search` per IP.
  - Aggressive caching on `/api/destinations/select` (results for coords rounded to 3 decimal places can be cached for 24h).
- **Environment**:
  - `MAPBOX_TOKEN` (Required)
  - `ENABLE_DESTINATION_ROUTING` (Feature flag bool)

## 6. testing strategy
- **Unit**:
  - `Haversine`: test known distances (White House to McPherson Sq).
  - `ExitParser`: ensure `stops.txt` parsing correctly groups `ENT_` rows to parent `STN_` rows.
- **Integration**:
  - `MapboxService`: Mock axios response for Matrix API. Test case: ensure "Destination X" picks "Exit Y" (closest) over "Exit Z" (further but same station).

## 7. rollout
1. Enable `StationSearch` toggle UI (hidden behind flag).
2. Implement backend exit parsing from `stops.txt`.
3. Implement Haversine filtering.
4. Implement Mapbox integration.
5. Enable flag.