// TransferHero - DC Metro Transfer Assistant
// Main application logic

// ========== STATE ==========
let currentTrip = null;
let protoRoot = null; // for gtfs-rt caching

// ========== THEME MANAGEMENT ==========
function toggleTheme() {
  const body = document.body;
  const themeIcon = document.getElementById('theme-icon');
  const isDark = body.classList.toggle('dark-mode');

  themeIcon.innerHTML = isDark
    ? '<i class="fas fa-sun"></i>'
    : '<i class="fas fa-moon"></i>';

  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
      themeIcon.innerHTML = '<i class="fas fa-sun"></i>';
    }
  }
}

// ========== STATION TYPEAHEAD ==========
function onStationInput(field) {
  const input = document.getElementById(`${field}-station`);
  const suggestions = document.getElementById(`${field}-suggestions`);
  const query = input.value.toLowerCase().trim();

  if (query.length < 1) {
    suggestions.classList.remove('show');
    return;
  }

  const matches = ALL_STATIONS.filter(s =>
    s.name.toLowerCase().includes(query) ||
    s.code.toLowerCase().includes(query)
  ).slice(0, 10);

  if (matches.length === 0) {
    suggestions.classList.remove('show');
    return;
  }

  suggestions.innerHTML = matches.map(s => `
    <div class="station-suggestion" onmousedown="selectStation('${field}', '${s.code}', '${escapeHtml(s.name)}', ${JSON.stringify(s.lines).replace(/"/g, '&quot;')})">
      <div class="lines">${s.lines.map(l => `<span class="line-dot ${l}"></span>`).join('')}</div>
      <span>${s.name}</span>
    </div>
  `).join('');
  suggestions.classList.add('show');
}

function onStationFocus(field) {
  const input = document.getElementById(`${field}-station`);
  if (input.value.length > 0) onStationInput(field);
}

function onStationBlur(field) {
  setTimeout(() => {
    document.getElementById(`${field}-suggestions`).classList.remove('show');
  }, 150);
}

function selectStation(field, code, name, lines) {
  document.getElementById(`${field}-station`).value = name;
  document.getElementById(`${field}-station-code`).value = code;
  document.getElementById(`${field}-suggestions`).classList.remove('show');
  showSelectedStation(field, name, lines);
  checkCanGo();
}

function showSelectedStation(field, name, lines) {
  const inputContainer = document.getElementById(`${field}-station`).closest('.station-input-container');
  const input = document.getElementById(`${field}-station`);
  const display = inputContainer.querySelector('.selected-station-display');

  if (!display) {
    const newDisplay = document.createElement('div');
    newDisplay.className = 'selected-station-display';
    newDisplay.onclick = () => clearStation(field);
    newDisplay.innerHTML = `
      <div class="selected-station-lines"></div>
      <div class="selected-station-name"></div>
      <a href="#" class="change-station-btn" onclick="event.stopPropagation(); clearStation('${field}'); return false;">
        <i class="fas fa-times"></i>
      </a>
    `;
    inputContainer.appendChild(newDisplay);
  }

  const displayEl = inputContainer.querySelector('.selected-station-display');
  const linesContainer = displayEl.querySelector('.selected-station-lines');
  const nameContainer = displayEl.querySelector('.selected-station-name');

  linesContainer.innerHTML = lines.map(l => `<span class="line-dot ${l}"></span>`).join('');
  nameContainer.textContent = name;

  input.style.display = 'none';
  displayEl.classList.add('show');
}

function clearStation(field) {
  const inputContainer = document.getElementById(`${field}-station`).closest('.station-input-container');
  const input = document.getElementById(`${field}-station`);
  const display = inputContainer.querySelector('.selected-station-display');
  const codeInput = document.getElementById(`${field}-station-code`);

  input.value = '';
  codeInput.value = '';

  if (display) {
    display.classList.remove('show');
  }
  input.style.display = 'block';
  input.focus();

  checkCanGo();
}

function checkCanGo() {
  const fromCode = document.getElementById('from-station-code').value;
  const toCode = document.getElementById('to-station-code').value;
  const canGo = fromCode && toCode && fromCode !== toCode;
  document.getElementById('go-button').disabled = !canGo;

  if (canGo) {
    const transfer = findTransfer(fromCode, toCode);
    if (transfer) {
      document.getElementById('transfer-station-name').innerText = transfer.name;
      document.getElementById('transfer-station-display').style.display = 'block';
    }
  }
}

// Platform code mapping for multi-code stations
const PLATFORM_CODES = {
  'A01': { 'RD': 'A01', 'OR': 'C01', 'SV': 'C01', 'BL': 'C01' },  // Metro Center
  'C01': { 'RD': 'A01', 'OR': 'C01', 'SV': 'C01', 'BL': 'C01' },  // Metro Center (alt)
  'B01': { 'RD': 'B01', 'YL': 'F01', 'GR': 'F01' },                // Gallery Place
  'F01': { 'RD': 'B01', 'YL': 'F01', 'GR': 'F01' },                // Gallery Place (alt)
  'B06': { 'RD': 'B06', 'YL': 'E06', 'GR': 'E06' },                // Fort Totten
  'E06': { 'RD': 'B06', 'YL': 'E06', 'GR': 'E06' },                // Fort Totten (alt)
  'D03': { 'OR': 'D03', 'SV': 'D03', 'BL': 'D03', 'YL': 'F03', 'GR': 'F03' },  // L'Enfant
  'F03': { 'OR': 'D03', 'SV': 'D03', 'BL': 'D03', 'YL': 'F03', 'GR': 'F03' }   // L'Enfant (alt)
};

