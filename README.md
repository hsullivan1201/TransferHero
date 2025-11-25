# TransferHero

A DC Metro transfer assistant that helps riders plan connections across all Metro lines using real-time WMATA data and GTFS Realtime updates. Inspired by [MetroHero](https://github.com/jamespizzurro/metrohero-server).

## Features

### Real-Time Train Predictions
- Live data from WMATA's StationPrediction API
- **GTFS Realtime TripUpdates** for enhanced accuracy and schedule adherence data
- Automatic fallback to GTFS schedule data for trains 15+ minutes out
- Hybrid display merges real-time and scheduled trains seamlessly

### Multi-Line Transfer Support
- **All Metro lines supported**: Red, Orange, Silver, Blue, Yellow, Green
- Intelligent transfer point selection:
  - Metro Center (Red ↔ Orange/Silver/Blue)
  - Gallery Place (Red ↔ Yellow/Green)
  - L'Enfant Plaza (Orange/Silver/Blue ↔ Yellow/Green)
  - Fort Totten (Red ↔ Yellow/Green alternative)
- Automatically determines correct train direction on each line
- Calculates optimal transfer timing and routing

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

### Transfer Catchability
- Click a first-leg train to see which transfers you can catch
- Shows wait time at transfer station for each option
- Displays final arrival time at your destination
- Warns when connections are tight or missed

### Optimal Car Positioning
- **Visual car diagrams** showing which train car to board
- Position recommendations for fastest transfers at each station
- Shows which car to exit for your destination
- Legend explains optimal positioning strategy

### Dark Mode
- Toggle between light and dark themes
- Preference persisted in localStorage
- Eye-friendly for nighttime transit planning

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

## Data Sources

| Source | Usage |
|--------|-------|
| WMATA StationPrediction API | Real-time train arrivals (0-15 min) |
| WMATA GTFS Realtime (TripUpdates) | Schedule adherence and enhanced predictions |
| GTFS stop_times.txt | Travel times between stations |
| GTFS stops.txt | Station codes and names |
| schedule-data.js | Scheduled trains (15+ min out) |
| car-positions.js | Optimal boarding/exit car positions |

## Project Structure

```
TransferHero/
├── index.html             # Main app HTML structure
├── app.js                 # Core application logic (1,293 lines)
├── static-trips.js        # Static trip data processor
├── schedule-data.js       # GTFS-based schedule generation
├── style.css              # Custom styles
├── json-box.css           # Legacy styling
├── config.js              # API configuration
├── process-gtfs.py        # GTFS data processor
├── data/
│   ├── stations.js        # All Metro stations
│   ├── transfers.js       # Transfer point mappings
│   ├── travel-times.js    # GTFS-derived travel times
│   ├── car-positions.js   # Optimal boarding positions
│   └── line-config.js     # Line metadata
├── metro-gtfs/            # WMATA GTFS static data
│   ├── stops.txt
│   ├── stop_times.txt
│   ├── trips.txt
│   └── ...
└── README.md
```

## Setup

1. Clone the repository
2. Open `index.html` in a browser
3. No build step required - pure HTML/CSS/JS

### Updating GTFS Data

The app now uses **real GTFS data** instead of hardcoded values! To update:

**Option 1: Using the app**
1. Click "Refresh Data" button in the app header
2. Download will start automatically from WMATA API
3. Extract the zip file to `metro-gtfs/` folder
4. Run the processor: `python3 process-gtfs.py`

**Option 2: Manual update**
1. Download from [WMATA GTFS API](https://api.wmata.com/gtfs/rail-gtfs-static.zip)
2. Extract to `metro-gtfs/` folder (replacing existing files)
3. Run: `python3 process-gtfs.py`
4. This generates:
   - `data/travel-times.js` - Actual travel times between all station pairs
   - `schedule-data.js` - Schedule patterns based on real GTFS frequencies

The processor calculates:
- **Travel times**: Median travel time between every station pair from GTFS `stop_times.txt`
- **Schedule patterns**: Train frequencies and schedules from actual GTFS data
- **Smart merging**: Real-time API data (0-15 min) + GTFS schedules (15+ min)

## Todo

### High Priority
- [ ] **Use MetroHero open source algorithm for train time predictions** - Integrate more accurate prediction logic from the MetroHero project
- [ ] **Complete React migration** - See [react-migration.md](react-migration.md) for comprehensive migration plan
- [ ] **Overhaul UI to be prettier** - Modern design refresh beyond Bootstrap
- [ ] **Add actual train car locations** - Integrate PDF data from Reddit showing all exits/transfer/elevator positions on the platform

### Short Term
- [ ] Auto-refresh train data every 30 seconds
- [ ] Persist station selections in localStorage
- [ ] Show platform-level transfer walking directions
- [ ] Mobile-responsive design improvements

### Medium Term
- [x] Parse GTFS dynamically instead of hardcoded travel times ✅
- [x] Support Gallery Place as alternate transfer point ✅
- [x] Support all Metro lines (not just OR/SV to RD) ✅
- [ ] Multi-leg journey planning (A → B → C)
- [ ] Service advisories and alerts integration

### Long Term
- [ ] Historical delay patterns for better predictions
- [ ] Push notifications for departure reminders
- [ ] Offline support with service workers
- [ ] Mobile app (React Native or PWA)

## API Key

The app uses a demo WMATA API key. For production use, register for your own at [developer.wmata.com](https://developer.wmata.com/).

## License

MIT
