// TransferHero - DC Metro Transfer Assistant
// Main application logic

// ========== STATE ==========
let currentTrip = null;

// ========== THEME MANAGEMENT ==========
function toggleTheme() {
  const body = document.body;
  const themeIcon = document.getElementById('theme-icon');
  const isDark = body.classList.toggle('dark-mode');

  // Update icon (will be replaced with Font Awesome)
  themeIcon.innerHTML = isDark
    ? '<i class="fas fa-sun"></i>'
    : '<i class="fas fa-moon"></i>';

  // Save preference
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Load saved theme on page load
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
  // Set values
  document.getElementById(`${field}-station`).value = name;
  document.getElementById(`${field}-station-code`).value = code;
  document.getElementById(`${field}-suggestions`).classList.remove('show');

  // Show selected station with line dots
  showSelectedStation(field, name, lines);

  checkCanGo();
}

function showSelectedStation(field, name, lines) {
  const inputContainer = document.getElementById(`${field}-station`).closest('.station-input-container');
  const input = document.getElementById(`${field}-station`);
  const display = inputContainer.querySelector('.selected-station-display');

  if (!display) {
    // Create display element if it doesn't exist
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

  // Update display
  const displayEl = inputContainer.querySelector('.selected-station-display');
  const linesContainer = displayEl.querySelector('.selected-station-lines');
  const nameContainer = displayEl.querySelector('.selected-station-name');

  linesContainer.innerHTML = lines.map(l => `<span class="line-dot ${l}"></span>`).join('');
  nameContainer.textContent = name;

  // Hide input, show display
  input.style.display = 'none';
  displayEl.classList.add('show');
}

function clearStation(field) {
  const inputContainer = document.getElementById(`${field}-station`).closest('.station-input-container');
  const input = document.getElementById(`${field}-station`);
  const display = inputContainer.querySelector('.selected-station-display');
  const codeInput = document.getElementById(`${field}-station-code`);

  // Clear values
  input.value = '';
  codeInput.value = '';

  // Hide display, show input
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

function findTransfer(fromCode, toCode) {
  const fromStation = ALL_STATIONS.find(s => s.code === fromCode);
  const toStation = ALL_STATIONS.find(s => s.code === toCode);
  if (!fromStation || !toStation) return null;

  // Check if same line (no transfer needed)
  const sharedLines = fromStation.lines.filter(l => toStation.lines.includes(l));
  if (sharedLines.length > 0) {
    return { name: 'Direct (no transfer)', station: null, direct: true, line: sharedLines[0] };
  }

  // Find transfer point
  for (const fromLine of fromStation.lines) {
    for (const toLine of toStation.lines) {
      const key = `${fromLine}_${toLine}`;
      if (TRANSFERS[key]) return TRANSFERS[key];
    }
  }
  return { name: 'Metro Center', station: 'A01', fromPlatform: 'C01', toPlatform: 'A01' };
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

  // Show boarding diagram
  document.getElementById('car-diagram-1').style.display = 'block';
  renderCarDiagram('car-row-1', 8, pos.boardCar, true);
  document.getElementById('car-legend-1').textContent = `Board car ${pos.boardCar} - ${pos.legend}`;

  // Show exit diagram
  document.getElementById('car-diagram-2').style.display = 'block';
  renderCarDiagram('car-row-2', 8, pos.exitCar, false);
  document.getElementById('car-legend-2').textContent = `Exit car ${pos.exitCar} for ${currentTrip.endName}`;
}

// ========== TRIP PLANNING ==========
function startTrip() {
  const fromCode = document.getElementById('from-station-code').value;
  const toCode = document.getElementById('to-station-code').value;

  const fromStation = ALL_STATIONS.find(s => s.code === fromCode);
  const toStation = ALL_STATIONS.find(s => s.code === toCode);
  if (!fromStation || !toStation) return;

  const transfer = findTransfer(fromCode, toCode);

  // Determine terminus directions
  const terminusFirst = getTerminus(fromStation.lines[0], fromCode, transfer?.fromPlatform || 'C01');
  const terminusSecond = getTerminus(toStation.lines[0], transfer?.toPlatform || 'A01', toCode);

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

  fetchAndDisplayTrainInfo(fromCode, terminusFirst, 'train-info1', true, true);
}

function getTerminus(line, fromStation, toStation) {
  // Uses LINE_STATIONS and TERMINI from data/line-config.js
  const stations = LINE_STATIONS[line] || [];
  let fromIdx = stations.indexOf(fromStation);
  let toIdx = stations.indexOf(toStation);
  const t = TERMINI[line] || { toward_a: [], toward_b: [] };

  // Handle platform code mismatches (e.g., C01 vs A01 for Metro Center)
  // TRAVEL_TIMES uses C01 for OR/SV/BL Metro Center, but LINE_STATIONS uses A01
  if (fromIdx === -1 && fromStation === 'C01' && stations.includes('A01')) {
    fromIdx = stations.indexOf('A01');
  }
  if (toIdx === -1 && toStation === 'C01' && stations.includes('A01')) {
    toIdx = stations.indexOf('A01');
  }
  // Also handle F01/B01 for Gallery Place, F03/D03 for L'Enfant Plaza
  if (fromIdx === -1 && fromStation === 'F01' && stations.includes('B01')) {
    fromIdx = stations.indexOf('B01');
  }
  if (toIdx === -1 && toStation === 'F01' && stations.includes('B01')) {
    toIdx = stations.indexOf('B01');
  }
  if (fromIdx === -1 && fromStation === 'F03' && stations.includes('D03')) {
    fromIdx = stations.indexOf('D03');
  }
  if (toIdx === -1 && toStation === 'F03' && stations.includes('D03')) {
    toIdx = stations.indexOf('D03');
  }

  // If we can't determine positions, return both
  if (fromIdx === -1 || toIdx === -1) {
    return [...t.toward_a, ...t.toward_b];
  }

  // If destination is earlier in list, we're going toward_a; otherwise toward_b
  return toIdx < fromIdx ? t.toward_a : t.toward_b;
}

function refreshGTFS() {
  const btn = document.querySelector('[onclick="refreshGTFS()"]');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Downloading...';
  btn.disabled = true;

  fetch('https://api.wmata.com/gtfs/rail-gtfs-static.zip', {
    headers: { 'api_key': CONFIG.WMATA_API_KEY }
  })
  .then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  })
  .then(blob => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rail-gtfs-static.zip';
    link.click();
    URL.revokeObjectURL(url);
    alert('Download complete! Extract the zip file to the metro-gtfs/ folder.');
  })
  .catch(err => {
    console.error('GTFS download failed:', err);
    alert('Download failed. Try again later or download manually from WMATA.');
  })
  .finally(() => {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  });
}