// Get the correct platform code for a specific line at a multi-code station
function getPlatformForLine(stationCode, line) {
  if (PLATFORM_CODES[stationCode] && PLATFORM_CODES[stationCode][line]) {
    return PLATFORM_CODES[stationCode][line];
  }
  return stationCode;
}

// Find all possible transfer stations between origin and destination
function findAllPossibleTransfers(fromCode, toCode) {
  const fromStation = ALL_STATIONS.find(s => s.code === fromCode);
  const toStation = ALL_STATIONS.find(s => s.code === toCode);
  if (!fromStation || !toStation) return [];

  const transfers = [];
  const seen = new Set();

  // Check each combination of lines
  for (const fromLine of fromStation.lines) {
    for (const toLine of toStation.lines) {
      // 1. Check explicit TRANSFERS object
      const key = `${fromLine}_${toLine}`;
      const keyFT = `${fromLine}_${toLine}_FT`;  // Fort Totten variant

      if (TRANSFERS[key]) {
        const transfer = TRANSFERS[key];
        const uniqueKey = `${transfer.station}_${transfer.fromPlatform}_${transfer.toPlatform}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          transfers.push({
            ...transfer,
            fromLine: fromLine,
            toLine: toLine
          });
        }
      }

      if (TRANSFERS[keyFT]) {
        const transfer = TRANSFERS[keyFT];
        const uniqueKey = `${transfer.station}_${transfer.fromPlatform}_${transfer.toPlatform}`;
        if (!seen.has(uniqueKey)) {
          seen.add(uniqueKey);
          transfers.push({
            ...transfer,
            fromLine: fromLine,
            toLine: toLine
          });
        }
      }

      // 2. Check for implicit transfers at multi-line stations
      const fromLineStations = LINE_STATIONS[fromLine] || [];
      const toLineStations = LINE_STATIONS[toLine] || [];

      // Find stations that appear on both lines
      for (const stationCode of fromLineStations) {
        if (toLineStations.includes(stationCode)) {
          // This station serves both lines - it's a valid transfer point
          const station = ALL_STATIONS.find(s => s.code === stationCode ||
            (PLATFORM_CODES[s.code] && Object.values(PLATFORM_CODES[s.code]).includes(stationCode)));

          if (station && station.lines.includes(fromLine) && station.lines.includes(toLine)) {
            const fromPlatform = getPlatformForLine(station.code, fromLine);
            const toPlatform = getPlatformForLine(station.code, toLine);
            const uniqueKey = `${station.code}_${fromPlatform}_${toPlatform}`;

            if (!seen.has(uniqueKey)) {
              seen.add(uniqueKey);
              transfers.push({
                station: station.code,
                name: station.name,
                fromPlatform: fromPlatform,
                toPlatform: toPlatform,
                fromLine: fromLine,
                toLine: toLine
              });
            }
          }
        }
      }
    }
  }

  return transfers;
}

// Evaluate the total journey time for a specific transfer route
function evaluateTransferRoute(fromCode, toCode, transfer) {
  const transferWalkTime = getTransferWalkTime();

  // Calculate leg 1: from origin to transfer station
  const leg1Time = calculateRouteTravelTime(fromCode, transfer.fromPlatform, transfer.fromLine);

  // Calculate leg 2: from transfer station to destination
  const leg2Time = calculateRouteTravelTime(transfer.toPlatform, toCode, transfer.toLine);

  const totalTime = leg1Time + transferWalkTime + leg2Time;

  return {
    transfer: transfer,
    leg1Time: leg1Time,
    transferTime: transferWalkTime,
    leg2Time: leg2Time,
    totalTime: totalTime
  };
}

function findTransfer(fromCode, toCode) {
  const fromStation = ALL_STATIONS.find(s => s.code === fromCode);
  const toStation = ALL_STATIONS.find(s => s.code === toCode);
  if (!fromStation || !toStation) return null;

  // Check for direct route
  const sharedLines = fromStation.lines.filter(l => toStation.lines.includes(l));
  if (sharedLines.length > 0) {
    return { name: 'Direct (no transfer)', station: null, direct: true, line: sharedLines[0] };
  }

  // Find all possible transfers
  const allTransfers = findAllPossibleTransfers(fromCode, toCode);

  if (allTransfers.length === 0) {
    // Fallback to Metro Center
    return { name: 'Metro Center', station: 'A01', fromPlatform: 'C01', toPlatform: 'A01' };
  }

  // If only one transfer option, return it
  if (allTransfers.length === 1) {
    return allTransfers[0];
  }

  // Evaluate each transfer option
  const evaluatedRoutes = allTransfers.map(transfer =>
    evaluateTransferRoute(fromCode, toCode, transfer)
  );

  // Sort by total time (fastest first)
  evaluatedRoutes.sort((a, b) => a.totalTime - b.totalTime);

  // Return fastest option
  const fastest = evaluatedRoutes[0];

  console.log(`[Pathfinding] ${fromStation.name} → ${toStation.name}:`);
  evaluatedRoutes.forEach((route, idx) => {
    console.log(`  ${idx === 0 ? '✓' : ' '} ${route.transfer.name}: ${route.totalTime} min (${route.leg1Time} + ${route.transferTime} + ${route.leg2Time})`);
  });

  return {
    ...fastest.transfer,
    totalTime: fastest.totalTime,
    leg1Time: fastest.leg1Time,
    leg2Time: fastest.leg2Time,
    alternatives: evaluatedRoutes.slice(1, 3).map(r => r.transfer)  // Store up to 2 alternatives
  };
}

// ========== CAR DIAGRAM ==========
function renderCarDiagram(elementId, numCars, highlightCar, isBoard) {
  const row = document.getElementById(elementId);
  row.innerHTML = '';
  for (let i = 1; i <= numCars; i++) {
    const carBox = document.createElement('div');
    carBox.className = 'car-box';
    if (i === highlightCar) {
      carBox.classList.add(isBoard ? 'highlight-board' : 'highlight-exit');
      carBox.innerHTML = `<span class="car-marker">${isBoard ? '▼' : '▲'}</span>${i}`;
    } else {
      carBox.textContent = i;
    }
    row.appendChild(carBox);
  }
}

function showCarDiagrams() {
  if (!currentTrip || !currentTrip.transfer) return;

  const posKey = `${currentTrip.transfer.fromPlatform}_${currentTrip.transfer.toPlatform}`;
  const pos = CAR_POSITIONS[posKey] || CAR_POSITIONS['default'];

  document.getElementById('car-diagram-1').style.display = 'block';
  renderCarDiagram('car-row-1', 8, pos.boardCar, true);
  document.getElementById('car-legend-1').textContent = `Board car ${pos.boardCar} - ${pos.legend}`;

  document.getElementById('car-diagram-2').style.display = 'block';
  renderCarDiagram('car-row-2', 8, pos.exitCar, false);
  document.getElementById('car-legend-2').textContent = `Exit car ${pos.exitCar} for ${currentTrip.endName}`;
}

// ========== GTFS-RT LOGIC ==========
async function initProto() {
  if (protoRoot) return protoRoot;
  
  const jsonDescriptor = {
    nested: {
      transit_realtime: {
        nested: {
          FeedMessage: { fields: { entity: { rule: "repeated", type: "FeedEntity", id: 2 } } },
          FeedEntity: { fields: { tripUpdate: { type: "TripUpdate", id: 3 } } },
          TripUpdate: {
            fields: {
              trip: { type: "TripDescriptor", id: 1 },
              stopTimeUpdate: { rule: "repeated", type: "StopTimeUpdate", id: 2 }
            }
          },
          TripDescriptor: {
            fields: { 
              tripId: { type: "string", id: 1 },
              routeId: { type: "string", id: 5 } 
            } 
          },
          StopTimeUpdate: {
            fields: {
              stopSequence: { type: "uint32", id: 1 },
              arrival: { type: "StopEvent", id: 2 },
              departure: { type: "StopEvent", id: 3 },
              stopId: { type: "string", id: 4 }
            }
          },
          StopEvent: { fields: { time: { type: "int64", id: 2 } } }
        }
      }
    }
  };

  return new Promise((resolve) => {
    const root = protobuf.Root.fromJSON(jsonDescriptor);
    protoRoot = root;
    resolve(root);
  });
}

async function fetchGTFSTripUpdates() {
  try {
    const root = await initProto();
    const response = await fetch('https://api.wmata.com/gtfs/rail-gtfsrt-tripupdates.pb', {
      headers: { 'api_key': CONFIG.WMATA_API_KEY }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const buffer = await response.arrayBuffer();
    const FeedMessage = root.lookupType("transit_realtime.FeedMessage");
    const message = FeedMessage.decode(new Uint8Array(buffer));
    const object = FeedMessage.toObject(message, { longs: String });
    
    return object.entity || [];
  } catch (e) {
    console.error('[GTFS] Fetch Error:', e);
    return [];
  }
}

function parseUpdatesToTrains(entities, stationCode, terminusList) {
    const relevantTrains = [];
    const now = Date.now() / 1000;
    const target = stationCode.trim().toUpperCase();

    entities.forEach(entity => {
        if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) return;

        const trip = entity.tripUpdate.trip;
        const updates = entity.tripUpdate.stopTimeUpdate;

        // matching logic (pf_x_y etc)
        const stopUpdate = updates.find(u => {
            if (!u.stopId) return false;
            const parts = u.stopId.split('_');
            const extractedCode = (parts[0] === 'PF') ? parts[1] : parts[0];
            return extractedCode === target;
        });

        if (stopUpdate) {
            const event = stopUpdate.departure || stopUpdate.arrival;
            if (!event || !event.time) return;

            const time = parseInt(event.time);
            const minutesUntil = Math.floor((time - now) / 60);

            if (minutesUntil < -1) return;

            // LOOKUP LOGIC
            const staticInfo = STATIC_TRIPS[trip.tripId];

            // if we have static data, use it. otherwise fallback to raw route
            const line = staticInfo ? staticInfo.line : (trip.routeId || '');
            const destName = staticInfo ? staticInfo.headsign : "Check Board";

            // FILTER BY TERMINUS/DESTINATION
            // Normalize the destination for comparison
            const normalizedDest = normalizeDestination(destName);
            const normalizedTermini = Array.isArray(terminusList)
                ? terminusList.map(t => normalizeDestination(t))
                : [normalizeDestination(terminusList)];

            // Check if this train's destination matches any of the allowed termini
            const matchesTerminus = normalizedTermini.some(term => {
                if (normalizedDest === term) return true;
                if (normalizedDest.includes(term) || term.includes(normalizedDest)) return true;
                const destFirst = normalizedDest.split(/[\s\-\/]/)[0];
                const termFirst = term.split(/[\s\-\/]/)[0];
                return destFirst === termFirst;
            });

            // Skip trains that don't match the terminus filter
            if (!matchesTerminus) return;

            relevantTrains.push({
                Line: line,
                DestinationName: destName,
                Min: minutesUntil <= 0 ? "ARR" : minutesUntil.toString(),
                Car: "8",
                _gtfs: true,
                _scheduled: false
            });
        }
    });

    // simple deduping
    const uniqueTrains = [];
    const seen = new Set();
    relevantTrains.forEach(t => {
        const key = `${t.Line}_${t.Min}_${t.DestinationName}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueTrains.push(t);
        }
    });

    console.log(`[GTFS] Processed: Found ${uniqueTrains.length} trains for ${target} (filtered by terminus)`);
    return uniqueTrains;
}

