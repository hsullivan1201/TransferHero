import { Router } from 'express'
import type {
  SharedPlaceContext,
  SharedTrackedTrain,
  SharedTripPayload,
  SharedTripTracking,
  Station,
} from '@transferhero/shared'
import { parseSharedTripPayload, SHARE_TRIP_VERSION } from '@transferhero/shared'
import { LINE_PATHS } from '../data/lineConfig.js'
import { normalizePlatformCode, STATION_ALIASES } from '../data/platformCodes.js'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'
import { shareCreateRateLimit } from '../middleware/rateLimit.js'
import { renderShareCardPng } from '../services/shareImage.js'
import { renderSharePage } from '../services/sharePage.js'
import {
  findStoredShareToken,
  SHORT_SHARE_CODE_PATTERN,
  storeShareToken,
} from '../services/shareLinkStore.js'
import { createShareToken, decodeShareToken } from '../services/shareToken.js'
import { getExitsForStation } from '../services/stationService.js'
import { getLiveTrackerResponse } from '../services/liveTracker.js'

const MAX_CARD_CACHE_ENTRIES = 64
const TRACKING_ARRIVAL_GRACE_MS = 30 * 60 * 1000
const MAX_TRACKING_FUTURE_MS = 24 * 60 * 60 * 1000
const cardCache = new Map<string, Promise<Buffer>>()
const CANONICAL_STATION_CODES = Object.values(LINE_PATHS).flat(2)

function publicBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL?.trim()
    || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3001')
  if (!raw) throw new Error('PUBLIC_BASE_URL must be configured in production')
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('PUBLIC_BASE_URL must be a plain HTTP(S) origin')
  }
  const localSmoke = process.env.LOCAL_SHARE_SMOKE === 'true'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:' && !localSmoke) {
    throw new Error('PUBLIC_BASE_URL must use HTTPS in production')
  }
  return url.origin
}

function canonicalPlaceContext(
  context: SharedPlaceContext | undefined,
  stationCode: string
): SharedPlaceContext | undefined {
  if (!context || context.station.code !== stationCode) return undefined
  const station = findStationByCode(stationCode)
  if (!station) return undefined
  const knownExits = getExitsForStation(stationCode)
  if (knownExits.length > 0 && !knownExits.some(exit => exit.id === context.exit.id)) return undefined
  return { ...context, station }
}

function canonicalStation(station: Station): Station | null {
  const code = normalizePlatformCode(station.code, CANONICAL_STATION_CODES)
  return findStationByCode(code) ?? null
}

function followsCanonicalPath(train: SharedTrackedTrain): boolean {
  const codes = train.stops.map(stop => stop.code)
  return LINE_PATHS[train.line].some(path => {
    const normalizedCodes = codes.map(code => normalizePlatformCode(code, path))
    const fromIndex = path.indexOf(normalizedCodes[0])
    const toIndex = path.indexOf(normalizedCodes[normalizedCodes.length - 1])
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false
    const step = fromIndex < toIndex ? 1 : -1
    const expected: string[] = []
    for (let index = fromIndex; ; index += step) {
      expected.push(path[index])
      if (index === toIndex) break
    }
    return expected.length === normalizedCodes.length
      && expected.every((code, index) => code === normalizedCodes[index])
  })
}

function canonicalTrackedTrain(train: SharedTrackedTrain): SharedTrackedTrain | null {
  const stops = train.stops.map(canonicalStation)
  const from = canonicalStation(train.from)
  const to = canonicalStation(train.to)
  if (stops.some(stop => stop == null) || !from || !to) return null
  const normalizedStops = stops as Station[]
  const normalized: SharedTrackedTrain = { ...train, from, to, stops: normalizedStops }
  if (
    normalizedStops[0].code !== from.code
    || normalizedStops[normalizedStops.length - 1].code !== to.code
    || normalizedStops.some(stop => !stop.lines.includes(train.line))
    || !followsCanonicalPath(normalized)
  ) return null
  return normalized
}

function normalizedStationName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '')
}

function samePhysicalStation(left: Station, right: Station): boolean {
  return left.code === right.code
    || STATION_ALIASES[left.code] === right.code
    || STATION_ALIASES[right.code] === left.code
}

