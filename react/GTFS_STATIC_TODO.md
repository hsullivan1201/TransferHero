# GTFS Static Schedule Implementation

## Current Status
The React server currently uses only:
- **WMATA API** - Real-time predictions (0-15 min typically)
- **GTFS-RT** - Real-time trip updates (protobuf TripUpdates)

**Missing**: GTFS static schedules for trains not yet in the realtime feeds (typically 15+ min out)

## Goal
Implement proper GTFS static schedule lookups from `metro-gtfs/` folder to provide scheduled trains as fallback when realtime data doesn't include far-future departures.

## GTFS Files Available
```
metro-gtfs/
├── trips.txt         (1.0 MB) - Trip definitions with route_id, service_id, trip_headsign
├── stop_times.txt    (20 MB)  - Stop times for each trip (trip_id, stop_id, arrival_time, departure_time)
├── calendar_dates.txt (2.0 KB) - Service exceptions (which days each service_id runs)
├── routes.txt        (502 B)  - Route definitions (route_id, route_short_name, route_color)
└── stops.txt         (278 KB) - Stop definitions (stop_id, stop_name, platform_code)
```

## Implementation Requirements

### 1. Data Loading & Parsing
**Location**: `react/packages/server/src/data/gtfsStatic.ts`

- Parse CSV files on server startup:
  - `trips.txt` → Map of trip_id → {route_id, service_id, trip_headsign, direction_id}
  - `stop_times.txt` → Index by stop_id → [{trip_id, arrival_time, departure_time, stop_sequence}]
  - `calendar_dates.txt` → Map of service_id → Set of dates when service runs
  - `routes.txt` → Map of route_id → {route_short_name (line code like 'RD'), route_color}

- **Indexing Strategy** (for performance):
  ```typescript
  interface StopTimeIndex {
    [stopId: string]: Array<{
      tripId: string
      arrivalTime: string  // HH:MM:SS (24hr+ for post-midnight)
      departureTime: string
      stopSequence: number
    }>
  }
  ```

### 2. Schedule Query Function
**Function**: `getStaticScheduledTrains(stationCode: string, terminus: string[], startFromMinutes: number)`

**Algorithm**:
1. Convert station code (e.g., 'A01') to GTFS stop_id(s) (handle platform variations like 'pf_A01_1', 'pf_A01_2')
2. Get current date/time
3. Filter `calendar_dates.txt` to find which service_ids run today
4. Query `stop_times` index for the stop_id
5. Filter to trips that:
   - Run on today's service_id
   - Depart >= (current time + startFromMinutes)
   - Match the requested terminus/direction
   - Are within reasonable time window (e.g., next 60 minutes)
6. Join with `trips.txt` to get headsign and route_id
7. Join with `routes.txt` to get line code
8. Filter by terminus matching
9. Convert to `Train` format with `_scheduled: true`
10. Return sorted by departure tim

### 3. Time Handling
- GTFS times use 24hr+ format (e.g., "25:30:00" = 1:30 AM next day)
- Need to handle time wraparound correctly
- Convert to "minutes from now" for the UI

### 4. Integration Points

**Update**: `react/packages/server/src/routes/trips.ts`

```typescript
import { getStaticScheduledTrains } from '../data/gtfsStatic.js'

// In each route handler, add:
const staticScheduledTrains = getStaticScheduledTrains(from, terminus, 15)

const mergedTrains = mergeTrainData({
  apiTrains: apiFiltered,
  gtfsTrains: gtfsTrains,
  scheduledTrains: staticScheduledTrains  // Add this
})
```

**Update metadata**:
```typescript
sources: ['api', 'gtfs-rt', 'gtfs-static']
```

### 5. Performance Considerations

**CSV Parsing**:
- Use streaming parser for 20MB stop_times.txt (e.g., `csv-parser` npm package)
- Parse on server startup, cache in memory
- Build indexes for O(1) lookups by stop_id

**Memory Usage**:
- 20MB stop_times.txt will expand to ~60-80MB in memory when parsed
- Consider implementing LRU cache if memory is a concern
- Could store as SQLite database instead for larger datasets

**Caching**:
- Cache parsed GTFS data in memory (invalidate on restart or periodic refresh)
- GTFS data updates periodically (check `feed_info.txt` for feed_end_date)
- Implement refresh mechanism (daily at 3 AM, as in `gtfsRefresh.ts`)

### 6. Deduplication
The existing `mergeTrainData()` in `trainMerger.ts` already handles deduplication:
- API trains (highest priority)
- GTFS-RT trains (medium priority)
- GTFS static trains (lowest priority)

Threshold: 4 minutes (scheduled trains within 4 min of realtime train = duplicate)

### 7. Testing Strategy

**Test Cases**:
1. Late night (post-midnight times like "25:30:00")
2. Service exceptions (holidays, special dates)
3. Multi-platform stations (e.g., Metro Center)
4. Terminus filtering (ensure only trains going correct direction)
5. Time windows (15-60 min future)

**Data Validation**:
- Verify trip_ids in stop_times.txt exist in trips.txt
- Verify service_ids in trips.txt exist in calendar_dates.txt
- Verify stop_ids match station platform codes

## Estimated Effort
- **Parsing & indexing**: 1-2 hours
- **Query logic**: 2-3 hours
- **Integration & testing**: 1-2 hours
- **Total**: 4-7 hours

## Alternative: Pre-computed Schedules
If runtime querying is too complex, could pre-compute common queries:
- Generate schedule patterns per station/direction (like current `schedule-data.js`)
- But use REAL GTFS data instead of frequency-based generation
- Store as JSON for fast lookups
- Trade-off: Less accurate, but simpler implementation

## Dependencies
```json
{
  "csv-parser": "^3.0.0",  // For parsing GTFS CSV files
  "papaparse": "^5.4.1"     // Alternative CSV parser
}
```

## References
- GTFS Reference: https://gtfs.org/schedule/reference/
- GTFS Best Practices: https://gtfs.org/schedule/best-practices/
- WMATA GTFS Docs: https://developer.wmata.com/docs/services/gtfs/