// Helper function to get all termini for a multi-line station
function getAllTerminiForStation(station, fromPlatform, toStationCode) {
  const allTermini = [];

  // Get termini for each line serving this station
  station.lines.forEach(line => {
    const termini = getTerminus(line, fromPlatform, toStationCode);
    allTermini.push(...termini);
  });

  // Remove duplicates
  return [...new Set(allTermini)];
}

// ========== TRIP PLANNING ==========
function startTrip() {
  const fromCode = document.getElementById('from-station-code').value;
  const toCode = document.getElementById('to-station-code').value;

  const fromStation = ALL_STATIONS.find(s => s.code === fromCode);
  const toStation = ALL_STATIONS.find(s => s.code === toCode);
  if (!fromStation || !toStation) return;

  const transfer = findTransfer(fromCode, toCode);

  // For multi-line stations, get termini for ALL lines to include interlined trains (e.g., Orange + Silver)
  const terminusFirst = getAllTerminiForStation(fromStation, fromCode, transfer?.fromPlatform || 'C01');
  const terminusSecond = getAllTerminiForStation(toStation, transfer?.toPlatform || 'A01', toCode);

  currentTrip = {
    startStation: fromCode,
    endStation: toCode,
    startName: fromStation.name,
    endName: toStation.name,
    transfer: transfer,
    terminusFirst: terminusFirst,
    terminusSecond: terminusSecond,
    fromLines: fromStation.lines,
    toLines: toStation.lines,
  };

  document.getElementById('transfer-station-display').style.display = 'block';
  document.getElementById('train-sections').style.display = 'flex';
  document.getElementById('empty-state').style.display = 'none';

  document.getElementById('leg1-title').innerText = 'First Leg';
  document.getElementById('leg1-subtitle').innerText = fromStation.name;
  document.getElementById('leg2-title').innerText = transfer?.direct ? 'Direct' : 'Transfer';
  document.getElementById('leg2-subtitle').innerText = transfer?.direct ? toStation.name : transfer.name;

  document.getElementById('train-info1').innerHTML = '<div class="text-muted text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading...</div>';
  document.getElementById('train-info2').innerHTML = '<div class="text-muted text-center py-3">Select a train</div>';

  document.getElementById('car-diagram-1').style.display = 'none';
  document.getElementById('car-diagram-2').style.display = 'none';

  // NOW CALLING THE UPDATED FUNCTION THAT USES GTFS FOR LEG 1 TOO
  fetchAndDisplayTrainInfo(fromCode, terminusFirst, 'train-info1', true, true);
}

