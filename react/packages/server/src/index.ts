import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'

// grab env vars before anything else
dotenv.config()

// routes coming in
import stationsRouter from './routes/stations.js'
import tripsRouter from './routes/trips.js'
import healthRouter from './routes/health.js'

// middleware roll call
import { errorHandler } from './middleware/errorHandler.js'

// background jobs
import { initGtfsRefreshJob } from './jobs/gtfsRefresh.js'

// spin up the express app
const app = express()
const PORT = process.env.PORT || 3001

// basic helmet so we don't forget
app.use(helmet())

// cors setup (chill by default)
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

// parse json bodies
app.use(express.json())

// simple console log so we know what's hitting us
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// api routes
app.use('/api/stations', stationsRouter)
app.use('/api/trips', tripsRouter)
app.use('/api/health', healthRouter)

// error handler has to stay last
app.use(errorHandler)

// boot the server
app.listen(PORT, () => {
  console.log(`TransferHero BFF running on http://localhost:${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)

  // kick off the gtfs refresh cron if we're not testing
  if (process.env.NODE_ENV !== 'test') {
    initGtfsRefreshJob()
  }
})

// export for tests
export default app
