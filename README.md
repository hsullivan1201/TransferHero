# TransferHero

A DC Metro transfer assistant that helps riders plan connections between Orange/Silver and Red lines using real-time WMATA data. Inspired by [MetroHero](https://github.com/jamespizzurro/metrohero-server).

## Features

### Real-Time Train Predictions
- Live data from WMATA's StationPrediction API
- Automatic fallback to GTFS schedule data for trains 15+ minutes out
- Hybrid display merges real-time and scheduled trains seamlessly

### Smart Transfer Planning
- Select any Orange/Silver line station as your origin
- Select any Red Line station as your destination
- Automatically determines correct train direction on each line
- Calculates transfer timing at Metro Center

### Journey Time Display
- **Clock times** shown alongside "X minutes" for every train
- **Travel time** from origin to Metro Center (from GTFS data)
- **Transfer walk time** (configurable 1-15 minutes)
- **Total journey time** with arrival clock time at destination

### Transfer Catchability
- Click a first-leg train to see which transfers you can catch
- Shows wait time at Metro Center for each option
- Displays final arrival time at your destination
- Warns when connections are tight or missed

## How It Works

1. **Select Stations**: Pick your origin (Orange/Silver/Blue) and destination (Red Line)
2. **View First Leg**: See real-time trains heading toward Metro Center
3. **Click a Train**: Select which train you'll take
4. **See Transfer Options**: View catchable Red Line trains with:
   - Wait time at Metro Center
   - Final arrival time at destination
   - Total journey duration

## Data Sources

| Source | Usage |
|--------|-------|
| WMATA StationPrediction API | Real-time train arrivals (0-15 min) |
| GTFS stop_times.txt | Travel times between stations |
| GTFS stops.txt | Station codes and names |
| schedule-data.js | Scheduled trains (15+ min out) |

## Project Structure

```
TransferHero/
├── index.html          # Main app (HTML + JS)
├── json-box.css        # Styling
├── schedule-data.js    # GTFS-based schedule generation
├── metro-gtfs/         # WMATA GTFS data
│   ├── stops.txt       # Station information
│   ├── stop_times.txt  # Timetables
│   ├── trips.txt       # Trip definitions
│   ├── routes.txt      # Line colors/info
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

## Potential Next Steps

### Short Term
- [ ] Auto-refresh train data every 30 seconds
- [ ] Add reverse direction (Red to Orange/Silver)
- [ ] Support Gallery Place as alternate transfer point
- [ ] Persist station selections in localStorage

### Medium Term
- [ ] Add Blue/Yellow/Green line support
- [x] Parse GTFS dynamically instead of hardcoded travel times ✅
- [ ] Show platform-level transfer walking directions
- [ ] Mobile-responsive design improvements

### Long Term
- [ ] Multi-leg journey planning (A → B → C)
- [ ] Historical delay patterns for better predictions
- [ ] Push notifications for departure reminders
- [ ] Offline support with service workers

## API Key

The app uses a demo WMATA API key. For production use, register for your own at [developer.wmata.com](https://developer.wmata.com/).

## License

MIT
