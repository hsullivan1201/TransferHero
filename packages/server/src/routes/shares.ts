import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Router } from 'express'
import type { SharedPlaceContext, SharedTripPayload } from '@transferhero/shared'
import { parseSharedTripPayload } from '@transferhero/shared'
import { findStationByCode } from '../data/stations.js'
import { shareCreateRateLimit } from '../middleware/rateLimit.js'
import { renderShareCardPng } from '../services/shareImage.js'
import { createShareToken, decodeShareToken } from '../services/shareToken.js'
import { getExitsForStation } from '../services/stationService.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MAX_CARD_CACHE_ENTRIES = 64
const SHARE_CARD_RENDER_VERSION = 2
const cardCache = new Map<string, Promise<Buffer>>()
let cachedClientIndex: string | null = null

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatClock(timestamp: number | null): string | null {
  if (timestamp == null) return null
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(timestamp))
}

function endpointLabel(trip: SharedTripPayload, endpoint: 'origin' | 'destination'): string {
  if (endpoint === 'origin') return trip.originPlaceContext?.place.name ?? trip.origin.name
  return trip.destPlaceContext?.place.name ?? trip.destination.name
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

function normalizeCreatedTrip(value: unknown): SharedTripPayload | null {
  const parsed = parseSharedTripPayload(value)
  if (!parsed) return null
  const origin = findStationByCode(parsed.origin.code)
  const destination = findStationByCode(parsed.destination.code)
  if (!origin || !destination || origin.code === destination.code) return null

  const originPlaceContext = canonicalPlaceContext(parsed.originPlaceContext, origin.code)
  const destPlaceContext = canonicalPlaceContext(parsed.destPlaceContext, destination.code)
  if (parsed.originPlaceContext && !originPlaceContext) return null
  if (parsed.destPlaceContext && !destPlaceContext) return null

  return {
    ...parsed,
    origin,
    destination,
    ...(originPlaceContext ? { originPlaceContext } : {}),
    ...(destPlaceContext ? { destPlaceContext } : {}),
    sharedAtMs: Date.now(),
  }
}

function clientIndex(): string {
  if (cachedClientIndex) return cachedClientIndex
  if (process.env.NODE_ENV !== 'production') {
    cachedClientIndex = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TransferHero</title></head><body><div id="root"></div><script type="module" src="http://localhost:3000/src/main.tsx"></script></body></html>'
    return cachedClientIndex
  }
  try {
    cachedClientIndex = readFileSync(
      path.resolve(__dirname, '../../../client/dist/index.html'),
      'utf8'
    )
  } catch {
    cachedClientIndex = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TransferHero</title></head><body><main><h1>TransferHero</h1><p>Open this link on the TransferHero app.</p></main></body></html>'
  }
  return cachedClientIndex
}

export function renderSharePage(trip: SharedTripPayload, token: string, baseUrl = publicBaseUrl()): string {
  const origin = endpointLabel(trip, 'origin')
  const destination = endpointLabel(trip, 'destination')
  const arrival = formatClock(trip.timing.arrivalAtMs)
  const title = `${origin} to ${destination}${arrival ? ` · arrive ${arrival}` : ''}`
  const description = `${Math.round(trip.durationMinutes)} min · ${trip.routeSummary}`
  const shareUrl = `${baseUrl}/t/${token}`
  // Keep crawler caches from reusing a card produced by an older renderer.
  const imageUrl = `${shareUrl}/card.png?v=${SHARE_CARD_RENDER_VERSION}`
  const capturedAt = formatClock(trip.timing.capturedAtMs)
  const status = trip.timing.source === 'live'
    ? 'live snapshot'
    : trip.timing.source === 'mixed'
      ? 'live and scheduled snapshot'
      : 'scheduled snapshot'
  const imageAlt = `Trip diagram from ${origin} to ${destination}, ${Math.round(trip.durationMinutes)} minutes via ${trip.routeSummary}${arrival ? `, arriving ${arrival}` : ''}; ${status}${capturedAt ? ` as of ${capturedAt}` : ''}`
  const tags = `
    <meta name="robots" content="noindex,noarchive" />
    <meta name="referrer" content="no-referrer" />
    <link rel="canonical" href="${escapeHtml(shareUrl)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="TransferHero" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:image" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(imageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(imageAlt)}" />`

  return clientIndex()
    .replace(/<title>[^<]*<\/title>/iu, `<title>${escapeHtml(title)}</title>`)
    .replace(/<meta\s+name=["']description["'][^>]*>/iu, `<meta name="description" content="${escapeHtml(description)}" />`)
    .replace('</head>', `${tags}\n  </head>`)
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

  const token = createShareToken(trip)
  const url = `${publicBaseUrl()}/t/${token}`
  res
    .status(201)
    .set('Cache-Control', 'no-store')
    .set('Location', url)
    .json({ token, url, trip })
})

sharesApiRouter.get('/:token', (req, res) => {
  const trip = decodeShareToken(req.params.token)
  if (!trip) {
    res.status(404).set('Cache-Control', 'no-store').json({ error: 'Shared trip not found' })
    return
  }
  res.set('Cache-Control', 'no-store').json({ trip })
})

export const publicSharesRouter = Router()

publicSharesRouter.get('/:token/card.png', async (req, res) => {
  const trip = decodeShareToken(req.params.token)
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
  const trip = decodeShareToken(req.params.token)
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
    .send(renderSharePage(trip, req.params.token))
})

export default sharesApiRouter
