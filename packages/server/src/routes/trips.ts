import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { cacheMiddleware, CACHE_CONFIG } from '../middleware/cache.js'
import { asyncHandler, ValidationError } from '../middleware/errorHandler.js'
import { tripRateLimit } from '../middleware/rateLimit.js'
import { createTripPlanner, type TripPlanner } from '../services/tripPlannerService.js'

// boolean helper because z.coerce.boolean thinks "false" is true (rude)
const booleanFromString = z.preprocess(
  (val) => val === 'true' || val === true,
  z.boolean().default(false)
)

const tripQuerySchema = z.object({
  from: z.string().min(2).max(4),
  to: z.string().min(2).max(4),
  walkTime: z.coerce.number().min(1).max(5).default(2),
  transferStation: z.string().optional(),
  accessible: booleanFromString,
  includeDeparted: booleanFromString,
  // epoch ms for "leave at" trips; minute-rounded by the client so cache keys don't fragment
  departAt: z.coerce.number().int().positive().optional()
})

const leg2QuerySchema = z.object({
  departureMin: z.coerce.number().min(-120).max(120),
  walkTime: z.coerce.number().min(1).max(5).default(2),
  transferStation: z.string().optional(),
  transferArrivalMin: z.coerce.number().optional(),
  accessible: booleanFromString,
  includeDeparted: booleanFromString
})

function getApiKey(): string {
  const key = process.env.WMATA_API_KEY
  if (!key) {
    throw new Error('WMATA_API_KEY not configured')
  }
  return key
}

export interface TripsRouterDeps {
  planner?: TripPlanner
}

export interface TripRouteHandlers {
  getTrip: (req: Request, res: Response) => Promise<void>
  getLeg2: (req: Request, res: Response) => Promise<void>
}

export function createTripHandlers(planner: TripPlanner): TripRouteHandlers {
  const getTrip = async (req: Request, res: Response): Promise<void> => {
    const result = tripQuerySchema.safeParse(req.query)
    if (!result.success) {
      const issues = result.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
        received: req.query[issue.path[0] as string]
      }))
      console.error('[Trip] Validation failed | raw query:', JSON.stringify(req.query), '| issues:', JSON.stringify(issues))
      throw new ValidationError(result.error.issues.map(issue => issue.message).join(', '))
    }

    const { from, to, walkTime, transferStation, accessible, includeDeparted, departAt } = result.data
    console.log(
      `[Trip] Request: ${from} -> ${to} | walkTime=${walkTime}min${transferStation ? ` | transfer=${transferStation}` : ''}${accessible ? ' | accessible' : ''}${includeDeparted ? ' | includeDeparted' : ''}${departAt ? ` | departAt=${new Date(departAt).toISOString()}` : ''}`
    )

    const payload = await planner.planTrip({
      ...result.data,
      apiKey: getApiKey()
    })

    res.json(payload)
  }

  const getLeg2 = async (req: Request, res: Response): Promise<void> => {
    const result = leg2QuerySchema.safeParse(req.query)
    if (!result.success) {
      const rawQuery = req.query
      const issues = result.error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
        received: rawQuery[issue.path[0] as string]
      }))
      console.error(
        `[Trip] Leg2 validation failed | tripId=${req.params.tripId} | UA=${req.headers['user-agent']} | raw query:`,
        JSON.stringify(rawQuery),
        '| issues:',
        JSON.stringify(issues)
      )
      throw new ValidationError(result.error.issues.map(issue => issue.message).join(', '))
    }

    const { departureMin, walkTime, transferStation, transferArrivalMin, accessible, includeDeparted } = result.data
    console.log(
      `[Trip] Leg2 Request: ${req.params.tripId} | departureMin=${departureMin} | walkTime=${walkTime}min${transferStation ? ` | transfer=${transferStation}` : ''}${transferArrivalMin !== undefined ? ` | transferArrival=${transferArrivalMin}min` : ''}${accessible ? ' | accessible' : ''}${includeDeparted ? ' | includeDeparted' : ''}`
    )

    const payload = await planner.planLeg2({
      tripId: req.params.tripId,
      ...result.data,
      apiKey: getApiKey()
    })

    res.json(payload)
  }

  return { getTrip, getLeg2 }
}

export function createTripsRouter(deps: TripsRouterDeps = {}): Router {
  const planner = deps.planner ?? createTripPlanner()
  const handlers = createTripHandlers(planner)
  const router = Router()

  router.get('/', tripRateLimit, cacheMiddleware(CACHE_CONFIG.tripPlan), asyncHandler(handlers.getTrip))
  router.get('/:tripId/leg2', tripRateLimit, asyncHandler(handlers.getLeg2))

  return router
}

const router = createTripsRouter()

export default router
