# TransferHero

A DC Metro transfer assistant that helps riders plan connections across all Metro lines using real-time WMATA data and GTFS Realtime updates. Inspired by [MetroHero](https://github.com/jamespizzurro/metrohero-server).

![demo](./transferhero-demo.gif)

## Features

### Real-Time Train Predictions
- Live data from WMATA's StationPrediction API
- **GTFS Realtime TripUpdates** (protobuf) for enhanced accuracy and schedule adherence data
- Automatic data refresh every 30 seconds
- Hybrid display merges real-time and scheduled trains seamlessly
- Real-time destination arrival times for accurate journey planning

### Multi-Line Transfer Support
- **All Metro lines supported**: Red, Orange, Silver, Blue, Yellow, Green
- Intelligent transfer point selection:
  - Metro Center (Red ↔ Orange/Silver/Blue)
  - Gallery Place (Red ↔ Yellow/Green)
  - L'Enfant Plaza (Orange/Silver/Blue ↔ Yellow/Green)
  - Fort Totten (Red ↔ Yellow/Green alternative)
- Automatically determines correct train direction on each line
- Calculates optimal transfer timing and routing
- Shows alternative transfer options within 10 minutes of fastest route

### Smart Station Search
- **Typeahead autocomplete** for quick station selection
- Search by station name or code
- Visual line indicators for multi-line stations
- Persistent station selection display

### Journey Time Display
- **Clock times** shown alongside "X minutes" for every train
- **Travel time** from origin to transfer station (from GTFS data)
- **Transfer walk time** (configurable 1-15 minutes)
- **Total journey time** with arrival clock time at destination
- Real-time updates as train data refreshes

### Transfer Catchability
- Click a first-leg train to see which transfers you can catch
- Shows wait time at transfer station for each option
- Displays final arrival time at your destination
- Warns when connections are tight or missed
- Handles trains that have already departed (negative minutes)

### Optimal Car Positioning
- **Visual car diagrams** showing which train car to board
- Position recommendations for fastest transfers at each station
- Shows which car to exit for your destination
- Based on real platform exit data from DCMetroStationExits dataset
- Legend explains optimal positioning strategy
- Supports 6-car and 8-car trains

### Accessibility Mode
- Toggle to prioritize elevator exits for wheelchair/mobility device users
- Automatically adjusts car position recommendations
- Visual indicator in header when enabled

### Dark Mode
- Toggle between light and dark themes
- Preference persisted in localStorage
- Eye-friendly for nighttime transit planning

## Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development and optimized builds
- **Tailwind CSS** for styling
- **TanStack Query** for data fetching and caching
- **Lucide React** for icons

### Backend
- **Express.js** (BFF - Backend for Frontend)
- **TypeScript** for type safety
- **Node.js** with ES modules
- **Protobuf.js** for GTFS-RT parsing
- **Zod** for request validation
- **Helmet** for security headers
- **CORS** enabled for cross-origin requests

### Architecture
- **Monorepo** structure with npm workspaces
- **Shared package** for common types and utilities
- **Client/Server separation** for better scalability
- **RESTful API** design

## Project Structure

```
TransferHero/
├── react/                          # React monorepo
│   ├── packages/
│   │   ├── client/                 # React frontend
│   │   │   ├── src/
│   │   │   │   ├── components/     # React components
│   │   │   │   ├── hooks/          # Custom React hooks
│   │   │   │   ├── api/            # API client functions
│   │   │   │   ├── utils/          # Utility functions
│   │   │   │   └── App.tsx         # Main app component
│   │   │   ├── vite.config.ts      # Vite configuration
│   │   │   └── package.json
│   │   ├── server/                 # Express backend
│   │   │   ├── src/
│   │   │   │   ├── routes/         # API route handlers
│   │   │   │   ├── services/       # Business logic
│   │   │   │   ├── data/           # Data models and static data
│   │   │   │   ├── middleware/     # Express middleware
│   │   │   │   ├── jobs/           # Background jobs (GTFS refresh)
│   │   │   │   └── index.ts        # Server entry point
│   │   │   └── package.json
│   │   └── shared/                 # Shared types and utilities
│   │       ├── src/
│   │       │   └── utils/          # Shared utility functions
│   │       └── package.json
│   ├── package.json                # Root workspace config
│   └── tsconfig.base.json          # Shared TypeScript config
├── metro-gtfs/                     # WMATA GTFS static data
│   ├── stops.txt
│   ├── stop_times.txt
│   ├── trips.txt
│   └── ...
├── legacy/                         # Original vanilla JS implementation
└── README.md
```

## Setup

### Prerequisites
- **Node.js 18+** and npm
- **WMATA API Key** from [developer.wmata.com](https://developer.wmata.com/)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd TransferHero
   ```

2. **Install dependencies**
   ```bash
   cd react
   npm install
   ```

3. **Configure environment variables**
   
   Create `react/packages/server/.env`:
   ```bash
   WMATA_API_KEY=your_api_key_here
   PORT=3001
   NODE_ENV=development
   CORS_ORIGIN=*
   ```

4. **Start development servers**
   
   From the `react/` directory:
   ```bash
   npm run dev
   ```
   
   This starts both the server (port 3001) and client (port 3000) concurrently.
   
   Or run separately:
   ```bash
   # Terminal 1 - Backend
   npm run dev:server
   
   # Terminal 2 - Frontend
   npm run dev:client
   ```

5. **Open the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:3001

### Production Build

```bash
cd react
npm run build
```

This builds all packages in the correct order:
1. Shared package (types and utilities)
2. Server package
3. Client package

To run the production server:
```bash
cd react/packages/server
npm start
```

## Data Sources

| Source | Usage |
|--------|-------|
| WMATA StationPrediction API | Real-time train arrivals (0-15 min) |
| WMATA GTFS Realtime (TripUpdates) | Schedule adherence and enhanced predictions |
| GTFS stop_times.txt | Travel times between stations |
| GTFS stops.txt | Station codes and names |
| Static trip data | Scheduled trains (15+ min out) |
| DCMetroStationExits dataset | Optimal boarding/exit car positions |

## API Endpoints

### `GET /api/stations`
Returns all Metro stations with codes, names, and line associations.

### `GET /api/trips`
Returns complete trip plan with trains.

**Query Parameters:**
- `from` (required): Origin station code (e.g., "A01")
- `to` (required): Destination station code (e.g., "B08")
- `walkTime` (optional): Transfer walk time in minutes (1-15, default: 3)
- `transferStation` (optional): Specific transfer station to use
- `accessible` (optional): Boolean to prioritize elevator exits

### `GET /api/trips/leg2`
Returns second-leg trains for a selected first-leg train.

**Query Parameters:**
- `tripId` (required): Trip identifier
- `departureMin` (required): Minutes until first-leg departure (can be negative)
- `walkTime` (optional): Transfer walk time (1-15, default: 3)
- `transferStation` (optional): Transfer station code
- `transferArrivalMin` (optional): Real-time arrival at transfer station
- `accessible` (optional): Boolean for accessibility mode

### `GET /api/health`
Health check endpoint.

## GTFS Data Management

The server automatically refreshes GTFS static data daily at 3 AM via a cron job. The refresh job:
- Downloads the latest GTFS static feed from WMATA
- Extracts and processes the data
- Updates the in-memory data structures

GTFS static schedules are used as fallback when real-time data doesn't include far-future departures (typically 15+ minutes out).

**Note:** Full GTFS static schedule parsing is planned but not yet fully implemented. See `react/GTFS_STATIC_TODO.md` for details.

## How It Works

1. **Select Stations**: Type to search any Metro station as origin and destination
2. **View First Leg**: See real-time trains heading toward the optimal transfer point
3. **Check Car Position**: Visual diagram shows which car to board for fastest transfer
4. **Click a Train**: Select which train you'll take
5. **See Transfer Options**: View catchable trains on the second leg with:
   - Wait time at transfer station
   - Final arrival time at destination
   - Total journey duration
   - Optimal exit car position

## Development

### Code Style
- TypeScript strict mode enabled
- Functional React components with hooks
- Arrow functions preferred
- ESLint/Prettier (if configured)

### Testing
See `react/TESTING.md` for comprehensive testing guide and test cases.

### Adding Features
1. Shared types go in `react/packages/shared/src/`
2. Backend logic in `react/packages/server/src/services/`
3. Frontend components in `react/packages/client/src/components/`
4. API routes in `react/packages/server/src/routes/`

## Todo

### Short Term
- [ ] Complete GTFS static schedule implementation (see `react/GTFS_STATIC_TODO.md`)
- [ ] Persist station selections in localStorage
- [ ] Show platform-level transfer walking directions
- [ ] Mobile-responsive design improvements

### Medium Term
- [ ] Multi-leg journey planning (A → B → C)
- [ ] Service advisories and alerts integration
- [ ] Use MetroHero open source algorithm for train time predictions
- [ ] Add actual train car locations from PDF data

### Long Term
- [ ] Overhaul UI to be prettier (modern design refresh)
- [ ] Push notifications for departure reminders
- [ ] Mobile app (React Native or PWA)
- [ ] Offline support with service workers

## API Key

The app requires a WMATA API key. Register for your own at [developer.wmata.com](https://developer.wmata.com/).

**Note:** The app uses a demo API key for development. For production use, you must provide your own key in the server `.env` file.

## License

MIT
