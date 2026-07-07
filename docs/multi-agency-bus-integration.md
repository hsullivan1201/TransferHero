# Multi-Agency Bus Integration Reference

Research completed Feb 2026. ART implemented Feb 2026.

## Current State

TransferHero supports **WMATA Metrobus** and **Arlington Transit (ART)**:
- Multi-agency GTFS loader (`busGtfsLoader.ts`) with per-feed configs and ID namespacing
- WMATA: proprietary JSON API (`NextBusService.svc`) for real-time predictions
- ART: GTFS-RT protobuf (`gtfsRtPredictions.ts`) for real-time predictions
- Spatial indexing, route finding, and schedule lookups are agency-generic
- All IDs namespaced as `{agencyId}:{originalId}` to prevent cross-agency collisions

## Architecture Impact

Most of the bus stack is GTFS-standard and agency-agnostic. The main work items:

1. **`busGtfsLoader.ts`** — Hardcoded WMATA URL. Refactor to accept an array of agency configs and load multiple GTFS feeds on startup.
2. **Shared types** — Add `agencyId` (and optionally `agencyName`, `agencyColor`) to `BusStop`, `BusLeg`, etc.
3. **`busPredictions.ts`** — Hardcoded WMATA JSON API. Need a new GTFS-RT protobuf parser (covers most new agencies) alongside the existing WMATA adapter. Use `gtfs-realtime-bindings` npm package.
4. **`busStopIndex.ts`** / **`busRouteFinder.ts`** / **`busScheduleIndex.ts`** — Already generic. Minimal changes (pass through `agencyId`).
5. **Client** — Display agency name/branding on trip cards. Optional agency filter.

**Key insight:** One GTFS-RT parser covers ART, Fairfax Connector, TheBus, MTA MD, and likely DASH/RideOn. The existing WMATA JSON adapter stays as-is for Metrobus.

## Agency Details

### ART (Arlington Transit)

- **Area:** Arlington County, VA
- **Size:** ~19 routes, 638 stops
- **Static GTFS:** `https://www.arlingtontransit.com/shared/content/gtfs/art/google_transit.zip`
- **GTFS-RT Trip Updates:** `https://realtime.arlingtontransit.com/gtfsrt/trips`
- **GTFS-RT Vehicle Positions:** `https://realtime.arlingtontransit.com/gtfsrt/vehicles`
- **Auth:** None required
- **Update frequency:** Every 30 seconds
- **License:** Creative Commons Attribution 3.0
- **Developer docs:** https://www.arlingtontransit.com/riding-art/rider-tools/tools-for-developers/
- **Integration effort:** Trivial

### Fairfax Connector

- **Area:** Fairfax County, VA
- **Size:** ~93 routes, 3,094 stops
- **Static GTFS:** `https://www.fairfaxcounty.gov/connector/sites/connector/files/assets/connector_gtfs.zip`
- **GTFS-RT Trip Updates:** `https://www.fairfaxcounty.gov/gtfsrt/trips`
- **GTFS-RT Vehicle Positions:** `https://www.fairfaxcounty.gov/gtfsrt/vehicles`
- **GTFS-RT Alerts:** `https://www.fairfaxcounty.gov/gtfsrt/alerts`
- **Auth:** None required
- **License:** Attribution required ("Visit fairfaxconnector.com for more information" with hyperlink)
- **Developer docs:** https://www.fairfaxcounty.gov/connector/bustracker/data/gtfsrt
- **Integration effort:** Trivial

### TheBus (Prince George's County)

- **Area:** Prince George's County, MD
- **Size:** ~28 routes, 1,614 stops
- **Static GTFS:** Available via https://www.princegeorgescountymd.gov/ (download from routes/schedules page) or Transitland
- **GTFS-RT (via Swiftly):**
  - Trip Updates: `https://api.goswift.ly/real-time/prince-george-thebus/gtfs-rt-trip-updates`
  - Vehicle Positions: `https://api.goswift.ly/real-time/prince-george-thebus/gtfs-rt-vehicle-positions`
  - Alerts: `https://api.goswift.ly/real-time/prince-george-thebus/gtfs-rt-alerts`
- **Auth:** Swiftly API key, passed as `Authorization` header
- **Key request:** https://goswift.ly/realtime-api-key (free, form-based)
- **Integration effort:** Easy (once key obtained)

### MTA Maryland (Commuter Bus only)

- **Area:** Suburban MD → DC commuter routes (not Baltimore local bus)
- **Static GTFS:** `https://feeds.mta.maryland.gov/gtfs/commuter-bus` (no auth)
- **Alerts (static):** `https://feeds.mta.maryland.gov/alerts.pb` (no auth)
- **GTFS-RT (via Swiftly):**
  - Trip Updates: `https://api.goswift.ly/real-time/mta-maryland-commuter-bus/gtfs-rt-trip-updates`
  - Vehicle Positions: `https://api.goswift.ly/real-time/mta-maryland-commuter-bus/gtfs-rt-vehicle-positions`
