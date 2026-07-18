import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SharedTripPayload } from '@transferhero/shared'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SHARE_CARD_RENDER_VERSION = 3
let cachedClientIndex: string | null = null

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

export function renderSharePage(trip: SharedTripPayload, token: string, baseUrl: string): string {
  const origin = endpointLabel(trip, 'origin')
  const destination = endpointLabel(trip, 'destination')
  const arrival = formatClock(trip.timing.arrivalAtMs)
  const isLiveTracker = !!trip.tracking?.trains.length
  const title = isLiveTracker
    ? `${origin} to ${destination} · Live train tracker`
    : `${origin} to ${destination}${arrival ? ` · arrive ${arrival}` : ''}`
  const description = isLiveTracker
    ? `Follow ${trip.tracking!.trains.length === 1 ? 'this Metro train' : 'these Metro trains'} live · ${trip.routeSummary}`
    : `${Math.round(trip.durationMinutes)} min · ${trip.routeSummary}`
  const shareUrl = `${baseUrl}/t/${token}`
  // Keep crawler caches from reusing a card produced by an older renderer.
  const imageUrl = `${shareUrl}/card.png?v=${SHARE_CARD_RENDER_VERSION}`
  const capturedAt = formatClock(trip.timing.capturedAtMs)
  const status = isLiveTracker
    ? `live tracker for ${trip.tracking!.trains.length} selected ${trip.tracking!.trains.length === 1 ? 'train' : 'trains'}`
    : trip.timing.source === 'live'
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