function getTerminus(line, fromStation, toStation) {
  const stations = LINE_STATIONS[line] || [];
  let fromIdx = stations.indexOf(fromStation);
  let toIdx = stations.indexOf(toStation);
  const t = TERMINI[line] || { toward_a: [], toward_b: [] };

  if (fromIdx === -1 && fromStation === 'C01' && stations.includes('A01')) fromIdx = stations.indexOf('A01');
  if (toIdx === -1 && toStation === 'C01' && stations.includes('A01')) toIdx = stations.indexOf('A01');
  if (fromIdx === -1 && fromStation === 'F01' && stations.includes('B01')) fromIdx = stations.indexOf('B01');
  if (toIdx === -1 && toStation === 'F01' && stations.includes('B01')) toIdx = stations.indexOf('B01');
  if (fromIdx === -1 && fromStation === 'F03' && stations.includes('D03')) fromIdx = stations.indexOf('D03');
  if (toIdx === -1 && toStation === 'F03' && stations.includes('D03')) toIdx = stations.indexOf('D03');

  if (fromIdx === -1 || toIdx === -1) return [...t.toward_a, ...t.toward_b];
  return toIdx < fromIdx ? t.toward_a : t.toward_b;
}

function getTransferWalkTime() {
  return parseInt(document.getElementById('transfer-walk-time').value) || 3;
}

