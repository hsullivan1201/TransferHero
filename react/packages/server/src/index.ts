import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Import routes
import stationsRouter from './routes/stations.js'
import tripsRouter from './routes/trips.js'
import healthRouter from './routes/health.js'

// Import middleware
import { errorHandler } from './middleware/errorHandler.js'

// Import jobs
import { initGtfsRefreshJob } from './jobs/gtfsRefresh.js'

// Create Express app
const app = express()
const PORT = process.env.PORT || 3001

// Security middleware
app.use(helmet())

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))

// Body parsing
app.use(express.json())

// Request logging (simple)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// API Routes
app.use('/api/stations', stationsRouter)
app.use('/api/trips', tripsRouter)
app.use('/api/health', healthRouter)

// Error handling (must be last)
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
  console.log(`TransferHero BFF running on http://localhost:${PORT}`)
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`)

  // Initialize GTFS refresh cron job
  if (process.env.NODE_ENV !== 'test') {
    initGtfsRefreshJob()
  }
})

// Export for testing
export default app