function getTransferWalkTime() {
  return parseInt(document.getElementById('transfer-walk-time').value) || 3;
}

// ========== TIME UTILITIES ==========
function calculateRouteTravelTime(fromStation, toStation, line) {
  // First try direct lookup in TRAVEL_TIMES
  const directKey = `${fromStation}_${toStation}`;
  if (TRAVEL_TIMES[directKey]) {
    return TRAVEL_TIMES[directKey];
  }

  // Get the line's station list
  const stations = LINE_STATIONS[line];
  if (!stations) return 10; // fallback

  // Map platform codes to station codes used in LINE_STATIONS
  const mapToLineStation = (code) => {
    if (stations.includes(code)) return code;
    // Metro Center: C01 (OR/SV/BL platform) -> A01
    if (code === 'C01' && stations.includes('A01')) return 'A01';
    // Gallery Place: F01 (YL/GR platform) -> B01
    if (code === 'F01' && stations.includes('B01')) return 'B01';
    // L'Enfant Plaza: F03 (YL/GR platform) -> D03
    if (code === 'F03' && stations.includes('D03')) return 'D03';
    return code;
  };

  const mappedFrom = mapToLineStation(fromStation);
  const mappedTo = mapToLineStation(toStation);

  const fromIdx = stations.indexOf(mappedFrom);
  const toIdx = stations.indexOf(mappedTo);

  if (fromIdx === -1 || toIdx === -1) return 10; // fallback

  let totalTime = 0;
  const step = fromIdx < toIdx ? 1 : -1;

  for (let i = fromIdx; i !== toIdx; i += step) {
    const segFrom = stations[i];
    const segTo = stations[i + step];
    // Try both directions in TRAVEL_TIMES, also try platform code variants
    const keys = [
      `${segFrom}_${segTo}`,
      `${segTo}_${segFrom}`,
    ];
    // Add platform code variants for transfer stations
    if (segFrom === 'A01') keys.push(`C01_${segTo}`, `${segTo}_C01`);
    if (segTo === 'A01') keys.push(`${segFrom}_C01`, `C01_${segFrom}`);
    if (segFrom === 'B01') keys.push(`F01_${segTo}`, `${segTo}_F01`);
    if (segTo === 'B01') keys.push(`${segFrom}_F01`, `F01_${segFrom}`);
    if (segFrom === 'D03') keys.push(`F03_${segTo}`, `${segTo}_F03`);
    if (segTo === 'D03') keys.push(`${segFrom}_F03`, `F03_${segFrom}`);

    let segTime = 2; // default per segment
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
  // Use cumulative travel time calculation for accurate timing
  const travelTime = calculateRouteTravelTime(currentTrip.startStation, transferStation, currentTrip.fromLines[0]);
  const transferWalkTime = getTransferWalkTime();
  const arrivalAtTransfer = departureMin + travelTime + transferWalkTime;

  // Calculate leg 2 travel time using cumulative calculation
  const leg2Platform = currentTrip.transfer?.toPlatform || 'A01';
  const leg2TravelTime = calculateRouteTravelTime(leg2Platform, currentTrip.endStation, currentTrip.toLines[0]);

  // Show journey info panel with clock times
  const journeyInfo = document.getElementById('journey-info');
  journeyInfo.style.display = 'block';

  const departureTime = minutesToClockTime(departureMin);
  const arrivalAtTransferTime = minutesToClockTime(arrivalAtTransfer);

  document.getElementById('travel-time').innerHTML = `${travelTime} min<br><small class="text-muted">Dep: ${departureTime}</small>`;
  document.getElementById('transfer-time').innerHTML = `${transferWalkTime} min<br><small class="text-muted">Arr: ${arrivalAtTransferTime}</small>`;

  // Update leg2 subtitle with arrival info
  document.getElementById('leg2-title').innerText = currentTrip.transfer?.direct ? 'Arrival' : 'Transfer Options';
  document.getElementById('leg2-subtitle').innerText = `Ready at platform ~${arrivalAtTransferTime}`;

  // Show car diagrams
  showCarDiagrams();

  // Fetch transfer trains
  if (!currentTrip.transfer?.direct) {
    fetchTransferTrains(leg2Platform, currentTrip.terminusSecond, 'train-info2', arrivalAtTransfer, leg2TravelTime);
  } else {
    // Direct route - no transfer needed
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

// ========== API FUNCTIONS ==========
function fetchTransferTrains(station, terminus, infobox, minArrivalTime, leg2TravelTime = 10) {
  fetch('https://api.wmata.com/StationPrediction.svc/json/GetPrediction/' + station, {
    headers: new Headers({
      'api_key': CONFIG.WMATA_API_KEY
    })
  })
  .then(response => response.json())
  .then(data => {
    const apiFiltered = filterApiResponse(data.Trains, terminus);
    const filteredData = mergeWithSchedule(apiFiltered, station, terminus, minArrivalTime);
    const trainInfoContainer = document.getElementById(infobox);
    trainInfoContainer.innerHTML = '';

    if (filteredData.length === 0) {
      trainInfoContainer.innerHTML = '<div class="no-trains text-muted text-center py-4">No trains currently scheduled</div>';
      return;
    }

    // Calculate catchability and total journey time for each train
    // A train is catchable if it arrives at least 3 minutes before we need to board
    const CATCH_THRESHOLD = -3; // Can catch if train leaves up to 3 min before we arrive
    const trainsWithStatus = filteredData.map(train => {
      const trainArrival = train.Min === 'ARR' || train.Min === 'BRD' ? 0 : parseInt(train.Min);
      const waitTime = trainArrival - minArrivalTime;
      const totalJourneyTime = trainArrival + leg2TravelTime;
      const arrivalClockTime = minutesToClockTime(totalJourneyTime);
      return { ...train, _waitTime: waitTime, _canCatch: waitTime >= CATCH_THRESHOLD, _totalTime: totalJourneyTime, _arrivalClock: arrivalClockTime };
    });

    // Filter to only show catchable trains for leg 2
    // Realtime trains are preferred, but only if catchable
    const catchableRealtime = trainsWithStatus.filter(t => !t._scheduled && t._canCatch);
    const catchableScheduled = trainsWithStatus.filter(t => t._scheduled && t._canCatch);

    // Combine catchable trains: realtime first, then scheduled
    let trainsToShow = [...catchableRealtime, ...catchableScheduled];

    // If no catchable trains, show the next few upcoming trains with a warning
    if (trainsToShow.length === 0) {
      const upcomingTrains = trainsWithStatus
        .filter(t => parseInt(t.Min) > 0)
        .sort((a, b) => parseInt(a.Min) - parseInt(b.Min))
        .slice(0, 3);
      trainsToShow = upcomingTrains;
    }

    // Sort: realtime first, then catchable, then by time
    trainsToShow.sort((a, b) => {
      // Realtime trains always come first
      if (a._scheduled !== b._scheduled) return a._scheduled ? 1 : -1;
      // Then by catchability
      if (a._canCatch !== b._canCatch) return a._canCatch ? -1 : 1;
      // Then by arrival time
      const aMin = a.Min === 'ARR' || a.Min === 'BRD' ? 0 : parseInt(a.Min);
      const bMin = b.Min === 'ARR' || b.Min === 'BRD' ? 0 : parseInt(b.Min);
      return aMin - bMin;
    });

    const hasCatchable = trainsToShow.some(t => t._canCatch);
    if (!hasCatchable) {
      const note = document.createElement('div');
      note.className = 'alert alert-warning py-2 px-3 mb-2 small';
      note.innerHTML = `<strong>Tight connection!</strong> You'll arrive at ~${minutesToClockTime(minArrivalTime)}. Consider an earlier first train.`;
      trainInfoContainer.appendChild(note);
    }

    // Update total time display for first catchable train
    const firstCatchable = trainsToShow.find(t => t._canCatch);
    if (firstCatchable) {
      document.getElementById('total-time').innerHTML = `${firstCatchable._totalTime} min<br><small class="text-muted">Arr: ${firstCatchable._arrivalClock}</small>`;
    }

    // Limit display to 3 trains initially
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
      const statusText = train._canCatch
        ? `${train._waitTime} min wait · Arr ${train._arrivalClock}`
        : `Miss by ${Math.abs(train._waitTime)} min`;
      const sourceLabel = train._scheduled ? ' <span class="badge bg-secondary">sched</span>' : '';

      box.innerHTML = `
        <div class="train-card-content">
          <div class="train-line-badge">${train.Line || '—'}</div>
          <div class="train-details">
            <div class="train-destination">${getDisplayName(train.DestinationName)}${sourceLabel}</div>
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

    // Add "show more" button if there are hidden trains
    if (hiddenTrains.length > 0) {
      const showMoreBtn = document.createElement('button');
      showMoreBtn.className = 'show-more-btn';
      showMoreBtn.textContent = `Show ${hiddenTrains.length} more train${hiddenTrains.length > 1 ? 's' : ''}`;
      showMoreBtn.onclick = () => {
        showMoreBtn.remove();
        hiddenTrains.forEach((train, index) => {
          trainInfoContainer.appendChild(renderTrainCard(train, index));
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

// WMATA API destination name abbreviations and variations
const DESTINATION_ALIASES = {
  // Orange Line
  'newcrlton': 'new carrollton',  // Fixed: API uses "NewCrlton" not "NewCrltn"
  'new carrollton': 'new carrollton',
  'vienna': 'vienna',
  'vienna/fairfax-gmu': 'vienna',
  'vienna/fairfax': 'vienna',
  // Silver Line
  'ashburn': 'ashburn',
  'largo': 'largo',
  'wiehle': 'wiehle-reston east',
  'wiehle-reston': 'wiehle-reston east',
  // Blue Line
  'franconia-spfld': 'franconia-springfield',
  'franconia': 'franconia-springfield',
  'fr spgfld': 'franconia-springfield',
  // Red Line
  'shady gr': 'shady grove',
  'shadygrove': 'shady grove',
  'glenmont': 'glenmont',
  // Green Line
  'greenbelt': 'greenbelt',
  'branch av': 'branch ave',
  'branchave': 'branch ave',
  // Yellow Line
  'huntingtn': 'huntington',
  'huntington': 'huntington',
  'mt vernon': 'mt vernon sq',
  'mt vernon sq': 'mt vernon sq',
  'mtvrnonsq': 'mt vernon sq',
};

// Proper display names for UI (title case)
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
  // Check if we have a direct alias
  if (DESTINATION_ALIASES[lower]) {
    return DESTINATION_ALIASES[lower];
  }
  // Try without spaces/dashes
  const normalized = lower.replace(/[\s\-\/]+/g, '');
  for (const [key, value] of Object.entries(DESTINATION_ALIASES)) {
    if (key.replace(/[\s\-\/]+/g, '') === normalized) {
      return value;
    }
  }
  return lower;
}

function getDisplayName(dest) {
  if (!dest) return '';
  const normalized = normalizeDestination(dest);
  return DISPLAY_NAMES[normalized] || dest;
}

function filterApiResponse(trains, terminus) {
  if (!trains || trains.length === 0) {
    console.log('[Filter] No trains in API response');
    return [];
  }

  const terminusList = Array.isArray(terminus) ? terminus : [terminus];
  const normalizedTermini = terminusList.map(t => normalizeDestination(t));

  console.log('[Filter] Looking for terminus:', terminusList, '→ normalized:', normalizedTermini);
  console.log('[Filter] API returned', trains.length, 'trains');

  // Filter by destination with case-insensitive matching
  const filtered = trains.filter(train => {
    // Skip non-revenue trains
    const dest = train.Destination || train.DestinationName || '';
    if (!dest || dest === 'No Passenger' || dest === 'Train' || dest === 'ssenger' || dest === '---') {
      return false;
    }

    const normalizedDest = normalizeDestination(dest);
    const normalizedDestName = normalizeDestination(train.DestinationName);

    const matches = normalizedTermini.some(term => {
      // Exact match after normalization
      if (normalizedDest === term || normalizedDestName === term) {
        return true;
      }
      // Partial match (one contains the other)
      if (normalizedDest.includes(term) || term.includes(normalizedDest) ||
          normalizedDestName.includes(term) || term.includes(normalizedDestName)) {
        return true;
      }
      // First word match
      const destFirst = normalizedDest.split(/[\s\-\/]/)[0];
      const termFirst = term.split(/[\s\-\/]/)[0];
      if (destFirst === termFirst) {
        return true;
      }
      return false;
    });

    console.log(`[Filter] Train: Line=${train.Line}, Dest="${dest}", DestName="${train.DestinationName}" → normalized: "${normalizedDest}" / "${normalizedDestName}" → Match: ${matches}`);

    return matches;
  });

  console.log('[Filter] Matched', filtered.length, 'trains after filtering');
  return filtered;
}

function getLineClass(line) {
  const lineMap = {
    'RD': 'train-card-rd',
    'OR': 'train-card-or',
    'SV': 'train-card-sv',
    'BL': 'train-card-bl',
    'YL': 'train-card-yl',
    'GR': 'train-card-gr'
  };
  return lineMap[line] || 'train-card-null';
}

function fetchAndDisplayTrainInfo(station, terminus, infobox, selectable = false, mergeSchedule = false) {
  fetch('https://api.wmata.com/StationPrediction.svc/json/GetPrediction/' + station, {
    headers: new Headers({
      'api_key': CONFIG.WMATA_API_KEY
    })
  })
  .then(response => response.json())
  .then(data => {
    const apiFiltered = filterApiResponse(data.Trains, terminus);
    const filteredData = mergeSchedule ? mergeWithSchedule(apiFiltered, station, terminus, 0) : apiFiltered;
    const trainInfoContainer = document.getElementById(infobox);
    trainInfoContainer.innerHTML = '';

    if (filteredData.length === 0) {
      trainInfoContainer.innerHTML = '<div class="no-trains text-muted text-center py-4">No trains currently scheduled</div>';
      return;
    }

    // Limit display to 3 trains for first leg
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
      const sourceLabel = train._scheduled ? ' <span class="badge bg-secondary">sched</span>' : '';

      box.innerHTML = `
        <div class="train-card-content">
          <div class="train-line-badge">${train.Line || '—'}</div>
          <div class="train-details">
            <div class="train-destination">${getDisplayName(train.DestinationName)}${sourceLabel}</div>
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

    // Add "show more" button if there are hidden trains
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

// ========== UTILITIES ==========
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
  initializeTheme();
});