// ========== TIME UTILITIES ==========
function calculateRouteTravelTime(fromStation, toStation, line) {
  const directKey = `${fromStation}_${toStation}`;
  if (TRAVEL_TIMES[directKey]) return TRAVEL_TIMES[directKey];

  const stations = LINE_STATIONS[line];
  if (!stations) return 10;

  const mapToLineStation = (code) => {
    if (stations.includes(code)) return code;
    if (code === 'C01' && stations.includes('A01')) return 'A01';
    if (code === 'F01' && stations.includes('B01')) return 'B01';
    if (code === 'F03' && stations.includes('D03')) return 'D03';
    return code;
  };

  const mappedFrom = mapToLineStation(fromStation);
  const mappedTo = mapToLineStation(toStation);
  const fromIdx = stations.indexOf(mappedFrom);
  const toIdx = stations.indexOf(mappedTo);

  if (fromIdx === -1 || toIdx === -1) return 10;

  let totalTime = 0;
  const step = fromIdx < toIdx ? 1 : -1;

  for (let i = fromIdx; i !== toIdx; i += step) {
    const segFrom = stations[i];
    const segTo = stations[i + step];
    const keys = [`${segFrom}_${segTo}`, `${segTo}_${segFrom}`];
    
    if (segFrom === 'A01') keys.push(`C01_${segTo}`, `${segTo}_C01`);
    if (segTo === 'A01') keys.push(`${segFrom}_C01`, `C01_${segFrom}`);
    if (segFrom === 'B01') keys.push(`F01_${segTo}`, `${segTo}_F01`);
    if (segTo === 'B01') keys.push(`${segFrom}_F01`, `F01_${segFrom}`);
    if (segFrom === 'D03') keys.push(`F03_${segTo}`, `${segTo}_F03`);
    if (segTo === 'D03') keys.push(`${segFrom}_F03`, `F03_${segFrom}`);

    let segTime = 2;
    for (const key of keys) {
      if (TRAVEL_TIMES[key]) {
        segTime = TRAVEL_TIMES[key];
        break;
      }
    }
    totalTime += segTime;
  }
  return totalTime;
}

function minutesToClockTime(minutesFromNow) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + minutesFromNow);
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function updateTransferTime() {
  const selectedCard = document.querySelector('#train-info1 .train-card.selected');
  if (selectedCard && currentTrip) {
    const trainMin = selectedCard.dataset.trainMin;
    selectTrain(selectedCard, trainMin);
  }
}

// ========== TRAIN SELECTION ==========
function selectTrain(trainCard, trainMin) {
  document.querySelectorAll('#train-info1 .train-card').forEach(card => {
    card.classList.remove('selected');
  });

  trainCard.classList.add('selected');
  trainCard.dataset.trainMin = trainMin;

  const departureMin = trainMin === 'ARR' || trainMin === 'BRD' ? 0 : parseInt(trainMin);
  const transferStation = currentTrip.transfer?.fromPlatform || 'C01';
  const travelTime = calculateRouteTravelTime(currentTrip.startStation, transferStation, currentTrip.fromLines[0]);
  const transferWalkTime = getTransferWalkTime();
  const arrivalAtTransfer = departureMin + travelTime + transferWalkTime;

  const leg2Platform = currentTrip.transfer?.toPlatform || 'A01';
  const leg2TravelTime = calculateRouteTravelTime(leg2Platform, currentTrip.endStation, currentTrip.toLines[0]);

  const journeyInfo = document.getElementById('journey-info');
  journeyInfo.style.display = 'block';

  const departureTime = minutesToClockTime(departureMin);
  const arrivalAtTransferTime = minutesToClockTime(arrivalAtTransfer);

  document.getElementById('travel-time').innerHTML = `${travelTime} min<br><small class="text-muted">Dep: ${departureTime}</small>`;
  document.getElementById('transfer-time').innerHTML = `${transferWalkTime} min<br><small class="text-muted">Arr: ${arrivalAtTransferTime}</small>`;

  document.getElementById('leg2-title').innerText = currentTrip.transfer?.direct ? 'Arrival' : 'Transfer Options';
  document.getElementById('leg2-subtitle').innerText = `Ready at platform ~${arrivalAtTransferTime}`;

  showCarDiagrams();

  if (!currentTrip.transfer?.direct) {
    fetchTransferTrains(leg2Platform, currentTrip.terminusSecond, 'train-info2', arrivalAtTransfer, leg2TravelTime);
  } else {
    const totalTime = departureMin + travelTime;
    document.getElementById('train-info2').innerHTML = `
      <div class="text-center py-3">
        <div class="text-success fw-bold">Direct Route</div>
        <div class="text-muted small">Stay on train to ${currentTrip.endName}</div>
        <div class="mt-2">Arrive ~${minutesToClockTime(totalTime)}</div>
      </div>`;
    document.getElementById('total-time').innerHTML = `${totalTime} min<br><small class="text-muted">Arr: ${minutesToClockTime(totalTime)}</small>`;
  }
}

// ========== API FUNCTIONS (UPDATED - BOTH LEGS) ==========
function fetchTransferTrains(station, terminus, infobox, minArrivalTime, leg2TravelTime = 10) {
  const trainInfoContainer = document.getElementById(infobox);
  trainInfoContainer.innerHTML = '<div class="text-muted text-center py-3"><span class="spinner-border spinner-border-sm me-2"></span>Finding connections...</div>';

  Promise.all([
      fetch('https://api.wmata.com/StationPrediction.svc/json/GetPrediction/' + station, {
        headers: { 'api_key': CONFIG.WMATA_API_KEY }
      }).then(r => r.json()),
      fetchGTFSTripUpdates()
  ])
  .then(([apiData, gtfsEntities]) => {
      // 1. Process API Data
      const apiFiltered = filterApiResponse(apiData.Trains, terminus);
      
      // 2. Process GTFS-RT Data
      const gtfsTrains = parseUpdatesToTrains(gtfsEntities, station, Array.isArray(terminus) ? terminus : [terminus]);
      
      // 3. Merge: Prefer API, fill gaps with GTFS-RT
      const mergedTrains = [...apiFiltered];
      
      gtfsTrains.forEach(gTrain => {
          const gMin = gTrain.Min === 'ARR' ? 0 : parseInt(gTrain.Min);
          const duplicate = apiFiltered.some(aTrain => {
              const aMin = aTrain.Min === 'ARR' || aTrain.Min === 'BRD' ? 0 : parseInt(aTrain.Min);
              return Math.abs(aMin - gMin) <= 3 && aTrain.Line === gTrain.Line;
          });
          if (!duplicate) mergedTrains.push(gTrain);
      });

      // 4. Fill long-range gaps with Static Schedule
      if (typeof getScheduledTrains === 'function') {
        const staticSchedule = getScheduledTrains(station, terminus, 15);
        staticSchedule.forEach(sTrain => {
            const sMin = parseInt(sTrain.Min);
            const duplicate = mergedTrains.some(mTrain => {
                const mMin = mTrain.Min === 'ARR' || mTrain.Min === 'BRD' ? 0 : parseInt(mTrain.Min);
                return Math.abs(mMin - sMin) <= 4;
            });
            if (!duplicate) {
                sTrain._gtfs = false;
                sTrain._scheduled = true;
                mergedTrains.push(sTrain);
            }
        });
      }

      renderTrainList(mergedTrains, infobox, minArrivalTime, leg2TravelTime);
  })
  .catch(error => {
    console.error('Data error:', error);
    document.getElementById(infobox).innerHTML = '<div class="error-message text-danger text-center py-4">Error loading train data</div>';
  });
}

