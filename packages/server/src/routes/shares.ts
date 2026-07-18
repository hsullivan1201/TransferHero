import { Router } from 'express'
import type { SharedTripPayload } from '@transferhero/shared'
import { shareCreateRateLimit } from '../middleware/rateLimit.js'
import { renderShareCardPng } from '../services/shareImage.js'
import { renderSharePage } from '../services/sharePage.js'
import {
  findStoredShareToken,
  SHORT_SHARE_CODE_PATTERN,
  storeShareToken,
} from '../services/shareLinkStore.js'
import { normalizeCreatedTrip } from '../services/shareTripNormalizer.js'
import { createShareToken, decodeShareToken } from '../services/shareToken.js'
import { getLiveTrackerResponse } from '../services/liveTracker.js'

const MAX_CARD_CACHE_ENTRIES = 64
const cardCache = new Map<string, Promise<Buffer>>()

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
