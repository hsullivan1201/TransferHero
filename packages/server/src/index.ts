import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// grab env vars before anything else
dotenv.config()

// routes coming in
import stationsRouter from './routes/stations.js'
import tripsRouter from './routes/trips.js'
import healthRouter from './routes/health.js'
import destinationsRouter from './routes/destinations.js'
import busesRouter from './routes/buses.js'

// middleware roll call
import { errorHandler } from './middleware/errorHandler.js'

// background jobs
import { initGtfsRefreshJob } from './jobs/gtfsRefresh.js'

// bus data
import { loadBusGtfs } from './services/busGtfsLoader.js'
import { buildSpatialIndex, buildStationProximity } from './services/busStopIndex.js'
import { loadStationExits } from './services/stationService.js'

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// spin up the express app
const app = express()
const PORT = process.env.PORT || 3001
const isProduction = process.env.NODE_ENV === 'production'

// helmet with strict CSP — no unsafe-inline for scripts (Vite bundles everything into files)
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https://*.tile.openstreetmap.org"],
      connectSrc: ["'self'", "https://api.wmata.com"],
    }
  } : false
}))

// cors setup — must be explicitly configured in production
const corsOrigin = process.env.CORS_ORIGIN
if (isProduction && !corsOrigin) {
  console.error('FATAL: CORS_ORIGIN must be set in production')
  process.exit(1)
}
app.use(cors({
  origin: corsOrigin || 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

// parse json bodies (10kb limit prevents memory-bomb DoS)
app.use(express.json({ limit: '10kb' }))

// api routes
app.use('/api/stations', stationsRouter)
app.use('/api/trips', tripsRouter)
app.use('/api/health', healthRouter)
app.use('/api/destinations', destinationsRouter)
app.use('/api/buses', busesRouter)

// serve static React app in production
if (isProduction) {
  const clientDistPath = path.join(__dirname, '../../client/dist')

  // serve static files from the React app build
  app.use(express.static(clientDistPath))

  // handle client-side routing - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'))
  })
}

// error handler has to stay last
app.use(errorHandler)

// boot the server
app.listen(PORT, () => {
  console.log(`TransferHero BFF running on http://localhost:${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)

  // kick off the gtfs refresh cron if we're not testing
  if (process.env.NODE_ENV !== 'test') {
    const logMemory = (label: string) => {
      const mem = process.memoryUsage()
      console.log(`[Memory] ${label}: RSS=${(mem.rss / 1024 / 1024).toFixed(0)}MB heap=${(mem.heapUsed / 1024 / 1024).toFixed(0)}/${(mem.heapTotal / 1024 / 1024).toFixed(0)}MB`)
    }

    logMemory('boot')

    // GTFS refresh must complete first — on a fresh deploy, it downloads stops.txt
    // which stationService and the bus proximity map both need
    initGtfsRefreshJob()
      .then(() => { logMemory('after metro GTFS'); return loadStationExits() })
      .then(() => loadBusGtfs())
      .then(() => {
        logMemory('after bus GTFS')
        buildSpatialIndex()
        buildStationProximity()
        logMemory('startup complete')
      })
      .catch(err => {
        console.warn('[Startup] Data load failed — bus features disabled:', err)
      })
  }
})

// export for tests
export default app