function renderTrainList(trains, infobox, minArrivalTime, leg2TravelTime) {
    const trainInfoContainer = document.getElementById(infobox);
    trainInfoContainer.innerHTML = '';

    if (trains.length === 0) {
      trainInfoContainer.innerHTML = '<div class="no-trains text-muted text-center py-4">No trains found</div>';
      return;
    }

    const CATCH_THRESHOLD = -3; // we can catch trains that arrive up to 3 mins before we do (maybe)
    
    // 1. Calculate stats
    const trainsWithStatus = trains.map(train => {
      const trainArrival = train.Min === 'ARR' || train.Min === 'BRD' ? 0 : parseInt(train.Min);
      const waitTime = trainArrival - minArrivalTime;
      const totalJourneyTime = trainArrival + leg2TravelTime;
      const arrivalClockTime = minutesToClockTime(totalJourneyTime);
      return { 
          ...train, 
          _waitTime: waitTime, 
          _canCatch: waitTime >= CATCH_THRESHOLD, 
          _totalTime: totalJourneyTime, 
          _arrivalClock: arrivalClockTime 
      };
    });

    // 2. FILTER: Only show trains arriving within 3 mins of our arrival (or later)
    // effectively hides the "Missed by 10 mins" garbage
    const catchableTrains = trainsWithStatus.filter(t => t._waitTime >= CATCH_THRESHOLD);

    if (catchableTrains.length === 0) {
        // Edge case: We have data, but we missed literally everything close.
        trainInfoContainer.innerHTML = '<div class="no-trains text-muted text-center py-4">All imminent trains missed. Check schedule.</div>';
        return;
    }

    // 3. Sort logic (Realtime > GTFS > Schedule)
    let trainsToShow = catchableTrains.sort((a, b) => {
        const aIsLive = !a._scheduled;
        const bIsLive = !b._scheduled;
        if (aIsLive !== bIsLive) return aIsLive ? -1 : 1;
        
        if (a._canCatch !== b._canCatch) return a._canCatch ? -1 : 1;

        const aMin = a.Min === 'ARR' || a.Min === 'BRD' ? 0 : parseInt(a.Min);
        const bMin = b.Min === 'ARR' || b.Min === 'BRD' ? 0 : parseInt(b.Min);
        return aMin - bMin;
    });

    // 4. Tight Connection Warning
    const hasCatchable = trainsToShow.some(t => t._canCatch);
    if (!hasCatchable && trainsToShow.length > 0) {
      const note = document.createElement('div');
      note.className = 'alert alert-warning py-2 px-3 mb-2 small';
      note.innerHTML = `<strong>Tight connection!</strong> Arr ~${minutesToClockTime(minArrivalTime)}. Consider earlier train.`;
      trainInfoContainer.appendChild(note);
    }

    // 5. Update Total Time header
    const firstCatchable = trainsToShow.find(t => t._canCatch);
    if (firstCatchable) {
      document.getElementById('total-time').innerHTML = `${firstCatchable._totalTime} min<br><small class="text-muted">Arr: ${firstCatchable._arrivalClock}</small>`;
    }

    const INITIAL_LIMIT = 3;
    const initialTrains = trainsToShow.slice(0, INITIAL_LIMIT);
    const hiddenTrains = trainsToShow.slice(INITIAL_LIMIT);

    function renderTrainCard(train, index) {
      const box = document.createElement('div');
      box.classList.add('train-card', getLineClass(train.Line));
      if (!train._canCatch) box.classList.add('missed');
      box.style.animationDelay = `${index * 0.05}s`;

      const trainMin = train.Min === 'ARR' || train.Min === 'BRD' ? 0 : parseInt(train.Min);
      const clockTime = minutesToClockTime(trainMin);
      const minDisplay = train.Min === 'ARR' ? 'ARR' : train.Min === 'BRD' ? 'BRD' : train.Min + ' min';
      
      // Wait time logic for display
      const statusText = train._canCatch
        ? `${train._waitTime} min wait · Arr ${train._arrivalClock}`
        : `Miss by ${Math.abs(train._waitTime)} min`;
      
      let sourceIcon = '';
      if (train._gtfs) {
          sourceIcon = ' <i class="fas fa-satellite-dish" title="Tracked via GPS" style="color: var(--text-muted); opacity: 0.7;"></i>';
      } else if (train._scheduled) {
          sourceIcon = ' <span class="badge bg-secondary">Sched</span>';
      } else {
          sourceIcon = ' <i class="fas fa-rss" title="Live at Station" style="color: var(--text-muted); opacity: 0.7;"></i>';
      }

      box.innerHTML = `
        <div class="train-card-content">
          <div class="train-line-badge">${train.Line || '—'}</div>
          <div class="train-details">
            <div class="train-destination">${getDisplayName(train.DestinationName)}${sourceIcon}</div>
            <div class="train-car">${statusText}</div>
          </div>
          <div class="train-time ${train.Min === 'ARR' || train.Min === 'BRD' ? 'arriving' : ''}">
            ${minDisplay}<br><small>${clockTime}</small>
          </div>
        </div>
      `;
      return box;
    }

    initialTrains.forEach((train, index) => {
      trainInfoContainer.appendChild(renderTrainCard(train, index));
    });

    if (hiddenTrains.length > 0) {
      const showMoreBtn = document.createElement('button');
      showMoreBtn.className = 'show-more-btn';
      showMoreBtn.textContent = `Show ${hiddenTrains.length} more`;
      showMoreBtn.onclick = () => {
        showMoreBtn.remove();
        hiddenTrains.forEach((train, index) => {
          trainInfoContainer.appendChild(renderTrainCard(train, index));
        });
      };
      trainInfoContainer.appendChild(showMoreBtn);
    }
}

