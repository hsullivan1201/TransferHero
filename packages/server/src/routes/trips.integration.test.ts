import assert from 'node:assert/strict'
import type { NextFunction, Request, Response } from 'express'
import type { Train } from '@transferhero/shared'
import { getTrainMinutes } from '@transferhero/shared'
import { ALL_STATIONS } from '../data/stations.js'
import { CACHE_CONFIG, cacheMiddleware, clearAllCache } from '../middleware/cache.js'
import { tripRateLimit } from '../middleware/rateLimit.js'
import { findTransfer } from '../services/pathfinding.js'
import { createTripPlanner, type TripPlannerDeps } from '../services/tripPlannerService.js'
import { createTripHandlers } from './trips.js'

interface RoutePair {
  from: string
  to: string
}

interface MultiLineRoutePair extends RoutePair {
  lines: string[]
}

interface MockRealtimeControls {
  deps: Partial<TripPlannerDeps>
  setUpstreamHealthy(value: boolean): void
  getPredictionCallCount(): number
}

interface MockResponse {
  headers: Record<string, string>
  statusCode: number
  body: any
  finished: boolean
  setHeader(name: string, value: string): void
  set(name: string, value: string): MockResponse
  status(code: number): MockResponse
  json(data: any): MockResponse
}

const PREDICTION_TTL_MS = 15_000

function findRoutePair(direct: boolean): RoutePair {
  for (const fromStation of ALL_STATIONS) {
    for (const toStation of ALL_STATIONS) {
      if (fromStation.code === toStation.code) continue

      const transfer = findTransfer(fromStation.code, toStation.code, 2)
      if (!transfer) continue
      if (direct && transfer.direct) return { from: fromStation.code, to: toStation.code }
      if (!direct && !transfer.direct) return { from: fromStation.code, to: toStation.code }
    }
  }

  throw new Error(`Unable to find a ${direct ? 'direct' : 'transfer'} route pair in station graph`)
}

function findMultiLineDirectRoutePair(): MultiLineRoutePair {
  for (const fromStation of ALL_STATIONS) {
    for (const toStation of ALL_STATIONS) {
      if (fromStation.code === toStation.code) continue

      const sharedLines = fromStation.lines.filter(line => toStation.lines.includes(line))
      if (sharedLines.length > 1) {
        return { from: fromStation.code, to: toStation.code, lines: sharedLines }
      }
    }
  }

  throw new Error('Unable to find a multi-line direct route pair in station graph')
}

function createMockRealtimeDeps(): MockRealtimeControls {
  let upstreamHealthy = true
  let predictionCalls = 0

  const stationPredictionCache = new Map<string, { data: Train[]; ts: number }>()

  const basePredictions: Train[] = [
    { Line: 'RD', DestinationName: 'Glenmont', Min: '3', Car: '8' },
    { Line: 'RD', DestinationName: 'Shady Grove', Min: '8', Car: '8' },
    { Line: 'OR', DestinationName: 'Vienna', Min: '4', Car: '8' },
    { Line: 'SV', DestinationName: 'Ashburn', Min: '6', Car: '8' },
    { Line: 'BL', DestinationName: 'Largo Town Center', Min: '5', Car: '8' },
    { Line: 'GR', DestinationName: 'Greenbelt', Min: '5', Car: '8' },
    { Line: 'YL', DestinationName: 'Huntington', Min: '7', Car: '8' },
  ]

  return {
    deps: {
      fetchStationPredictions: async (stationCode: string): Promise<Train[]> => {
        predictionCalls += 1
        const now = Date.now()
        const cached = stationPredictionCache.get(stationCode)

        if (cached && (now - cached.ts) < PREDICTION_TTL_MS) {
          return cached.data
        }

        if (!upstreamHealthy) {
          if (cached) return cached.data
          throw new Error('Mock upstream unavailable')
        }

        const data = basePredictions.map(train => ({ ...train }))
        stationPredictionCache.set(stationCode, { data, ts: now })
        return data
      },
      fetchGTFSTripUpdates: async (): Promise<any[]> => [],
      parseUpdatesToTrains: () => [],
      filterApiResponse: (trains: Train[]) => trains,
      fetchDestinationArrivals: async (originTrains: Train[]) => {
        return originTrains.map((train, index) => {
          const baseMin = getTrainMinutes(train.Min)
          const destMin = baseMin + 12 + (index % 2)
          const arrivalTimestamp = Date.now() + (destMin * 60_000)

          return {
            ...train,
            _destArrivalMin: destMin,
            _destArrivalTimestamp: arrivalTimestamp,
            _destArrivalTime: new Date(arrivalTimestamp).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              timeZone: 'America/New_York'
            }),
            _realtimeSource: 'wmata' as const
          }
        })
      },
      findDepartedTrains: () => []
    },
    setUpstreamHealthy(value: boolean): void {
      upstreamHealthy = value
    },
    getPredictionCallCount(): number {
      return predictionCalls
    }
  }
}

