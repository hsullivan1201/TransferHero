#!/usr/bin/env python3
"""
Process WMATA GTFS data to generate accurate travel times and schedules.
Reads from metro-gtfs/ folder and generates data/*.js files.
"""

import csv
import json
from collections import defaultdict
from datetime import datetime, timedelta
import statistics

def parse_time(time_str):
    """Convert HH:MM:SS to minutes since midnight"""
    h, m, s = map(int, time_str.split(':'))
    return h * 60 + m + (s / 60)

def platform_to_station_code(platform_id):
    """
    Convert platform ID like 'PF_A01_1' to station code like 'A01'
    Also handle platform codes like 'PF_C01_C'
    """
    if not platform_id.startswith('PF_'):
        return None
    parts = platform_id.replace('PF_', '').split('_')
    if len(parts) >= 1:
        return parts[0]
    return None

def load_stops():
    """Load station and platform information"""
    stops = {}
    platforms = {}

    with open('metro-gtfs/stops.txt', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            stop_id = row['stop_id']
            stops[stop_id] = row

            # Map platform to station code
            if stop_id.startswith('PF_'):
                station_code = platform_to_station_code(stop_id)
                if station_code:
                    platforms[stop_id] = {
                        'code': station_code,
                        'name': row['stop_name'],
                        'parent': row.get('parent_station', '')
                    }

    return stops, platforms

def load_routes():
    """Load route information"""
    routes = {}
    with open('metro-gtfs/routes.txt', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            route_id = row['route_id']
            routes[route_id] = row
    return routes

def load_trips():
    """Load trip information"""
    trips = {}
    with open('metro-gtfs/trips.txt', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            trip_id = row['trip_id']
            trips[trip_id] = row
    return trips

def calculate_travel_times():
    """
    Calculate average travel times between all station pairs from stop_times.
    Returns a dict of {from_station}_{to_station}: minutes
    """
    print("Loading GTFS data...")
    stops, platforms = load_stops()
    trips = load_trips()

    # Store all travel time samples
    travel_samples = defaultdict(list)

    print("Processing stop times...")
    with open('metro-gtfs/stop_times.txt', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        # Group by trip
        current_trip = None
        trip_stops = []

        for row in reader:
            trip_id = row['trip_id']

            # When we switch to a new trip, process the previous one
            if trip_id != current_trip:
                if trip_stops:
                    process_trip_stops(trip_stops, platforms, travel_samples)
                trip_stops = []
                current_trip = trip_id

            # Add this stop to the current trip
            trip_stops.append({
                'platform': row['stop_id'],
                'arrival': parse_time(row['arrival_time']),
                'sequence': int(row['stop_sequence'])
            })

        # Process last trip
        if trip_stops:
            process_trip_stops(trip_stops, platforms, travel_samples)

    print(f"Found {len(travel_samples)} unique station pairs")

    # Calculate median travel times
    travel_times = {}
    for key, samples in travel_samples.items():
        if samples:
            # Use median to avoid outliers
            travel_times[key] = round(statistics.median(samples))

    return travel_times

def process_trip_stops(trip_stops, platforms, travel_samples):
    """Process stops for a single trip to extract travel times"""
    # Calculate travel time between each consecutive pair
    for i in range(len(trip_stops) - 1):
        from_stop = trip_stops[i]
        to_stop = trip_stops[i + 1]

        # Get station codes
        from_platform = from_stop['platform']
        to_platform = to_stop['platform']

        if from_platform not in platforms or to_platform not in platforms:
            continue

        from_code = platforms[from_platform]['code']
        to_code = platforms[to_platform]['code']

        # Calculate travel time
        travel_time = to_stop['arrival'] - from_stop['arrival']

        if travel_time > 0 and travel_time < 120:  # Sanity check: 0-120 minutes
            key = f"{from_code}_{to_code}"
            travel_samples[key].append(travel_time)

def generate_schedule_patterns():
    """
    Generate schedule patterns for common routes.
    Returns patterns dict for schedule-data.js
    """
    print("Generating schedule patterns...")
    stops, platforms = load_stops()
    trips_data = load_trips()
    routes = load_routes()

    # Map route names to short codes
    route_map = {
        'RED': 'RD',
        'BLUE': 'BL',
        'ORANGE': 'OR',
        'SILVER': 'SV',
        'GREEN': 'GR',
        'YELLOW': 'YL'
    }

    # Key transfer stations we want schedules for
    key_stations = {
        'A01', 'C01', 'D03', 'B01', 'F01', 'F03', 'K01', 'B35'
    }

    # Group trips by route, headsign, and ALL stations (not just first)
    route_trips = defaultdict(list)

    with open('metro-gtfs/stop_times.txt', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)

        current_trip = None
        trip_stops = []

        for row in reader:
            trip_id = row['trip_id']

            # When we switch to a new trip
            if trip_id != current_trip:
                # Process the previous trip's stops
                if trip_stops and current_trip in trips_data:
                    trip_info = trips_data[current_trip]
                    route_id = trip_info['route_id']
                    headsign = trip_info['trip_headsign'].strip()

                    if route_id in route_map:
                        # Record timing for each stop in the trip
                        for stop in trip_stops:
                            if stop['station'] in key_stations:
                                key = (route_id, headsign, stop['station'])
                                route_trips[key].append(stop['time'])

                # Start new trip
                trip_stops = []
                current_trip = trip_id

            # Add stop to current trip
            platform = row['stop_id']
            if platform in platforms:
                trip_stops.append({
                    'platform': platform,
                    'station': platforms[platform]['code'],
                    'time': parse_time(row['departure_time'])
                })

        # Process last trip
        if trip_stops and current_trip in trips_data:
            trip_info = trips_data[current_trip]
            route_id = trip_info['route_id']
            headsign = trip_info['trip_headsign'].strip()

            if route_id in route_map:
                for stop in trip_stops:
                    if stop['station'] in key_stations:
                        key = (route_id, headsign, stop['station'])
                        route_trips[key].append(stop['time'])

    # Calculate frequencies for each route/direction/station combo
    patterns = {}
    for (route_id, headsign, station), times in route_trips.items():
        if len(times) < 2:
            continue

        # Sort times
        times.sort()

        # Calculate intervals between trains
        intervals = [times[i+1] - times[i] for i in range(len(times) - 1)]
        intervals = [iv for iv in intervals if 2 <= iv <= 30]  # Filter outliers

        if not intervals:
            continue

        # Use median interval as frequency
        frequency = round(statistics.median(intervals))

        route_code = route_map.get(route_id, route_id)
        first_train = times[0]
        last_train = times[-1]

        # Format time
        def format_time(minutes):
            hours = int(minutes // 60)
            mins = int(minutes % 60)
            return f"{hours:02d}:{mins:02d}"

        # Create pattern key
        # Clean up headsign
        headsign_clean = headsign.replace(' ', '').replace('-', '')
        pattern_key = f"{route_code}_{headsign_clean}_{station}"

        patterns[pattern_key] = {
            'station': station,
            'line': route_code,
            'destination': headsign,
            'frequency': frequency,
            'firstTrain': format_time(first_train),
            'lastTrain': format_time(last_train),
            'sampleSize': len(times)
        }

    return patterns

def generate_js_file(travel_times, patterns):
    """Generate the JavaScript files"""

    # Generate travel-times.js
    print("Writing travel-times.js...")
    with open('data/travel-times.js', 'w', encoding='utf-8') as f:
        f.write("// Travel times (in minutes) between stations\n")
        f.write("// Auto-generated from WMATA GTFS data\n")
        f.write(f"// Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("// Format: 'FROM_TO': minutes\n\n")
        f.write("const TRAVEL_TIMES = {\n")

        # Sort by key for readability
        sorted_times = sorted(travel_times.items())
        for i, (key, minutes) in enumerate(sorted_times):
            comma = ',' if i < len(sorted_times) - 1 else ''
            f.write(f"  '{key}': {minutes}{comma}\n")

        f.write("};\n")

    # Generate schedule-data.js with realistic patterns
    print("Writing schedule-data.js...")
    with open('schedule-data.js', 'w', encoding='utf-8') as f:
        f.write("// Schedule data derived from WMATA GTFS\n")
        f.write(f"// Auto-generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("// This generates scheduled trains based on actual GTFS data\n\n")

        f.write("const SCHEDULE_CONFIG = {\n")
        f.write("  patterns: {\n")

        # Write patterns
        pattern_items = list(patterns.items())
        for i, (key, data) in enumerate(pattern_items):
            comma = ',' if i < len(pattern_items) - 1 else ''
            f.write(f"    '{key}': {{\n")
            f.write(f"      station: '{data['station']}',\n")
            f.write(f"      line: '{data['line']}',\n")
            f.write(f"      destination: '{data['destination']}',\n")
            f.write(f"      frequency: {data['frequency']},  // minutes between trains\n")
            f.write(f"      firstTrain: '{data['firstTrain']}',\n")
            f.write(f"      lastTrain: '{data['lastTrain']}'\n")
            f.write(f"    }}{comma}\n")

        f.write("  }\n")
        f.write("};\n\n")

        # Copy the helper functions from the old schedule-data.js
        f.write("""
// Helper functions for schedule generation
function isPeakHours() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  // Weekday peak: 6-9am and 4-7pm
  if (day >= 1 && day <= 5) {
    return (hour >= 6 && hour < 9) || (hour >= 16 && hour < 19);
  }
  return false;
}

function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

function getCurrentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function generateScheduledTrains(patternKey, startFromMinutes = 0) {
  const pattern = SCHEDULE_CONFIG.patterns[patternKey];
  if (!pattern) return [];

  const currentMinutes = getCurrentMinutes();
  const frequency = pattern.frequency;
  const firstTrainMin = timeToMinutes(pattern.firstTrain);
  const lastTrainMin = timeToMinutes(pattern.lastTrain);

  const trains = [];
  const searchStart = currentMinutes + startFromMinutes;

  let trainTime = firstTrainMin;
  while (trainTime < searchStart && trainTime <= lastTrainMin) {
    trainTime += frequency;
  }

  for (let i = 0; i < 8 && trainTime <= lastTrainMin; i++) {
    const minFromNow = trainTime - currentMinutes;
    if (minFromNow >= startFromMinutes && minFromNow <= 60) {
      trains.push({
        Line: pattern.line,
        Destination: pattern.destination,
        DestinationName: pattern.destination,
        Min: minFromNow.toString(),
        Car: '8',
        _scheduled: true
      });
    }
    trainTime += frequency;
  }

  return trains;
}

function getScheduledTrains(stationCode, terminus, startFromMinutes = 0) {
  const terminusList = Array.isArray(terminus) ? terminus : [terminus];
  let allTrains = [];

  for (const [patternKey, pattern] of Object.entries(SCHEDULE_CONFIG.patterns)) {
    if (pattern.station === stationCode) {
      // Case-insensitive matching for destination names
      const patternDestLower = pattern.destination.toLowerCase();
      if (terminusList.some(t => patternDestLower.includes(t.toLowerCase()))) {
        const generatedTrains = generateScheduledTrains(patternKey, startFromMinutes);
        allTrains = allTrains.concat(generatedTrains);
      }
    }
  }

  allTrains.sort((a, b) => parseInt(a.Min) - parseInt(b.Min));
  return allTrains;
}

function mergeWithSchedule(apiTrains, stationCode, terminus, startFromMinutes = 0) {
  const scheduledTrains = getScheduledTrains(stationCode, terminus, startFromMinutes);
  const merged = [];
  const apiTimes = new Set(apiTrains.map(t => parseInt(t.Min) || 0));

  // Add all API trains first (real-time data takes priority)
  for (const train of apiTrains) {
    merged.push({ ...train, _scheduled: false });
  }

  // Add scheduled trains for longer-term predictions (15+ minutes)
  for (const train of scheduledTrains) {
    const trainMin = parseInt(train.Min);
    if (trainMin >= 15) {
      const hasCloseMatch = [...apiTimes].some(t => Math.abs(t - trainMin) < 3);
      if (!hasCloseMatch) {
        merged.push(train);
      }
    }
  }

  // Sort by time
  merged.sort((a, b) => {
    const aMin = a.Min === 'ARR' || a.Min === 'BRD' ? 0 : parseInt(a.Min);
    const bMin = b.Min === 'ARR' || b.Min === 'BRD' ? 0 : parseInt(b.Min);
    return aMin - bMin;
  });

  return merged;
}
""")

def main():
    print("=" * 60)
    print("WMATA GTFS Data Processor")
    print("=" * 60)

    try:
        # Calculate travel times
        travel_times = calculate_travel_times()

        # Generate schedule patterns
        patterns = generate_schedule_patterns()

        # Generate JavaScript files
        generate_js_file(travel_times, patterns)

        print("\n" + "=" * 60)
        print("✓ Success!")
        print(f"✓ Generated {len(travel_times)} travel time entries")
        print(f"✓ Generated {len(patterns)} schedule patterns")
        print("✓ Files written:")
        print("  - data/travel-times.js")
        print("  - schedule-data.js")
        print("=" * 60)

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

    return 0

if __name__ == '__main__':
    exit(main())
