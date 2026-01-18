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

// middleware roll call
import { errorHandler } from './middleware/errorHandler.js'

// background jobs
import { initGtfsRefreshJob } from './jobs/gtfsRefresh.js'

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// spin up the express app
const app = express()
const PORT = process.env.PORT || 3001
const isProduction = process.env.NODE_ENV === 'production'

// basic helmet with CSP adjustments for serving React app
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.wmata.com"],
    }
  } : false
}))

// cors setup (chill by default, stricter in production)
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

// parse json bodies
app.use(express.json())

// api routes
app.use('/api/stations', stationsRouter)
app.use('/api/trips', tripsRouter)
app.use('/api/health', healthRouter)

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
    initGtfsRefreshJob()
  }
})

// export for tests
export default app