function makeMockResponse(): MockResponse {
  const response = {
    headers: {},
    statusCode: 200,
    body: undefined,
    finished: false,
  } as MockResponse

  response.setHeader = (name: string, value: string) => {
    response.headers[name.toLowerCase()] = value
  }

  response.set = (name: string, value: string) => {
    response.headers[name.toLowerCase()] = value
    return response
  }

  response.status = (code: number) => {
    response.statusCode = code
    return response
  }

  response.json = (data: any) => {
    response.body = data
    response.finished = true
    return response
  }

  return response
}

function makeMockRequest(params: {
  originalUrl: string
  query: Record<string, string | undefined>
  params?: Record<string, string>
}): Request {
  return {
    method: 'GET',
    originalUrl: params.originalUrl,
    query: params.query,
    params: params.params ?? {},
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  } as unknown as Request
}

async function runMiddleware(req: Request, res: Response, middleware: (req: Request, res: Response, next: NextFunction) => void): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    let settled = false
    middleware(req, res, (err?: any) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve(true)
    })

    if (!settled && (res as unknown as MockResponse).finished) {
      settled = true
      resolve(false)
    }
  })
}

async function runTripGetPipeline(
  req: Request,
  res: MockResponse,
  getTrip: (req: Request, res: Response) => Promise<void>
): Promise<void> {
  const passedRateLimit = await runMiddleware(req, res as unknown as Response, tripRateLimit)
  if (!passedRateLimit) return

  const passedCache = await runMiddleware(req, res as unknown as Response, cacheMiddleware(CACHE_CONFIG.tripPlan))
  if (!passedCache) return

  await getTrip(req, res as unknown as Response)
}

async function directTripPlanEndpointReturnsStructuredPayload() {
  clearAllCache()
  process.env.WMATA_API_KEY = 'test-key'

  const controls = createMockRealtimeDeps()
  const planner = createTripPlanner(controls.deps)
  const handlers = createTripHandlers(planner)

  const directRoute = findRoutePair(true)
  const req = makeMockRequest({
    originalUrl: `/api/trips?from=${directRoute.from}&to=${directRoute.to}&walkTime=2`,
    query: {
      from: directRoute.from,
      to: directRoute.to,
      walkTime: '2'
    }
  })
  const res = makeMockResponse()

  await runTripGetPipeline(req, res, handlers.getTrip as any)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['x-cache'], 'MISS')
  assert.ok(res.body.trip)
  assert.equal(typeof res.body.trip.isDirect, 'boolean')
  assert.ok(Array.isArray(res.body.trip.leg1?.trains))
  assert.ok(res.body.trip.leg1.trains.length > 0)
  console.log('✓ trip GET pipeline returns a structured trip plan payload for direct routes')
}

async function multiLineDirectTripExposesLineSpecificCarPositions() {
  clearAllCache()
  process.env.WMATA_API_KEY = 'test-key'

  const controls = createMockRealtimeDeps()
  const planner = createTripPlanner(controls.deps)
  const handlers = createTripHandlers(planner)

  const directRoute = findMultiLineDirectRoutePair()
  const req = makeMockRequest({
    originalUrl: `/api/trips?from=${directRoute.from}&to=${directRoute.to}&walkTime=2`,
    query: {
      from: directRoute.from,
      to: directRoute.to,
      walkTime: '2'
    }
  })
  const res = makeMockResponse()

  await runTripGetPipeline(req, res, handlers.getTrip as any)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.trip.isDirect, true)
  assert.equal(res.body.trip.leg1.carPosition, null)
  assert.ok(res.body.trip.leg1.lineCarPositions)
  assert.deepEqual(
    Object.keys(res.body.trip.leg1.lineCarPositions).sort(),
    [...directRoute.lines].sort()
  )
  console.log('✓ multi-line direct trips expose line-specific car positions instead of a misleading shared one')
}

async function tripApiCacheAvoidsDuplicateRealtimeCallsWithinTtl() {
  clearAllCache()
  process.env.WMATA_API_KEY = 'test-key'

  const controls = createMockRealtimeDeps()
  const planner = createTripPlanner(controls.deps)
  const handlers = createTripHandlers(planner)

  const directRoute = findRoutePair(true)
  const originalUrl = `/api/trips?from=${directRoute.from}&to=${directRoute.to}&walkTime=2`

  const req1 = makeMockRequest({
    originalUrl,
    query: { from: directRoute.from, to: directRoute.to, walkTime: '2' }
  })
  const res1 = makeMockResponse()
  await runTripGetPipeline(req1, res1, handlers.getTrip as any)

  const callsAfterFirst = controls.getPredictionCallCount()
  assert.ok(callsAfterFirst > 0)

  controls.setUpstreamHealthy(false)

  const req2 = makeMockRequest({
    originalUrl,
    query: { from: directRoute.from, to: directRoute.to, walkTime: '2' }
  })
  const res2 = makeMockResponse()
  await runTripGetPipeline(req2, res2, handlers.getTrip as any)

  assert.equal(res2.statusCode, 200)
  assert.equal(res2.headers['x-cache'], 'HIT')
  assert.equal(controls.getPredictionCallCount(), callsAfterFirst)
  console.log('✓ trip cache returns HIT responses without duplicate realtime calls')
}