function trackingMatchesTrip(
  trains: SharedTrackedTrain[],
  trip: SharedTripPayload
): boolean {
  const railLegs = trip.legs.filter(leg => leg.kind === 'rail')
  if (railLegs.length < 1 || railLegs.length > 2) return false
  const transferName = trip.transferName ? normalizedStationName(trip.transferName) : null
  const transferStations = transferName
    ? ALL_STATIONS.filter(station => normalizedStationName(station.name) === transferName)
    : []

  for (const train of trains) {
    const railLeg = railLegs[train.leg - 1]
    if (!railLeg || railLeg.line !== train.line || !trip.lines.includes(train.line)) return false
    if (railLeg.toward && normalizedStationName(railLeg.toward) !== normalizedStationName(train.toward)) {
      return false
    }

    if (train.leg === 1 && !samePhysicalStation(train.from, trip.origin)) return false
    if (train.leg === railLegs.length && !samePhysicalStation(train.to, trip.destination)) return false

    if (railLegs.length === 2) {
      const transferEndpoint = train.leg === 1 ? train.to : train.from
      if (!transferStations.some(station => samePhysicalStation(station, transferEndpoint))) return false
    }
  }

  const first = trains.find(train => train.leg === 1)
  const second = trains.find(train => train.leg === 2)
  return !first || !second || samePhysicalStation(first.to, second.from)
}

function canonicalTracking(
  tracking: SharedTripTracking | undefined,
  trip: SharedTripPayload,
  nowMs: number
): SharedTripTracking | undefined | null {
  if (!tracking) return undefined
  const trains = tracking.trains.map(canonicalTrackedTrain)
  if (trains.some(train => train == null)) return null
  const normalizedTrains = trains as SharedTrackedTrain[]
  if (!trackingMatchesTrip(normalizedTrains, trip)) return null
  const tripEndMs = Math.max(...normalizedTrains.map(train => train.arrivalAtMs))
  if (tripEndMs > nowMs + MAX_TRACKING_FUTURE_MS) return null
  return {
    trains: normalizedTrains,
    expiresAtMs: Math.min(tripEndMs + TRACKING_ARRIVAL_GRACE_MS, nowMs + MAX_TRACKING_FUTURE_MS),
  }
}

function normalizeCreatedTrip(value: unknown, nowMs = Date.now()): SharedTripPayload | null {
  const parsed = parseSharedTripPayload(value)
  // Creation always upgrades to the current contract. Decoding still accepts v2.
  if (!parsed || parsed.v !== SHARE_TRIP_VERSION) return null
  const origin = findStationByCode(parsed.origin.code)
  const destination = findStationByCode(parsed.destination.code)
  if (!origin || !destination || origin.code === destination.code) return null

  const originPlaceContext = canonicalPlaceContext(parsed.originPlaceContext, origin.code)
  const destPlaceContext = canonicalPlaceContext(parsed.destPlaceContext, destination.code)
  if (parsed.originPlaceContext && !originPlaceContext) return null
  if (parsed.destPlaceContext && !destPlaceContext) return null
  const tracking = canonicalTracking(parsed.tracking, parsed, nowMs)
  if (tracking === null) return null

  return {
    ...parsed,
    origin,
    destination,
    ...(originPlaceContext ? { originPlaceContext } : {}),
    ...(destPlaceContext ? { destPlaceContext } : {}),
    sharedAtMs: nowMs,
    ...(tracking ? { tracking } : {}),
  }
}

function resolveShareReference(reference: string): SharedTripPayload | null {
  const token = SHORT_SHARE_CODE_PATTERN.test(reference)
    ? findStoredShareToken(reference)
    : reference
  return token ? decodeShareToken(token) : null
}

function logShareStoreError(action: 'write' | 'read', error: unknown): void {
  console.error(
    `[ShareLinks] Unable to ${action} short link:`,
    error instanceof Error ? error.message : error
  )
}

