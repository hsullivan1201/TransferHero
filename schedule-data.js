// Schedule data derived from WMATA GTFS
// Auto-generated: 2025-11-30 18:05:59
// This generates scheduled trains based on actual GTFS data

const SCHEDULE_CONFIG = {
  patterns: {
    'RD_GLENMONT_A01': {
      station: 'A01',
      line: 'RD',
      destination: 'GLENMONT',
      frequency: 3,  // minutes between trains
      firstTrain: '05:33',
      lastTrain: '26:06'
    },
    'RD_GLENMONT_B01': {
      station: 'B01',
      line: 'RD',
      destination: 'GLENMONT',
      frequency: 3,  // minutes between trains
      firstTrain: '05:34',
      lastTrain: '26:07'
    },
    'RD_GLENMONT_B35': {
      station: 'B35',
      line: 'RD',
      destination: 'GLENMONT',
      frequency: 2,  // minutes between trains
      firstTrain: '05:39',
      lastTrain: '26:13'
    },
    'RD_SHADYGROVE_B35': {
      station: 'B35',
      line: 'RD',
      destination: 'SHADY GROVE',
      frequency: 2,  // minutes between trains
      firstTrain: '05:21',
      lastTrain: '25:57'
    },
    'RD_SHADYGROVE_B01': {
      station: 'B01',
      line: 'RD',
      destination: 'SHADY GROVE',
      frequency: 2,  // minutes between trains
      firstTrain: '05:27',
      lastTrain: '26:03'
    },
    'RD_SHADYGROVE_A01': {
      station: 'A01',
      line: 'RD',
      destination: 'SHADY GROVE',
      frequency: 2,  // minutes between trains
      firstTrain: '05:28',
      lastTrain: '26:06'
    },
    'BL_FRANCONIASPRINGFIELD_D03': {
      station: 'D03',
      line: 'BL',
      destination: 'FRANCONIA-SPRINGFIELD',
      frequency: 4,  // minutes between trains
      firstTrain: '05:17',
      lastTrain: '25:50'
    },
    'BL_FRANCONIASPRINGFIELD_C01': {
      station: 'C01',
      line: 'BL',
      destination: 'FRANCONIA-SPRINGFIELD',
      frequency: 4,  // minutes between trains
      firstTrain: '05:21',
      lastTrain: '25:54'
    },
    'BL_LARGO_C01': {
      station: 'C01',
      line: 'BL',
      destination: 'LARGO',
      frequency: 3,  // minutes between trains
      firstTrain: '05:36',
      lastTrain: '26:02'
    },
    'BL_LARGO_D03': {
      station: 'D03',
      line: 'BL',
      destination: 'LARGO',
      frequency: 3,  // minutes between trains
      firstTrain: '05:40',
      lastTrain: '26:06'
    },
    'GR_GREENBELT_F03': {
      station: 'F03',
      line: 'GR',
      destination: 'GREENBELT',
      frequency: 3,  // minutes between trains
      firstTrain: '05:20',
      lastTrain: '26:14'
    },
    'GR_GREENBELT_F01': {
      station: 'F01',
      line: 'GR',
      destination: 'GREENBELT',
      frequency: 3,  // minutes between trains
      firstTrain: '05:23',
      lastTrain: '26:17'
    },
    'GR_BRANCHAVE_F03': {
      station: 'F03',
      line: 'GR',
      destination: 'BRANCH AVE',
      frequency: 4,  // minutes between trains
      firstTrain: '05:27',
      lastTrain: '26:14'
    },
    'GR_BRANCHAVE_F01': {
      station: 'F01',
      line: 'GR',
      destination: 'BRANCH AVE',
      frequency: 4,  // minutes between trains
      firstTrain: '05:24',
      lastTrain: '25:56'
    },
    'YL_MOUNTVERNONSQUARE_F03': {
      station: 'F03',
      line: 'YL',
      destination: 'MOUNT VERNON SQUARE',
      frequency: 3,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '25:54'
    },
    'YL_MOUNTVERNONSQUARE_F01': {
      station: 'F01',
      line: 'YL',
      destination: 'MOUNT VERNON SQUARE',
      frequency: 3,  // minutes between trains
      firstTrain: '05:25',
      lastTrain: '25:57'
    },
    'YL_GREENBELT_F03': {
      station: 'F03',
      line: 'YL',
      destination: 'GREENBELT',
      frequency: 6,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '25:56'
    },
    'YL_GREENBELT_F01': {
      station: 'F01',
      line: 'YL',
      destination: 'GREENBELT',
      frequency: 6,  // minutes between trains
      firstTrain: '05:25',
      lastTrain: '25:59'
    },
    'YL_HUNTINGTON_F01': {
      station: 'F01',
      line: 'YL',
      destination: 'HUNTINGTON',
      frequency: 4,  // minutes between trains
      firstTrain: '05:28',
      lastTrain: '26:01'
    },
    'YL_HUNTINGTON_F03': {
      station: 'F03',
      line: 'YL',
      destination: 'HUNTINGTON',
      frequency: 4,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '26:04'
    },
    'OR_VIENNAFAIRFAXGMU_D03': {
      station: 'D03',
      line: 'OR',
      destination: 'VIENNA FAIRFAX-GMU',
      frequency: 3,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '26:00'
    },
    'OR_VIENNAFAIRFAXGMU_C01': {
      station: 'C01',
      line: 'OR',
      destination: 'VIENNA FAIRFAX-GMU',
      frequency: 3,  // minutes between trains
      firstTrain: '05:26',
      lastTrain: '26:06'
    },
    'OR_VIENNAFAIRFAXGMU_K01': {
      station: 'K01',
      line: 'OR',
      destination: 'VIENNA FAIRFAX-GMU',
      frequency: 3,  // minutes between trains
      firstTrain: '05:36',
      lastTrain: '26:17'
    },
    'OR_WESTFALLSCHURCH_D03': {
      station: 'D03',
      line: 'OR',
      destination: 'WEST FALLS CHURCH',
      frequency: 2,  // minutes between trains
      firstTrain: '18:47',
      lastTrain: '22:19'
    },
    'OR_WESTFALLSCHURCH_C01': {
      station: 'C01',
      line: 'OR',
      destination: 'WEST FALLS CHURCH',
      frequency: 2,  // minutes between trains
      firstTrain: '18:51',
      lastTrain: '22:23'
    },
    'OR_WESTFALLSCHURCH_K01': {
      station: 'K01',
      line: 'OR',
      destination: 'WEST FALLS CHURCH',
      frequency: 2,  // minutes between trains
      firstTrain: '19:01',
      lastTrain: '22:34'
    },
    'OR_NEWCARROLLTON_K01': {
      station: 'K01',
      line: 'OR',
      destination: 'NEW CARROLLTON',
      frequency: 3,  // minutes between trains
      firstTrain: '05:19',
      lastTrain: '25:50'
    },
    'OR_NEWCARROLLTON_C01': {
      station: 'C01',
      line: 'OR',
      destination: 'NEW CARROLLTON',
      frequency: 3,  // minutes between trains
      firstTrain: '05:29',
      lastTrain: '26:00'
    },
    'OR_NEWCARROLLTON_D03': {
      station: 'D03',
      line: 'OR',
      destination: 'NEW CARROLLTON',
      frequency: 3,  // minutes between trains
      firstTrain: '05:33',
      lastTrain: '26:04'
    },
    'SV_ASHBURN_D03': {
      station: 'D03',
      line: 'SV',
      destination: 'ASHBURN',
      frequency: 2,  // minutes between trains
      firstTrain: '05:25',
      lastTrain: '25:54'
    },
    'SV_ASHBURN_C01': {
      station: 'C01',
      line: 'SV',
      destination: 'ASHBURN',
      frequency: 2,  // minutes between trains
      firstTrain: '05:29',
      lastTrain: '25:58'
    },
    'SV_ASHBURN_K01': {
      station: 'K01',
      line: 'SV',
      destination: 'ASHBURN',
      frequency: 3,  // minutes between trains
      firstTrain: '05:39',
      lastTrain: '26:09'
    },
    'SV_WIEHLERESTONEAST_D03': {
      station: 'D03',
      line: 'SV',
      destination: 'WIEHLE RESTON EAST',
      frequency: 9,  // minutes between trains
      firstTrain: '17:10',
      lastTrain: '17:19'
    },
    'SV_WIEHLERESTONEAST_C01': {
      station: 'C01',
      line: 'SV',
      destination: 'WIEHLE RESTON EAST',
      frequency: 9,  // minutes between trains
      firstTrain: '17:14',
      lastTrain: '17:23'
    },
    'SV_WIEHLERESTONEAST_K01': {
      station: 'K01',
      line: 'SV',
      destination: 'WIEHLE RESTON EAST',
      frequency: 9,  // minutes between trains
      firstTrain: '17:25',
      lastTrain: '17:34'
    },
    'SV_NEWCARROLLTON_K01': {
      station: 'K01',
      line: 'SV',
      destination: 'NEW CARROLLTON',
      frequency: 6,  // minutes between trains
      firstTrain: '05:23',
      lastTrain: '25:44'
    },
    'SV_NEWCARROLLTON_C01': {
      station: 'C01',
      line: 'SV',
      destination: 'NEW CARROLLTON',
      frequency: 6,  // minutes between trains
      firstTrain: '05:33',
      lastTrain: '25:54'
    },
    'SV_NEWCARROLLTON_D03': {
      station: 'D03',
      line: 'SV',
      destination: 'NEW CARROLLTON',
      frequency: 6,  // minutes between trains
      firstTrain: '05:37',
      lastTrain: '25:58'
    },
    'SV_LARGO_K01': {
      station: 'K01',
      line: 'SV',
      destination: 'LARGO',
      frequency: 7,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '25:54'
    },
    'SV_LARGO_C01': {
      station: 'C01',
      line: 'SV',
      destination: 'LARGO',
      frequency: 7,  // minutes between trains
      firstTrain: '05:32',
      lastTrain: '26:06'
    },
    'SV_LARGO_D03': {
      station: 'D03',
      line: 'SV',
      destination: 'LARGO',
      frequency: 7,  // minutes between trains
      firstTrain: '05:36',
      lastTrain: '26:10'
    }
  }
};


// Helper functions for schedule generation
/**
 * Ensures value is an array
 * @template T
 * @param {T|T[]} value - Value that may or may not be an array
 * @returns {T[]} Value as array
 */
function ensureArray(value) {
  return Array.isArray(value) ? value : [value];
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
  const terminusList = ensureArray(terminus);
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