// ========== DISPLAY HELPERS ==========
const DESTINATION_ALIASES = {
  'newcrlton': 'new carrollton',
  'new carrollton': 'new carrollton',
  'vienna': 'vienna',
  'vienna/fairfax-gmu': 'vienna',
  'vienna/fairfax': 'vienna',
  'ashburn': 'ashburn',
  'largo': 'largo',
  'wiehle': 'wiehle-reston east',
  'wiehle-reston': 'wiehle-reston east',
  'franconia-spfld': 'franconia-springfield',
  'franconia': 'franconia-springfield',
  'fr spgfld': 'franconia-springfield',
  'shady gr': 'shady grove',
  'shadygrove': 'shady grove',
  'glenmont': 'glenmont',
  'greenbelt': 'greenbelt',
  'branch av': 'branch ave',
  'branchave': 'branch ave',
  'huntingtn': 'huntington',
  'huntington': 'huntington',
  'mt vernon': 'mt vernon sq',
  'mt vernon sq': 'mt vernon sq',
  'mtvrnonsq': 'mt vernon sq',
};

const DISPLAY_NAMES = {
  'new carrollton': 'New Carrollton',
  'vienna': 'Vienna',
  'ashburn': 'Ashburn',
  'largo': 'Largo',
  'wiehle-reston east': 'Wiehle-Reston East',
  'franconia-springfield': 'Franconia-Springfield',
  'shady grove': 'Shady Grove',
  'glenmont': 'Glenmont',
  'greenbelt': 'Greenbelt',
  'branch ave': 'Branch Ave',
  'huntington': 'Huntington',
  'mt vernon sq': 'Mt Vernon Sq',
};

function normalizeDestination(dest) {
  if (!dest) return '';
  const lower = dest.toLowerCase().trim();
  if (DESTINATION_ALIASES[lower]) return DESTINATION_ALIASES[lower];
  
  const normalized = lower.replace(/[\s\-\/]+/g, '');
  for (const [key, value] of Object.entries(DESTINATION_ALIASES)) {
    if (key.replace(/[\s\-\/]+/g, '') === normalized) return value;
  }
  return lower;
}

function getDisplayName(dest) {
  if (!dest) return '';
  if (dest === 'Check Board') return 'Check Board (GTFS)';
  const normalized = normalizeDestination(dest);
  return DISPLAY_NAMES[normalized] || dest;
}

function filterApiResponse(trains, terminus) {
  if (!trains || trains.length === 0) return [];

  const terminusList = Array.isArray(terminus) ? terminus : [terminus];
  const normalizedTermini = terminusList.map(t => normalizeDestination(t));

  return trains.filter(train => {
    const dest = train.Destination || train.DestinationName || '';
    if (!dest || dest === 'No Passenger' || dest === 'Train' || dest === 'ssenger' || dest === '---') return false;

    const normalizedDest = normalizeDestination(dest);
    const normalizedDestName = normalizeDestination(train.DestinationName);

    return normalizedTermini.some(term => {
      if (normalizedDest === term || normalizedDestName === term) return true;
      if (normalizedDest.includes(term) || term.includes(normalizedDest) ||
          normalizedDestName.includes(term) || term.includes(normalizedDestName)) return true;
      const destFirst = normalizedDest.split(/[\s\-\/]/)[0];
      const termFirst = term.split(/[\s\-\/]/)[0];
      return destFirst === termFirst;
    });
  });
}

function getLineClass(line) {
  const lineMap = { 'RD': 'train-card-rd', 'OR': 'train-card-or', 'SV': 'train-card-sv', 'BL': 'train-card-bl', 'YL': 'train-card-yl', 'GR': 'train-card-gr' };
  return lineMap[line] || 'train-card-null';
}

