// Schedule data derived from WMATA GTFS
// Auto-generated: 2025-11-24 23:17:33
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
      frequency: 3,  // minutes between trains
      firstTrain: '05:40',
      lastTrain: '26:13'
    },
    'RD_SHADYGROVE_B35': {
      station: 'B35',
      line: 'RD',
      destination: 'SHADY GROVE',
      frequency: 4,  // minutes between trains
      firstTrain: '05:21',
      lastTrain: '25:57'
    },
    'RD_SHADYGROVE_B01': {
      station: 'B01',
      line: 'RD',
      destination: 'SHADY GROVE',
      frequency: 4,  // minutes between trains
      firstTrain: '05:27',
      lastTrain: '26:03'
    },
    'RD_SHADYGROVE_A01': {
      station: 'A01',
      line: 'RD',
      destination: 'SHADY GROVE',
      frequency: 4,  // minutes between trains
      firstTrain: '05:28',
      lastTrain: '26:06'
    },
    'BL_FRANCONIASPRINGFIELD_D03': {
      station: 'D03',
      line: 'BL',
      destination: 'FRANCONIA-SPRINGFIELD',
      frequency: 9,  // minutes between trains
      firstTrain: '05:18',
      lastTrain: '25:50'
    },
    'BL_FRANCONIASPRINGFIELD_C01': {
      station: 'C01',
      line: 'BL',
      destination: 'FRANCONIA-SPRINGFIELD',
      frequency: 9,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '25:54'
    },
    'BL_LARGO_C01': {
      station: 'C01',
      line: 'BL',
      destination: 'LARGO',
      frequency: 11,  // minutes between trains
      firstTrain: '05:37',
      lastTrain: '26:02'
    },
    'BL_LARGO_D03': {
      station: 'D03',
      line: 'BL',
      destination: 'LARGO',
      frequency: 11,  // minutes between trains
      firstTrain: '05:41',
      lastTrain: '26:06'
    },
    'GR_MOUNTVERNONSQUARE_F03': {
      station: 'F03',
      line: 'GR',
      destination: 'MOUNT VERNON SQUARE',
      frequency: 16,  // minutes between trains
      firstTrain: '06:20',
      lastTrain: '25:47'
    },
    'GR_MOUNTVERNONSQUARE_F01': {
      station: 'F01',
      line: 'GR',
      destination: 'MOUNT VERNON SQUARE',
      frequency: 16,  // minutes between trains
      firstTrain: '06:23',
      lastTrain: '25:50'
    },
    'GR_GREENBELT_F03': {
      station: 'F03',
      line: 'GR',
      destination: 'GREENBELT',
      frequency: 4,  // minutes between trains
      firstTrain: '05:20',
      lastTrain: '26:14'
    },
    'GR_GREENBELT_F01': {
      station: 'F01',
      line: 'GR',
      destination: 'GREENBELT',
      frequency: 4,  // minutes between trains
      firstTrain: '05:23',
      lastTrain: '26:17'
    },
    'GR_BRANCHAVE_F03': {
      station: 'F03',
      line: 'GR',
      destination: 'BRANCH AVE',
      frequency: 4,  // minutes between trains
      firstTrain: '05:28',
      lastTrain: '26:14'
    },
    'GR_BRANCHAVE_F01': {
      station: 'F01',
      line: 'GR',
      destination: 'BRANCH AVE',
      frequency: 4,  // minutes between trains
      firstTrain: '05:25',
      lastTrain: '25:56'
    },
    'YL_GREENBELT_F03': {
      station: 'F03',
      line: 'YL',
      destination: 'GREENBELT',
      frequency: 8,  // minutes between trains
      firstTrain: '06:22',
      lastTrain: '26:14'
    },
    'YL_GREENBELT_F01': {
      station: 'F01',
      line: 'YL',
      destination: 'GREENBELT',
      frequency: 8,  // minutes between trains
      firstTrain: '06:25',
      lastTrain: '26:17'
    },
    'YL_MOUNTVERNONSQUARE_F03': {
      station: 'F03',
      line: 'YL',
      destination: 'MOUNT VERNON SQUARE',
      frequency: 5,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '25:54'
    },
    'YL_MOUNTVERNONSQUARE_F01': {
      station: 'F01',
      line: 'YL',
      destination: 'MOUNT VERNON SQUARE',
      frequency: 5,  // minutes between trains
      firstTrain: '05:25',
      lastTrain: '25:57'
    },
    'YL_HUNTINGTON_F03': {
      station: 'F03',
      line: 'YL',
      destination: 'HUNTINGTON',
      frequency: 5,  // minutes between trains
      firstTrain: '05:22',
      lastTrain: '26:04'
    },
    'YL_HUNTINGTON_F01': {
      station: 'F01',
      line: 'YL',
      destination: 'HUNTINGTON',
      frequency: 5,  // minutes between trains
      firstTrain: '05:30',
      lastTrain: '26:01'
    },
    'OR_VIENNAFAIRFAXGMU_D03': {
      station: 'D03',
      line: 'OR',
      destination: 'VIENNA FAIRFAX-GMU',
      frequency: 7,  // minutes between trains
      firstTrain: '05:23',
      lastTrain: '26:00'
    },
    'OR_VIENNAFAIRFAXGMU_C01': {
      station: 'C01',
      line: 'OR',
      destination: 'VIENNA FAIRFAX-GMU',
      frequency: 7,  // minutes between trains
      firstTrain: '05:27',
      lastTrain: '26:06'
    },
    'OR_VIENNAFAIRFAXGMU_K01': {
      station: 'K01',
      line: 'OR',
      destination: 'VIENNA FAIRFAX-GMU',
      frequency: 7,  // minutes between trains
      firstTrain: '05:38',
      lastTrain: '26:17'
    },
    'OR_NEWCARROLLTON_K01': {
      station: 'K01',
      line: 'OR',
      destination: 'NEW CARROLLTON',
      frequency: 6,  // minutes between trains
      firstTrain: '05:20',
      lastTrain: '25:52'
    },
    'OR_NEWCARROLLTON_C01': {
      station: 'C01',
      line: 'OR',
      destination: 'NEW CARROLLTON',
      frequency: 6,  // minutes between trains
      firstTrain: '05:30',
      lastTrain: '26:02'
    },
    'OR_NEWCARROLLTON_D03': {
      station: 'D03',
      line: 'OR',
      destination: 'NEW CARROLLTON',
      frequency: 6,  // minutes between trains
      firstTrain: '05:34',
      lastTrain: '26:06'
    },
    'SV_ASHBURN_D03': {
      station: 'D03',
      line: 'SV',
      destination: 'ASHBURN',
      frequency: 6,  // minutes between trains
      firstTrain: '05:27',
      lastTrain: '25:55'
    },
    'SV_ASHBURN_C01': {
      station: 'C01',
      line: 'SV',
      destination: 'ASHBURN',
      frequency: 6,  // minutes between trains
      firstTrain: '05:31',
      lastTrain: '25:59'
    },
    'SV_ASHBURN_K01': {
      station: 'K01',
      line: 'SV',
      destination: 'ASHBURN',
      frequency: 6,  // minutes between trains
      firstTrain: '05:42',
      lastTrain: '26:10'
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
    'SV_LARGO_K01': {
      station: 'K01',
      line: 'SV',
      destination: 'LARGO',
      frequency: 9,  // minutes between trains
      firstTrain: '05:29',
      lastTrain: '25:54'
    },
    'SV_LARGO_C01': {
      station: 'C01',
      line: 'SV',
      destination: 'LARGO',
      frequency: 9,  // minutes between trains
      firstTrain: '05:39',
      lastTrain: '26:06'
    },
    'SV_LARGO_D03': {
      station: 'D03',
      line: 'SV',
      destination: 'LARGO',
      frequency: 9,  // minutes between trains
      firstTrain: '05:43',
      lastTrain: '26:10'
    },
    'SV_NEWCARROLLTON_K01': {
      station: 'K01',
      line: 'SV',
      destination: 'NEW CARROLLTON',
      frequency: 11,  // minutes between trains
      firstTrain: '05:23',
      lastTrain: '25:34'
    },
    'SV_NEWCARROLLTON_C01': {
      station: 'C01',
      line: 'SV',
      destination: 'NEW CARROLLTON',
      frequency: 11,  // minutes between trains
      firstTrain: '05:33',
      lastTrain: '25:44'
    },
    'SV_NEWCARROLLTON_D03': {
      station: 'D03',
      line: 'SV',
      destination: 'NEW CARROLLTON',
      frequency: 11,  // minutes between trains
      firstTrain: '05:37',
      lastTrain: '25:48'
    }
  }
};


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