function cachedCard(token: string, trip: SharedTripPayload): Promise<Buffer> {
  const existing = cardCache.get(token)
  if (existing) return existing
  const rendering = Promise.resolve().then(() => renderShareCardPng(trip))
  cardCache.set(token, rendering)
  rendering.catch(() => cardCache.delete(token))
  while (cardCache.size > MAX_CARD_CACHE_ENTRIES) {
    const oldest = cardCache.keys().next().value
    if (typeof oldest === 'string') cardCache.delete(oldest)
    else break
  }
  return rendering
}

export const sharesApiRouter = Router()

sharesApiRouter.post('/', shareCreateRateLimit, (req, res) => {
  const trip = normalizeCreatedTrip(req.body?.trip)
  if (!trip) {
    res.status(400).set('Cache-Control', 'no-store').json({ error: 'Invalid trip share data' })
    return
  }

  const signedToken = createShareToken(trip)
  let reference = signedToken
  try {
    reference = storeShareToken(signedToken) ?? signedToken
  } catch (error) {
    // A long signed URL is still fully functional if persistent storage is down.
    logShareStoreError('write', error)
  }
  const url = `${publicBaseUrl()}/t/${reference}`
  res
    .status(201)
    .set('Cache-Control', 'no-store')
    .set('Location', url)
    .json({ token: reference, url, trip })
})

sharesApiRouter.get('/:token/live', async (req, res, next) => {
  try {
    const trip = resolveShareReference(req.params.token)
    if (!trip) {
      res.status(404).set('Cache-Control', 'no-store').json({ error: 'Shared trip not found' })
      return
    }
    if (!trip.tracking) {
      res.status(404).set('Cache-Control', 'no-store').json({ error: 'Live tracking is not available for this share' })
      return
    }

    const live = await getLiveTrackerResponse(trip)
    res.set('Cache-Control', 'no-store').json(live)
  } catch (error) {
    // Persistent short-link reads have a more actionable response than a generic 500.
    if (SHORT_SHARE_CODE_PATTERN.test(req.params.token)) {
      logShareStoreError('read', error)
      res.status(503).set('Cache-Control', 'no-store').json({ error: 'Shared trip temporarily unavailable' })
    } else {
      next(error)
    }
  }
})

sharesApiRouter.get('/:token', (req, res) => {
  let trip: SharedTripPayload | null
  try {
    trip = resolveShareReference(req.params.token)
  } catch (error) {
    logShareStoreError('read', error)
    res.status(503).set('Cache-Control', 'no-store').json({ error: 'Shared trip temporarily unavailable' })
    return
  }
  if (!trip) {
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Shared trip not found' })
    return
  }
  res.set('Cache-Control', 'no-store').json({ trip })
})

export const publicSharesRouter = Router()

publicSharesRouter.get('/:token/card.png', async (req, res) => {
  let trip: SharedTripPayload | null
  try {
    trip = resolveShareReference(req.params.token)
  } catch (error) {
    logShareStoreError('read', error)
    res.status(503).set('Cache-Control', 'no-store').type('text').send('Shared trip temporarily unavailable')
    return
  }
  if (!trip) {
    res.status(404).set('Cache-Control', 'no-store').type('text').send('Shared trip not found')
    return
  }

  try {
    const png = await cachedCard(req.params.token, trip)
    res
      .status(200)
      .set({
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline; filename="transferhero-trip.png"',
        'Content-Type': 'image/png',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(png)
  } catch (error) {
    console.error('[ShareCard] Unable to render preview image:', error instanceof Error ? error.message : error)
    res.status(500).set('Cache-Control', 'no-store').type('text').send('Unable to render trip preview')
  }
})

publicSharesRouter.get('/:token', (req, res) => {
  let trip: SharedTripPayload | null
  try {
    trip = resolveShareReference(req.params.token)
  } catch (error) {
    logShareStoreError('read', error)
    res.status(503).set('Cache-Control', 'no-store').type('text').send('Shared trip temporarily unavailable')
    return
  }
  if (!trip) {
    res.status(404).set('Cache-Control', 'no-store').type('text').send('Shared trip not found')
    return
  }

  res
    .status(200)
    .set({
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, noarchive',
    })
    .send(renderSharePage(trip, req.params.token, publicBaseUrl()))
})

export default sharesApiRouter
