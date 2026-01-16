import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

export interface StaticTripInfo {
  headsign: string
  line: string
}

export type StaticTripsMap = Record<string, StaticTripInfo>

let cachedStaticTrips: StaticTripsMap | null = null

/**
 * load static trips from the root static-trips.js file.
 * maps trip ids to headsign/line so GTFS-RT lookups aren't guessing.
 */
export function loadStaticTrips(): StaticTripsMap {
  if (cachedStaticTrips) {
    return cachedStaticTrips
  }

  try {
    // hop from server/src/data up to the root static-trips.js
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const staticTripsPath = resolve(__dirname, '../../../../../static-trips.js')

    const fileContent = readFileSync(staticTripsPath, 'utf-8')

    // peel out the json from `const STATIC_TRIPS = {...}`
    const jsonMatch = fileContent.match(/const\s+STATIC_TRIPS\s*=\s*(\{[\s\S]*\})/)
    if (!jsonMatch) {
      console.warn('[StaticTrips] Could not parse static-trips.js format')
      return {}
    }

    cachedStaticTrips = JSON.parse(jsonMatch[1]) as StaticTripsMap
    console.log(`[StaticTrips] Loaded ${Object.keys(cachedStaticTrips).length} trip mappings`)
    return cachedStaticTrips
  } catch (error) {
    console.error('[StaticTrips] Failed to load static-trips.js:', error)
    return {}
  }
}

/**
 * get static trips (uses the cache after first load)
 */
export function getStaticTrips(): StaticTripsMap {
  return cachedStaticTrips ?? loadStaticTrips()
}

/**
 * clear cache and reload static trips from disk.
 * called by the GTFS refresh job after updating static-trips.js.
 */
export function reloadStaticTrips(): void {
  cachedStaticTrips = null
  loadStaticTrips()
  console.log('[StaticTrips] Reloaded from disk')
}
