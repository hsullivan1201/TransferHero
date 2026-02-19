import cron from 'node-cron'
import { createWriteStream, createReadStream, unlinkSync, existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { Parse } from 'unzipper'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { setGtfsLastUpdated } from '../routes/health.js'
import { clearAllCache } from '../middleware/cache.js'
import { loadStationExits } from '../services/stationService.js'
import { invalidateMetroScheduleIndex, loadMetroScheduleData } from '../services/metroScheduleIndex.js'
import { ROUTE_TO_LINE } from '@transferhero/shared'
import { fetchWithTimeout } from '../utils/http.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const GTFS_STATIC_TIMEOUT_MS = 120_000

interface TripInfo {
  headsign: string
  line: string
}

/**
 * download GTFS static zip from WMATA
 */
async function downloadGtfsZip(destPath: string): Promise<void> {
  const apiKey = process.env.WMATA_API_KEY
  if (!apiKey) {
    throw new Error('WMATA_API_KEY not set')
  }

  console.log('[GTFS Refresh] downloading GTFS static data...')
  const response = await fetchWithTimeout('https://api.wmata.com/gtfs/rail-gtfs-static.zip', {
    timeoutMs: GTFS_STATIC_TIMEOUT_MS,
    headers: { 'api_key': apiKey }
  })

  if (!response.ok) {
    throw new Error(`Failed to download GTFS: ${response.status}`)
  }

  const fileStream = createWriteStream(destPath)
  await pipeline(response.body!, fileStream)
  console.log('[GTFS Refresh] download complete')
}

/**
 * parse trips.txt from the GTFS zip and extract trip info
 */
async function parseTripsFromZip(zipPath: string): Promise<Map<string, TripInfo>> {
  const trips = new Map<string, TripInfo>()

  return new Promise((resolve, reject) => {
    createReadStream(zipPath)
      .pipe(Parse())
      .on('entry', async (entry) => {
        if (entry.path === 'trips.txt') {
          let content = ''
          entry.on('data', (chunk: Buffer) => {
            content += chunk.toString()
          })
          entry.on('end', () => {
            // quick-and-dirty csv parse
            const lines = content.split('\n')
            const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
            const tripIdIdx = headers.indexOf('trip_id')
            const routeIdIdx = headers.indexOf('route_id')
            const headsignIdx = headers.indexOf('trip_headsign')

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim()
              if (!line) continue

              // handle quoted fields without crying
              const values: string[] = []
              let current = ''
              let inQuotes = false
              for (const char of line) {
                if (char === '"') {
                  inQuotes = !inQuotes
                } else if (char === ',' && !inQuotes) {
                  values.push(current.trim())
                  current = ''
                } else {
                  current += char
                }
              }
              values.push(current.trim())

              const tripId = values[tripIdIdx]
              const routeId = values[routeIdIdx]
              const headsign = values[headsignIdx]?.replace(/"/g, '').trim()

              if (tripId && routeId) {
                const lineCode = ROUTE_TO_LINE[routeId] || routeId
                trips.set(tripId, {
                  headsign: headsign || 'Unknown',
                  line: lineCode
                })
              }
            }
          })
        } else {
          entry.autodrain()
        }
      })
      .on('close', () => resolve(trips))
      .on('error', reject)
  })
}

const METRO_GTFS_FILES = ['stops.txt', 'trips.txt', 'stop_times.txt', 'calendar_dates.txt']

/**
 * extract required GTFS files from the zip for exit parser and schedule index
 */
async function extractFilesFromZip(zipPath: string): Promise<void> {
  const gtfsDir = resolve(__dirname, '../../../../metro-gtfs')
  if (!existsSync(gtfsDir)) {
    mkdirSync(gtfsDir, { recursive: true })
  }

  const needed = new Set(METRO_GTFS_FILES)

  return new Promise((res, rej) => {
    createReadStream(zipPath)
      .pipe(Parse())
      .on('entry', (entry) => {
        if (needed.has(entry.path)) {
          const outPath = resolve(gtfsDir, entry.path)
          entry.pipe(createWriteStream(outPath))
            .on('finish', () => console.log(`[GTFS Refresh] Extracted ${entry.path}`))
            .on('error', rej)
        } else {
          entry.autodrain()
        }
      })
      .on('close', () => res())
      .on('error', rej)
  })
}

/**
 * write static trips to a js file
 */
async function writeStaticTripsFile(trips: Map<string, TripInfo>): Promise<void> {
  const outputPath = resolve(__dirname, '../../../../../static-trips.json')

  const output: Record<string, TripInfo> = {}
  for (const [tripId, info] of trips) {
    output[tripId] = info
  }

  await writeFile(outputPath, JSON.stringify(output), 'utf-8')
  console.log(`[GTFS Refresh] Wrote ${trips.size} trips to static-trips.json`)
}

/**
 * reload static trips into memory
 */
async function reloadStaticTrips(): Promise<void> {
  // clear the module cache and re-import
  // staticTrips will reload on the next request
  const { reloadStaticTrips: reload } = await import('../data/staticTrips.js')
  if (typeof reload === 'function') {
    reload()
  }
}

/**
 * GTFS data refresh job
 */
async function refreshGtfs(): Promise<void> {
  console.log('[GTFS Refresh] starting...')
  const startTime = Date.now()

  const tempDir = resolve(__dirname, '../../temp')
  const zipPath = resolve(tempDir, 'gtfs.zip')

  try {
    // make sure the temp directory exists
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true })
    }

    // download GTFS
    await downloadGtfsZip(zipPath)

    // parse trips
    const trips = await parseTripsFromZip(zipPath)
    console.log(`[GTFS Refresh] Parsed ${trips.size} trips`)

    // write static trips file
    await writeStaticTripsFile(trips)

    // extract GTFS files for exit resolver and schedule index
    await extractFilesFromZip(zipPath)
    await loadStationExits(true)

    // invalidate metro schedule index so it rebuilds from fresh data
    invalidateMetroScheduleIndex()
    loadMetroScheduleData()

    // clear caches
    clearAllCache()

    // reload static trips module
    await reloadStaticTrips()

    // update timestamp
    setGtfsLastUpdated(new Date())

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[GTFS Refresh] Complete in ${elapsed}s`)
  } catch (error) {
    console.error('[GTFS Refresh] Error:', error)
    throw error
  } finally {
    // cleanup temp file
    if (existsSync(zipPath)) {
      try {
        unlinkSync(zipPath)
      } catch {
        // ignore cleanup hiccups
      }
    }
  }
}

/**
 * initialize the GTFS refresh cron job
 */
export function initGtfsRefreshJob(): Promise<void> {
  // run daily at 3 AM (WMATA usually updates overnight)
  const schedule = process.env.GTFS_REFRESH_CRON || '0 3 * * *'

  console.log(`[GTFS Refresh] Scheduling job with cron: ${schedule}`)

  cron.schedule(schedule, async () => {
    await refreshGtfs()
  })

  // set initial timestamp
  setGtfsLastUpdated(new Date())

  // also run on startup if the data smells stale (>24h)
  // catches times when the server slept through cron
  // returns promise so callers can wait for data to be ready
  return checkAndRefreshIfStale()
}

/**
 * check if static trips data is stale and refresh if needed
 */
async function checkAndRefreshIfStale(): Promise<void> {
  try {
    const staticTripsPath = resolve(__dirname, '../../../../../static-trips.json')
    const gtfsDir = resolve(__dirname, '../../../../metro-gtfs')
    const requiredFiles = [staticTripsPath, ...METRO_GTFS_FILES.map(f => resolve(gtfsDir, f))]
    const missingFiles = requiredFiles.filter(f => !existsSync(f))

    if (missingFiles.length > 0) {
      console.log('[GTFS Refresh] missing data files, running initial refresh...')
      await refreshGtfs()
      return
    }

    const { statSync } = await import('fs')
    const stats = statSync(staticTripsPath)
    const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60)

    if (ageHours > 24) {
      console.log(`[GTFS Refresh] static-trips.json is ${ageHours.toFixed(1)}h old, refreshing...`)
      await refreshGtfs()
    } else {
      console.log(`[GTFS Refresh] static-trips.json is ${ageHours.toFixed(1)}h old, still fresh`)
      // Data is fresh — just tell the schedule index files are available
      loadMetroScheduleData()
    }
  } catch (error) {
    console.error('[GTFS Refresh] Error checking staleness:', error)
  }
}

/**
 * manually trigger a GTFS refresh
 */
export async function triggerGtfsRefresh(): Promise<void> {
  await refreshGtfs()
}
