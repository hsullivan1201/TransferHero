import dotenv from 'dotenv'

import { createApp } from './app.js'
import { initGtfsRefreshJob } from './jobs/gtfsRefresh.js'
import { loadBusGtfs } from './services/busGtfsLoader.js'
import { buildSpatialIndex, buildStationProximity } from './services/busStopIndex.js'
import { loadStationExits } from './services/stationService.js'

// grab env vars before anything else
dotenv.config()

const app = createApp()
const PORT = process.env.PORT || 3001

function logMemory(label: string): void {
  const mem = process.memoryUsage()
  console.log(
    `[Memory] ${label}: RSS=${(mem.rss / 1024 / 1024).toFixed(0)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`
  )
}

function initStartupData(): void {
  if (process.env.NODE_ENV === 'test') return
  const skipBusGtfs = process.env.LOCAL_SHARE_SMOKE === 'true'

  logMemory('boot')

  initGtfsRefreshJob()
    .then(() => {
      logMemory('after metro GTFS')
      return loadStationExits()
    })
    .then(async () => {
      if (!skipBusGtfs) await loadBusGtfs()
    })
    .then(() => {
      if (!skipBusGtfs) {
        logMemory('after bus GTFS')
        buildSpatialIndex()
        buildStationProximity()
      }
      logMemory('startup complete')
    })
    .catch(err => {
      console.warn('[Startup] Data load failed — bus features disabled:', err)
    })
}

const server = app.listen(PORT, () => {
  console.log(`TransferHero BFF running on http://localhost:${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)
  initStartupData()
})

export { server }
export default app
