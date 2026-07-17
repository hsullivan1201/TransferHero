# TransferHero

[transferhero.app](https://transferhero.app)

A DC Metro transfer assistant that helps you plan trips across all Metro lines and regional buses using real-time data. Inspired by [MetroHero](https://github.com/jamespizzurro/metrohero-server).

![demo](./transferhero-demo.gif)

## Credits

Car position data comes from [eable2's DCMetroStationExits](https://github.com/eable2/DCMetroStationExits/). They manually mapped out platform exit locations for every station, which is no small feat. See [their r/WMATA post](https://www.reddit.com/r/WMATA/comments/1lb7dhi/wmata_metro_station_platform_exit_guide_update/) for the full story.

## What it does

- Search for any station, address, or place as your origin/destination
- Real-time train predictions from WMATA + GTFS-RT
- Figures out the best transfer station for your route (and shows alternatives)
- Tells you which car to board for the fastest transfer or exit
- Select a train and see which connecting trains you can actually catch
- Metro+Bus mode for last-mile bus connections (WMATA Metrobus + Arlington Transit) with live predictions
- Walking directions to/from stations with Google Maps links
- "Use current location" to route from wherever you are
- Full journey breakdown: wait times, ride times, walks, transfers, estimated arrival

### Transfer stations supported
- Metro Center (Red ↔ Orange/Silver/Blue)
- Gallery Place (Red ↔ Yellow/Green)
- L'Enfant Plaza (Orange/Silver/Blue ↔ Yellow/Green)
- Fort Totten (Red ↔ Yellow/Green)

### Other features
- Save frequently-used trips for quick access (stored locally in your browser, never sent to a server)
- Car position diagrams based on real platform exit data (243 exits)
- "Already on a train?" mode - select a departed train to see what you can still catch
- Accessibility mode (prioritizes elevator exits)
- Dark mode
- Shows alternatives within 10 min of the fastest route

## Tech stack

**Frontend**: React 18, TypeScript, Vite, Tailwind CSS 4, TanStack Query

**Backend**: Express, TypeScript, Protobuf.js (for GTFS-RT), better-sqlite3, Zod

**APIs**: WMATA (trains + Metrobus), ART GTFS-RT (Arlington Transit), Google Places (geocoding), Google Directions (walking)

**Architecture**: Monorepo with npm workspaces

## Project structure

```
TransferHero/
├── packages/
│   ├── client/          # React frontend
│   ├── server/          # Express backend (BFF)
│   └── shared/          # Shared types
├── metro-gtfs/          # WMATA GTFS static data
├── package.json
└── tsconfig.base.json
```

## Setup

### Prerequisites
- Node.js 18+
- WMATA API key from [developer.wmata.com](https://developer.wmata.com/)
- Google Maps API key (for place search + walking directions)

### Install

```bash
git clone https://github.com/hsullivan1201/TransferHero.git
cd TransferHero
npm install
```

Create `packages/server/.env`:
```bash
WMATA_API_KEY=your_api_key_here
GOOGLE_PLACES_API_KEY=your_google_api_key_here
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000
PUBLIC_BASE_URL=http://localhost:3001
SHARE_TOKEN_SECRET=replace_with_a_long_random_secret
# Optional: persist short links locally instead of keeping them in memory
# SHARE_LINK_DB_PATH=./data/transferhero-share-links.sqlite
```

For deployed messaging previews, set `PUBLIC_BASE_URL` to the app's public HTTPS origin
(for example, `https://transferhero.app`) and keep `SHARE_TOKEN_SECRET` stable across
deploys and server instances. Changing that secret invalidates existing shared links.
For durable short links on Railway, attach a volume to the web service (for example at
`/data`); the server automatically stores its SQLite mapping under Railway's provided
`RAILWAY_VOLUME_MOUNT_PATH`. Without a production volume or explicit
`SHARE_LINK_DB_PATH`, sharing safely falls back to the existing signed long URLs.

You'll need a [WMATA API key](https://developer.wmata.com/) and a [Google Maps API key](https://console.cloud.google.com/) with Places and Directions APIs enabled.

### Run

```bash
npm run dev
```

This starts both server (port 3001) and client (port 3000).

Or run them separately:
```bash
npm run dev:server  # backend only
npm run dev:client  # frontend only
```

### Build

```bash
npm run build
cd packages/server && npm start
```

### Quality + perf checks

```bash
npm run quality:check
npm run test
npm run perf:bench
npm run perf:gate
npm run ci
```

## API

### Trips
- **GET /api/stations** - all Metro stations
- **GET /api/trips** - trip plan with Leg 1 & Leg 2 trains
  - `from`, `to` (required): station codes
  - `walkTime`: transfer walk time in minutes (1-5, default 2)
  - `transferStation`: specific transfer station
  - `accessible`: prioritize elevator exits
  - `includeDeparted`: show already-departed trains
- **GET /api/trips/:tripId/leg2** - catchable Leg 2 trains for a selected first-leg train
  - `departureMin`: selected leg-1 train departure minute offset
  - `walkTime`: transfer walk time in minutes (1-5, default 2)
  - `transferStation`: specific transfer station (optional)
  - `transferArrivalMin`: realtime transfer arrival override (optional)
  - `accessible`: prioritize elevator exits
  - `includeDeparted`: show already-departed trains

### Destinations
- **GET /api/destinations/search** - place search via Google Places
- **GET /api/destinations/resolve** - resolve lat/lon to best station + exit

### Buses
- **GET /api/buses/trips** - hybrid Metro+Bus trip options
  - `originLat`, `originLon`, `destLat`, `destLon`: coordinates
  - `originStation`, `destStation`: Metro station codes
- **GET /api/buses/predictions** - real-time bus arrival predictions
- **GET /api/buses/walk** - walking directions for bus segments

### Other
- **GET /api/health** - health check + WMATA cache hit/miss stats + upstream call counters

## Data sources

| Source | What it's used for |
|--------|-------------------|
| WMATA StationPrediction API | Real-time train arrivals (0-15 min) |
| WMATA GTFS-RT | GPS-tracked train positions |
| WMATA GTFS static (rail) | Travel times, station info |
| WMATA GTFS static (bus) | Metrobus stops, routes, schedules (~8k stops, ~300 routes) |
| WMATA NextBus API | Real-time Metrobus predictions |
| ART GTFS static | Arlington Transit stops, routes, schedules (~19 routes, 638 stops) |
| ART GTFS-RT | Real-time Arlington Transit predictions |
| Google Places API | Place/address geocoding |
| Google Directions API | Walking routes and times |
| DCMetroStationExits dataset | Car position recommendations (243 exits) |

The server refreshes GTFS data daily. Trip API responses are cached for 10s. Rail predictions are cached for 15s, rail GTFS-RT for 10s, and bus predictions for 15s. The backend also coalesces in-flight WMATA requests and serves stale data on upstream blips when possible.

## Bus schedule storage

Metro+Bus mode shows ~7 route options with time estimates. Hitting the WMATA API for each one would be too slow and eat through rate limits, so the server queries local GTFS schedules instead. Live predictions are only fetched when you tap into a specific trip. This also covers buses that aren't GPS-tracked.

The GTFS feeds have ~100k trips and 1M+ stop_times across all agencies—way too much for memory. So trips and stop_times go into a single merged SQLite database (`better-sqlite3`), streamed from GTFS zips on startup. Only today's active services are indexed (~25k trips). Small stuff (stops, routes, calendar) stays in memory. All IDs are namespaced by agency (`wmata:`, `art:`) to prevent collisions.

The DB rebuilds every 24h and swaps atomically. WAL mode on, mmap off to keep RSS predictable (~300MB).

## Contributing

- Shared types: `packages/shared/src/`
- Backend: `packages/server/src/services/`
- Frontend: `packages/client/src/components/`
- API routes: `packages/server/src/routes/`
- Detailed engineering notes: `docs/2026-02-19-performance-and-clean-code-sweep.md`

## License

MIT
