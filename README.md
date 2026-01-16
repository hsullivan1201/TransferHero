# TransferHero

A DC Metro transfer assistant that helps you plan connections across all Metro lines using real-time WMATA data and GTFS Realtime. Inspired by [MetroHero](https://github.com/jamespizzurro/metrohero-server).

![demo](./transferhero-demo.gif)

## What it does

- Shows real-time train predictions from WMATA + GTFS-RT
- Figures out the best transfer station for your route
- Tells you which car to board for the fastest transfer/exit
- Shows which connecting trains you can catch based on when you'll arrive

### Transfer stations supported
- Metro Center (Red ↔ Orange/Silver/Blue)
- Gallery Place (Red ↔ Yellow/Green)
- L'Enfant Plaza (Orange/Silver/Blue ↔ Yellow/Green)
- Fort Totten (Red ↔ Yellow/Green)

### Other features
- Car position diagrams based on real platform exit data
- Accessibility mode (prioritizes elevator exits)
- Dark mode
- Shows alternatives within 10 min of the fastest route

## Tech stack

**Frontend**: React 18, TypeScript, Vite, Tailwind, TanStack Query

**Backend**: Express, TypeScript, Protobuf.js (for GTFS-RT), Zod

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

### Install

```bash
git clone <repository-url>
cd TransferHero
npm install
```

Create `packages/server/.env`:
```bash
WMATA_API_KEY=your_api_key_here
PORT=3001
NODE_ENV=development
CORS_ORIGIN=*
```

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

## API

### GET /api/stations
Returns all Metro stations.

### GET /api/trips
Returns trip plan with trains.

Query params:
- `from` (required): origin station code
- `to` (required): destination station code
- `walkTime`: transfer walk time in minutes (1-15, default 3)
- `transferStation`: specific transfer station to use
- `accessible`: prioritize elevator exits

### GET /api/trips/leg2
Returns second-leg trains for a selected first-leg train.

### GET /api/health
Health check.

## Data sources

| Source | What it's used for |
|--------|-------------------|
| WMATA StationPrediction API | Real-time arrivals (0-15 min) |
| WMATA GTFS-RT | Schedule adherence data |
| GTFS static files | Travel times, station info |
| DCMetroStationExits dataset | Car position recommendations |

The server refreshes GTFS data daily at 3 AM.

## Contributing

- Shared types: `packages/shared/src/`
- Backend: `packages/server/src/services/`
- Frontend: `packages/client/src/components/`
- API routes: `packages/server/src/routes/`

## License

MIT
