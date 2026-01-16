import cron from 'node-cron'
import fetch from 'node-fetch'
import { createWriteStream, createReadStream, unlinkSync, existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import { Parse } from 'unzipper'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { setGtfsLastUpdated } from '../routes/health.js'
import { clearAllCache } from '../middleware/cache.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// map WMATA route names to our line codes
const ROUTE_TO_LINE: Record<string, string> = {
  'RED': 'RD',
  'BLUE': 'BL',
  'ORANGE': 'OR',
  'SILVER': 'SV',
  'GREEN': 'GR',
  'YELLOW': 'YL'
}

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
  const response = await fetch('https://api.wmata.com/gtfs/rail-gtfs-static.zip', {
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

/**
 * write static trips to a js file
 */
async function writeStaticTripsFile(trips: Map<string, TripInfo>): Promise<void> {
  // drop it in the project root (same spot as before)
  const outputPath = resolve(__dirname, '../../../../../static-trips.js')

  const output: Record<string, TripInfo> = {}
  for (const [tripId, info] of trips) {
    output[tripId] = info
  }

  const content = `// static trip lookup derived from WMATA GTFS
// auto-generated: ${new Date().toISOString()}

const STATIC_TRIPS = ${JSON.stringify(output)};
`

  await writeFile(outputPath, content, 'utf-8')
  console.log(`[GTFS Refresh] Wrote ${trips.size} trips to static-trips.js`)
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
export function initGtfsRefreshJob(): void {
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
  checkAndRefreshIfStale()
}

/**
 * check if static trips data is stale and refresh if needed
 */
async function checkAndRefreshIfStale(): Promise<void> {
  try {
    const staticTripsPath = resolve(__dirname, '../../../../../static-trips.js')
    if (!existsSync(staticTripsPath)) {
      console.log('[GTFS Refresh] no static-trips.js found, running initial refresh...')
      await refreshGtfs()
      return
    }

    const { statSync } = await import('fs')
    const stats = statSync(staticTripsPath)
    const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60)

    if (ageHours > 24) {
      console.log(`[GTFS Refresh] static-trips.js is ${ageHours.toFixed(1)}h old, refreshing...`)
      await refreshGtfs()
    } else {
      console.log(`[GTFS Refresh] static-trips.js is ${ageHours.toFixed(1)}h old, still fresh`)
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