function fetchAndDisplayTrainInfo(station, terminus, infobox, selectable = false, mergeSchedule = false) {
  fetch('https://api.wmata.com/StationPrediction.svc/json/GetPrediction/' + station, {
    headers: new Headers({ 'api_key': CONFIG.WMATA_API_KEY })
  })
  .then(response => response.json())
  .then(data => {
    // 1. Process API Data
    const apiFiltered = filterApiResponse(data.Trains, terminus);

    // If we want GTFS for Leg 1, we must chain it here.
    // However, to keep this UI responsive, we can run it asynchronously
    // OR we can commit to Promise.all().
    // Given the previous requirement: "Use GTFS updated data for leg 1"
    
    return fetchGTFSTripUpdates().then(gtfsEntities => {
        const gtfsTrains = parseUpdatesToTrains(gtfsEntities, station, Array.isArray(terminus) ? terminus : [terminus]);
        
        // Merge API + GTFS
        const mergedTrains = [...apiFiltered];
        gtfsTrains.forEach(gTrain => {
            const gMin = gTrain.Min === 'ARR' ? 0 : parseInt(gTrain.Min);
            const duplicate = apiFiltered.some(aTrain => {
                const aMin = aTrain.Min === 'ARR' || aTrain.Min === 'BRD' ? 0 : parseInt(aTrain.Min);
                return Math.abs(aMin - gMin) <= 3 && aTrain.Line === gTrain.Line;
            });
            if (!duplicate) mergedTrains.push(gTrain);
        });

        // Merge Static Schedule
        if (typeof getScheduledTrains === 'function') {
            const staticSchedule = getScheduledTrains(station, terminus, 15);
            staticSchedule.forEach(sTrain => {
                const sMin = parseInt(sTrain.Min);
                const duplicate = mergedTrains.some(mTrain => {
                    const mMin = mTrain.Min === 'ARR' || mTrain.Min === 'BRD' ? 0 : parseInt(mTrain.Min);
                    return Math.abs(mMin - sMin) <= 4;
                });
                if (!duplicate) {
                    sTrain._gtfs = false;
                    sTrain._scheduled = true;
                    mergedTrains.push(sTrain);
                }
            });
        }
        
        // Sort
        return mergedTrains.sort((a, b) => {
            const aIsLive = !a._scheduled;
            const bIsLive = !b._scheduled;
            if (aIsLive !== bIsLive) return aIsLive ? -1 : 1;
            const aMin = a.Min === 'ARR' || a.Min === 'BRD' ? 0 : parseInt(a.Min);
            const bMin = b.Min === 'ARR' || b.Min === 'BRD' ? 0 : parseInt(b.Min);
            return aMin - bMin;
        });
    });
  })
  .then(filteredData => {
    const trainInfoContainer = document.getElementById(infobox);
    trainInfoContainer.innerHTML = '';

    if (filteredData.length === 0) {
      trainInfoContainer.innerHTML = '<div class="no-trains text-muted text-center py-4">No trains currently scheduled</div>';
      return;
    }

    const INITIAL_LIMIT = 3;
    const initialTrains = filteredData.slice(0, INITIAL_LIMIT);
    const hiddenTrains = filteredData.slice(INITIAL_LIMIT);

    function renderLeg1Card(train, index) {
      const box = document.createElement('div');
      box.classList.add('train-card', getLineClass(train.Line));
      if (selectable) box.classList.add('selectable');
      box.style.animationDelay = `${index * 0.05}s`;

      const trainMin = train.Min === 'ARR' || train.Min === 'BRD' ? 0 : parseInt(train.Min);
      const clockTime = minutesToClockTime(trainMin);
      const minDisplay = train.Min === 'ARR' ? 'ARR' : train.Min === 'BRD' ? 'BRD' : train.Min + ' min';
      
      let sourceIcon = '';
      if (train._gtfs) {
          sourceIcon = ' <i class="fas fa-satellite-dish" title="Tracked via GPS" style="color: var(--text-muted); opacity: 0.7;"></i>';
      } else if (train._scheduled) {
          sourceIcon = ' <span class="badge bg-secondary">Sched</span>';
      } else {
          sourceIcon = ' <i class="fas fa-rss" title="Live at Station" style="color: var(--text-muted); opacity: 0.7;"></i>';
      }

      box.innerHTML = `
        <div class="train-card-content">
          <div class="train-line-badge">${train.Line || '—'}</div>
          <div class="train-details">
            <div class="train-destination">${getDisplayName(train.DestinationName)}${sourceIcon}</div>
            <div class="train-car">${train.Car || '8'}-car train</div>
          </div>
          <div class="train-time ${train.Min === 'ARR' || train.Min === 'BRD' ? 'arriving' : ''}">
            ${minDisplay}<br><small>${clockTime}</small>
          </div>
        </div>
      `;

      if (selectable) {
        box.addEventListener('click', () => selectTrain(box, train.Min));
      }
      return box;
    }

    initialTrains.forEach((train, index) => {
      trainInfoContainer.appendChild(renderLeg1Card(train, index));
    });

    if (hiddenTrains.length > 0) {
      const showMoreBtn = document.createElement('button');
      showMoreBtn.className = 'show-more-btn';
      showMoreBtn.textContent = `Show ${hiddenTrains.length} more`;
      showMoreBtn.onclick = () => {
        showMoreBtn.remove();
        hiddenTrains.forEach((train, index) => {
          trainInfoContainer.appendChild(renderLeg1Card(train, index));
        });
      };
      trainInfoContainer.appendChild(showMoreBtn);
    }
  })
  .catch(error => {
    console.error('Error fetching data:', error);
    document.getElementById(infobox).innerHTML = '<div class="error-message text-danger text-center py-4">Error loading train data</div>';
  });
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
});