# TransferHero React Migration - Testing Guide

This document provides instructions for testing the new React + BFF implementation (Phase 5 of the migration).

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Starting the Applications](#starting-the-applications)
3. [Side-by-Side Testing](#side-by-side-testing)
4. [Test Cases](#test-cases)
5. [Performance Testing](#performance-testing)
6. [Mobile Testing](#mobile-testing)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before testing, ensure you have:

1. **Node.js 18+** installed
2. **WMATA API Key** configured in `react/packages/server/.env`:
   ```bash
   WMATA_API_KEY=your_api_key_here
   PORT=3001
   NODE_ENV=development
   ```
3. **Dependencies installed** in both old and new projects

### Installing Dependencies

```bash
# Install dependencies for the old vanilla JS app (if needed)
# The old app uses CDN scripts, so no npm install required

# Install dependencies for the new React app
cd react
npm install
```

---

## Starting the Applications

### Option A: Run Both Apps Side-by-Side

This is the recommended approach for comparison testing.

**Terminal 1 - Old Vanilla JS App:**
```bash
# From the project root
python3 -m http.server 8000
# OR
npx serve -p 8000
```
Open: http://localhost:8000

**Terminal 2 - New React BFF Server:**
```bash
cd react/packages/server
npm run dev
```
Server runs on: http://localhost:3001

**Terminal 3 - New React Client:**
```bash
cd react/packages/client
npm run dev
```
Open: http://localhost:5173 (Vite dev server)

### Option B: Run React App Only

```bash
cd react
npm run dev
```
This starts both the server and client concurrently.

---

## Side-by-Side Testing

### Testing Workflow

1. Open both apps in separate browser windows:
   - Old app: http://localhost:8000
   - New app: http://localhost:5173

2. For each test case, perform the same actions in both apps and compare:
   - Visual appearance
   - Data displayed
   - Calculated times
   - Train order/sorting

### Quick Comparison Checklist

| Feature | Old App | New App | Match? |
|---------|---------|---------|--------|
| Station typeahead works | | | |
| Line colors display correctly | | | |
| Transfer station calculated | | | |
| Leg 1 trains displayed | | | |
| Car diagram shows | | | |
| Leg 2 trains after selection | | | |
| Journey times match | | | |
| Dark mode toggle works | | | |

---

## Test Cases

### 1. Basic Functionality

#### TC1.1: Station Search
**Steps:**
1. Type "metro" in the "From" field
2. Verify Metro Center appears in suggestions
3. Verify line dots (RD, OR, SV, BL) display correctly
4. Click to select

**Expected:** Station selected, input shows selected station with line colors

#### TC1.2: Clear Selection
**Steps:**
1. Select a station
2. Click the X button to clear

**Expected:** Input clears and returns to search mode

#### TC1.3: Keyboard Navigation
**Steps:**
1. Type a partial station name
2. Use arrow keys to navigate suggestions
3. Press Enter to select

**Expected:** Selection works via keyboard

---

### 2. Pathfinding & Transfers

#### TC2.1: Simple Transfer (Red to Orange)
**Route:** Shady Grove → Vienna
- Expected transfer: Metro Center
- Should show alternatives if within 10 min of fastest

#### TC2.2: Simple Transfer (Blue to Green)
**Route:** Franconia-Springfield → Greenbelt
- Expected transfer: L'Enfant Plaza or Gallery Place

#### TC2.3: Direct Route (No Transfer)
**Route:** Shady Grove → Bethesda
- Expected: Direct route, no transfer needed
- Only Leg 1 panel should display

#### TC2.4: Complex Multi-Transfer Options
**Route:** Vienna → Branch Avenue
- Should show multiple transfer options
- Verify alternatives are within 10 min threshold

#### TC2.5: Fort Totten Multi-Platform
**Route:** Greenbelt → Shady Grove via Fort Totten
- Tests multi-platform station handling (B06/E06)

---

### 3. Train Data Display

#### TC3.1: Train Arrival Times
**Steps:**
1. Select any route with transfers
2. Compare arrival times between old and new app

**Verify:**
- ARR/BRD displayed correctly
- Minutes match between apps
- Clock times match

#### TC3.2: Train Source Indicators
**Verify each source type displays:**
- API trains: RSS icon
- GTFS-RT trains: Satellite icon
- Scheduled trains: "Sched" badge

#### TC3.3: Train Sorting
**Verify:** Trains sorted by arrival time (ascending)

#### TC3.4: Show More Button
**Steps:**
1. Select a route with many trains
2. Click "Show more trains"

**Expected:** All trains display

---

### 4. Train Selection & Leg 2

#### TC4.1: Select Leg 1 Train
**Steps:**
1. Complete a route search
2. Click on a Leg 1 train

**Expected:**
- Train shows checkmark
- Leg 2 trains update based on arrival at transfer
- Car diagram appears

#### TC4.2: Catchable vs Missed Trains
**Verify Leg 2 display:**
- Catchable trains: Normal opacity, shows wait time
- Missed trains: 50% opacity, shows "Miss by X min"

#### TC4.3: Journey Time Calculation
**Compare between old and new app:**
- Leg 1 time
- Transfer walk time
- Leg 2 time
- Total journey time
- Arrival time

---

### 5. Alternative Transfers

#### TC5.1: View Alternatives
**Steps:**
1. Search a route with alternatives
2. Click "X options" dropdown

**Expected:** List of alternatives with time differences

#### TC5.2: Select Alternative Transfer
**Steps:**
1. Expand alternatives
2. Select a different transfer station

**Expected:**
- Transfer display updates
- Leg 1 & Leg 2 trains refresh
- Journey times recalculate

---

### 6. Car Position Diagrams

#### TC6.1: Board Car Diagram (Leg 1)
**Steps:**
1. Select a Leg 1 train
2. Check car diagram in Leg 1 panel

**Expected:**
- Shows correct number of cars (6 or 8)
- Highlights recommended boarding car (green)
- Legend explains positioning

#### TC6.2: Exit Car Diagram (Leg 2)
**Verify:** Exit car highlighted in yellow in Leg 2 panel

---

### 7. Theme Toggle

#### TC7.1: Light to Dark Mode
**Steps:**
1. Start in light mode
2. Click moon icon

**Expected:**
- Background changes to dark
- Text colors invert appropriately
- Icon changes to sun
- Preference saved to localStorage

#### TC7.2: Theme Persistence
**Steps:**
1. Set to dark mode
2. Refresh page

**Expected:** Dark mode persists

---

### 8. Error Handling

#### TC8.1: API Error
**Steps:**
1. Disconnect from internet or stop BFF server
2. Try to search for a route

**Expected:** Error message displayed gracefully

#### TC8.2: Invalid Station Combination
**Steps:**
1. Try selecting same station for From and To

**Expected:** "Find Transfers" button disabled

---

### 9. Edge Cases

#### TC9.1: Station with Special Characters
**Test stations:**
- L'Enfant Plaza (apostrophe)
- NoMa-Gallaudet U (hyphen)
- Mt Vernon Sq 7th St-Convention Center (spaces/numbers)

#### TC9.2: Destination Name Normalization
**Verify these display correctly:**
- "Largo" → "Largo Town Center" (internal) → "Largo" (display)
- "NewCrltn" → "New Carrollton"
- "Shady Gr" → "Shady Grove"

#### TC9.3: ARR/BRD Handling
**Verify:** When train shows ARR or BRD:
- Displays as "ARR" or "BRD" (not "0 min")
- Clock time shows current time
- Red pulsing animation for arriving

---

## Performance Testing

### Lighthouse Audit

1. Build the production version:
   ```bash
   cd react/packages/client
   npm run build
   npm run preview
   ```

2. Run Lighthouse in Chrome DevTools:
   - Open DevTools (F12)
   - Go to Lighthouse tab
   - Run audit for Performance, Accessibility, Best Practices

**Target Scores:**
- Performance: > 90
- Accessibility: > 90
- Best Practices: > 90

### Bundle Size Check

```bash
cd react/packages/client
npm run build
```

Check output in `dist/` folder. Target: < 200KB gzipped for main bundle.

### Network Requests

1. Open DevTools Network tab
2. Perform a full trip search
3. Verify:
   - Initial station load: 1 request
   - Trip search: 1 request
   - Leg 2 update: 1 request (when selecting train)

---

## Mobile Testing

### Responsive Breakpoints

Test at these widths:
- Mobile: 375px (iPhone SE)
- Tablet: 768px (iPad)
- Desktop: 1024px+

### Mobile-Specific Tests

1. **Touch interactions:**
   - Station selection via tap
   - Train card tap to select
   - Scroll through train lists

2. **Layout:**
   - Single column on mobile
   - Two columns on tablet
   - Three columns on desktop (with journey info center)

3. **Keyboard:**
   - Virtual keyboard doesn't obscure inputs
   - Form can be submitted

### Device Testing

If possible, test on actual devices:
- iOS Safari
- Android Chrome
- Tablet (landscape and portrait)

---

## Troubleshooting

### Common Issues

#### "Failed to load stations"
- Check BFF server is running on port 3001
- Verify WMATA_API_KEY is set in .env
- Check browser console for specific errors

#### Train data not loading
- Verify WMATA API key is valid
- Check for CORS errors in console
- Ensure BFF server is running

#### Styles not applying
- Run `npm run dev` to rebuild CSS
- Clear browser cache
- Check for Tailwind compilation errors

#### TypeScript errors
- Run `npm run build` to see specific errors
- Ensure shared types are built: `cd packages/shared && npm run build`

### Debug Mode

Enable debug logging in the BFF:
```bash
DEBUG=transferhero:* npm run dev
```

### Clear Cache

```bash
# Clear npm cache
npm cache clean --force

# Clear node_modules and reinstall
rm -rf node_modules
npm install
```

---

## Reporting Issues

When reporting a bug, include:

1. **Environment:**
   - OS and version
   - Browser and version
   - Node.js version (`node --version`)

2. **Steps to reproduce:**
   - Exact stations selected
   - Actions taken

3. **Expected vs Actual:**
   - What should happen
   - What actually happened

4. **Screenshots/Console logs:**
   - Browser console errors
   - Network tab requests

---

*Document created: 2025-11-30*
*For Phase 5: Integration & Testing*