async function staleRealtimeFallbackServesTripAfterUpstreamFailure() {
  clearAllCache()
  process.env.WMATA_API_KEY = 'test-key'

  const controls = createMockRealtimeDeps()
  const planner = createTripPlanner(controls.deps)
  const handlers = createTripHandlers(planner)

  const directRoute = findRoutePair(true)
  const originalUrl = `/api/trips?from=${directRoute.from}&to=${directRoute.to}&walkTime=2`

  const req1 = makeMockRequest({
    originalUrl,
    query: { from: directRoute.from, to: directRoute.to, walkTime: '2' }
  })
  const res1 = makeMockResponse()
  await runTripGetPipeline(req1, res1, handlers.getTrip as any)
  assert.equal(res1.statusCode, 200)

  clearAllCache()
  controls.setUpstreamHealthy(false)

  const originalDateNow = Date.now
  try {
    const baselineNow = originalDateNow()
    Date.now = () => baselineNow + PREDICTION_TTL_MS + 1_000

    const req2 = makeMockRequest({
      originalUrl,
      query: { from: directRoute.from, to: directRoute.to, walkTime: '2' }
    })
    const res2 = makeMockResponse()
    await runTripGetPipeline(req2, res2, handlers.getTrip as any)

    assert.equal(res2.statusCode, 200)
    assert.ok(Array.isArray(res2.body.trip?.leg1?.trains))
    assert.ok(res2.body.trip.leg1.trains.length > 0)
  } finally {
    Date.now = originalDateNow
  }

  console.log('✓ stale realtime fallback keeps trip pipeline available after upstream failures')
}

async function leg2PipelineReturnsCatchableTrainsForTransferTrips() {
  clearAllCache()
  process.env.WMATA_API_KEY = 'test-key'

  const controls = createMockRealtimeDeps()
  const planner = createTripPlanner(controls.deps)
  const handlers = createTripHandlers(planner)

  const transferRoute = findRoutePair(false)
  const tripId = `${transferRoute.from}-${transferRoute.to}`

  const req = makeMockRequest({
    originalUrl: `/api/trips/${tripId}/leg2?departureMin=3&walkTime=2&includeDeparted=false`,
    query: {
      departureMin: '3',
      walkTime: '2',
      includeDeparted: 'false'
    },
    params: { tripId }
  })
  const res = makeMockResponse()

  const passedRateLimit = await runMiddleware(req, res as unknown as Response, tripRateLimit)
  if (passedRateLimit) {
    await (handlers.getLeg2 as any)(req, res as unknown as Response)
  }

  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body.trains))
  assert.equal(typeof res.body.arrivalAtTransfer, 'number')
  console.log('✓ leg2 pipeline returns catchable trains for transfer trips')
}

async function futureDepartAtSkipsRealtimeCallsEntirely() {
  clearAllCache()
  process.env.WMATA_API_KEY = 'test-key'

  const controls = createMockRealtimeDeps()
  const planner = createTripPlanner(controls.deps)
  const handlers = createTripHandlers(planner)

  const directRoute = findRoutePair(true)
  const departAt = Date.now() + 2 * 60 * 60 * 1000
  const req = makeMockRequest({
    originalUrl: `/api/trips?from=${directRoute.from}&to=${directRoute.to}&walkTime=2&departAt=${departAt}`,
    query: {
      from: directRoute.from,
      to: directRoute.to,
      walkTime: '2',
      departAt: String(departAt)
    }
  })
  const res = makeMockResponse()

  await runTripGetPipeline(req, res, handlers.getTrip as any)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.meta?.scheduleOnly, true)
  assert.ok(Array.isArray(res.body.trip?.leg1?.trains))
  assert.equal(controls.getPredictionCallCount(), 0)
  console.log('✓ future departAt trips are schedule-only and make zero realtime prediction calls')
}

await directTripPlanEndpointReturnsStructuredPayload()
await multiLineDirectTripExposesLineSpecificCarPositions()
await tripApiCacheAvoidsDuplicateRealtimeCallsWithinTtl()
await staleRealtimeFallbackServesTripAfterUpstreamFailure()
await leg2PipelineReturnsCatchableTrainsForTransferTrips()
await futureDepartAtSkipsRealtimeCallsEntirely()

console.log('trips integration tests passed')
