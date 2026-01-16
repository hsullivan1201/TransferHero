import path from 'path';
import { fileURLToPath } from 'url';
import { ExitParser } from './gtfs/exitParser.js'; // ensure extension if using pure ESM

// boilerplate to get __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = async () => {
  // now this works
  const stopsPath = path.resolve(__dirname, '../../../../../metro-gtfs/stops.txt');
  console.log(`reading stops from: ${stopsPath}`);
  
  const parser = new ExitParser(stopsPath);
  
  try {

    const exitMap = await parser.parseStationExits();
    
    // update your station list here
    const targetStations = [
      'N06', // NoMa-Gallaudet U
      'B11', // Union Station
      'F01', // Gallery Pl-Chinatown
      'A01', // Metro Center
      'C05', // Rosslyn (deep bore test)
      'B10', // Brookland-CUA
      'E04', // Columbia Heights
      'B08', // Silver Spring
      'A15', // Rockville
      'B09', // Forest Glen (deepest station, good edge case)
    ];

    // assuming your test runner loop looks something like this
    for (const code of targetStations) {
      const exits = exitMap.get(code); // or whatever your fetch fn is
      console.log("exists for stn "+code);
      console.table(exits);
    }
    console.log(`\n success! found exits for ${exitMap.size} stations.\n`);

    // let's inspect a complex station: l'enfant plaza (D03_F03)
    const lenfantExits = exitMap.get('D03_F03');
    if (lenfantExits) {
      console.log('--- l\'enfant plaza exits ---');
      console.table(lenfantExits);
    } else {
      console.error('error: could not find l\'enfant plaza (D03_F03)');
    }

    // inspect a random station: pentagon city (C08)
    const pentagonCity = exitMap.get('C08');
    if (pentagonCity) {
      console.log('\n--- pentagon city exits ---');
      console.table(pentagonCity);
    }

  } catch (err) {
    console.error('parsing failed:', err);
  }
};

run();