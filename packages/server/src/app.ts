import express, { type Router } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import path from 'path'
import { fileURLToPath } from 'url'

import alertsRouter from './routes/alerts.js'
import busesRouter from './routes/buses.js'
import destinationsRouter from './routes/destinations.js'
import healthRouter from './routes/health.js'
import stationsRouter from './routes/stations.js'
import tripsRouter from './routes/trips.js'

import { errorHandler } from './middleware/errorHandler.js'
import { apiRateLimit } from './middleware/rateLimit.js'

export interface CreateAppOptions {
  tripsRouter?: Router
  isProduction?: boolean
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production'

  app.set('trust proxy', isProduction ? 1 : false)

  app.use(helmet({
    contentSecurityPolicy: isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'", 'https://api.wmata.com'],
      }
    } : false
  }))

  const corsOrigin = process.env.CORS_ORIGIN
  if (isProduction && !corsOrigin) {
    throw new Error('CORS_ORIGIN must be set in production')
  }

  app.use(cors({
    origin: corsOrigin || 'http://localhost:3000',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }))

  app.use(express.json({ limit: '10kb' }))
  app.use('/api', apiRateLimit)

  app.use('/api/stations', stationsRouter)
  app.use('/api/trips', options.tripsRouter ?? tripsRouter)
  app.use('/api/health', healthRouter)
  app.use('/api/destinations', destinationsRouter)
  app.use('/api/buses', busesRouter)
  app.use('/api/alerts', alertsRouter)

  if (isProduction) {
    const clientDistPath = path.join(__dirname, '../../client/dist')
    app.use(express.static(clientDistPath))
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDistPath, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
