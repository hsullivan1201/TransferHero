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
 * load static trips from the root static-trips.json file.
 * maps trip ids to headsign/line so GTFS-RT lookups aren't guessing.
 */
export function loadStaticTrips(): StaticTripsMap {
  if (cachedStaticTrips) {
    return cachedStaticTrips
  }

  try {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const jsonPath = resolve(__dirname, '../../../../../static-trips.json')
    const fileContent = readFileSync(jsonPath, 'utf-8')
    cachedStaticTrips = JSON.parse(fileContent) as StaticTripsMap

    console.log(`[StaticTrips] Loaded ${Object.keys(cachedStaticTrips).length} trip mappings`)
    return cachedStaticTrips
  } catch (error) {
    console.error('[StaticTrips] Failed to load static trips:', error)
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
 * called by the GTFS refresh job after updating static-trips.json.
 */
export function reloadStaticTrips(): void {
  cachedStaticTrips = null
  loadStaticTrips()
  console.log('[StaticTrips] Reloaded from disk')
}