- **Auth:** Swiftly API key (same request form as TheBus)
- **Developer docs:** https://www.mta.maryland.gov/developer-resources
- **Note:** Same Swiftly platform as TheBus — one key may cover both
- **Integration effort:** Easy (once key obtained)

### DASH (Alexandria Transit)

- **Area:** Alexandria, VA
- **Size:** ~11 routes, 124 buses
- **Fare:** Free (since Sept 2021)
- **Static GTFS:** `http://dashbus.com/google_transit.zip`
- **GTFS-RT:** Exists (OneBusAway platform), but URLs not public
  - Expected format: `/api/gtfs_realtime/trip-updates-for-agency/[id].pb?key=[KEY]`
  - Base domain: `dashbus.obaweb.org`
- **Auth:** API key required, manual approval
- **How to get access:** Fill out form at https://www.dashbus.com/tracker-data (72hr response time)
- **Alt contact:** dashbus@alexandriava.gov or 703.746.3274
- **Note:** API key system is still in beta/development
- **Integration effort:** Medium (approval wait + untested endpoints)

### RideOn (Montgomery County)

- **Area:** Montgomery County, MD
- **Static GTFS:** `https://www.montgomerycountymd.gov/DOT-Transit/Resources/Files/GTFS/RideOnGTFS.zip`
- **GTFS-RT:** Exists per Transitland (trip updates + vehicle positions + alerts), but URLs not public
- **Auth:** API key required, registration process
- **How to get access:** Register at https://rideon.app/api/ApiApplicationAgreement
- **Developer terms:** https://www.montgomerycountymd.gov/DOT-Transit/API_TermsOfUse.html
- **Contact:** 240-777-0311
- **Note:** Custom-built system (~2019), may not follow standard GTFS-RT hosting patterns
- **Integration effort:** Medium (registration + unknown endpoint structure)

### OmniRide (Prince William County)

- **Area:** Prince William County, VA (formerly PRTC)
- **Static GTFS:** `https://omniride.com/omniride/assets/File/google_transit.zip`
- **GTFS-RT:** May exist but not publicly indexed. Transitland shows no RT feeds.
- **Auth:** Unknown
- **How to get access:** Email Omni@OmniRide.com with subject "Request for Realtime GTFS Data"
- **Developer docs:** https://omniride.com/about/tools/
- **Note:** No technical support offered. Uses RideCo for microtransit; unclear if fixed-route RT is exposed.
- **Integration effort:** Unknown (may be partner-only)

### Loudoun County Transit

- **Area:** Loudoun County, VA
- **Static GTFS:** `https://www.loudoun.gov/loudountransitgtfs`
- **GTFS-RT:** None published
- **Real-time tracker:** `https://bustime.loudoun.gov/bustime/home.jsp` (Clever Devices BusTime)
- **Possible API:** BusTime systems typically have a REST API (`/api/v3/getpredictions`, etc.) but Loudoun's is undocumented
- **Contact:** 703-771-5665, rideshare@loudoun.gov
- **Integration effort:** Schedule-only unless BusTime API access is granted

## Recommended Implementation Order

### Phase 1: Zero-friction agencies (static GTFS + open GTFS-RT)
- ~~ART~~ ✓ Implemented
- Fairfax Connector

### Phase 2: Swiftly agencies (one API key covers both)
- TheBus
- MTA Maryland Commuter Bus

### Phase 3: Manual approval agencies (submit requests early)
- DASH
- RideOn

### Phase 4: Low priority / schedule-only
- OmniRide (pending email response)
- Loudoun County Transit (schedule-based only)

## Action Items Before Implementation

- [ ] Request Swiftly API key at https://goswift.ly/realtime-api-key (covers TheBus + MTA MD)
- [ ] Submit DASH data access form at https://www.dashbus.com/tracker-data
- [ ] Register for RideOn API at https://rideon.app/api/ApiApplicationAgreement
- [ ] Email OmniRide at Omni@OmniRide.com re: GTFS-RT access
- [ ] (Optional) Contact Loudoun County re: BusTime API access

## Environment Variables (planned)

```env
# Existing
WMATA_API_KEY=...

# New
SWIFTLY_API_KEY=...          # Covers TheBus + MTA MD
DASH_API_KEY=...             # From OneBusAway approval
RIDEON_API_KEY=...           # From rideon.app registration
# ART and Fairfax Connector need no keys
```
