import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import type { Line, SharedTripPayload } from '@transferhero/shared'

const SHARE_CARD_FONT_PATH = fileURLToPath(
  new URL('../assets/fonts/Inter-Bold.ttf', import.meta.url)
)

const LINE_NAMES: Record<Line, string> = {
  RD: 'Red',
  OR: 'Orange',
  SV: 'Silver',
  BL: 'Blue',
  YL: 'Yellow',
  GR: 'Green',
}

const LINE_COLORS: Record<Line, { background: string; foreground: string }> = {
  RD: { background: '#e51636', foreground: '#ffffff' },
  OR: { background: '#f7941d', foreground: '#2c231d' },
  SV: { background: '#a2a4a1', foreground: '#2c231d' },
  BL: { background: '#0076c0', foreground: '#ffffff' },
  YL: { background: '#ffd400', foreground: '#2c231d' },
  GR: { background: '#00a650', foreground: '#152019' },
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function truncate(value: string, maxLength: number): string {
  const characters = Array.from(value)
  return characters.length <= maxLength
    ? value
    : `${characters.slice(0, Math.max(1, maxLength - 1)).join('')}…`
}

function formatClock(timestamp: number | null): string {
  if (timestamp == null) return 'Open trip'
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

function lineBadge(line: Line, x: number, y: number): string {
  const colors = LINE_COLORS[line]
  return `
    <rect x="${x}" y="${y}" width="92" height="34" rx="17" fill="${colors.background}" />
    <text x="${x + 46}" y="${y + 23}" text-anchor="middle" font-size="15" font-weight="800" fill="${colors.foreground}">${LINE_NAMES[line]}</text>
  `
}

function diagramSvg(trip: SharedTripPayload): string {
  const firstLine = trip.lines[0]
  const finalLine = trip.lines.at(-1) ?? firstLine
  const hasTransfer = trip.lines.length > 1 && trip.transferName != null
  const firstLeg = trip.legs[0]
  const finalLeg = trip.legs.at(-1)
  const originWalk = trip.originPlaceContext?.walkTimeMinutes
    ?? (firstLeg?.kind === 'walk' ? firstLeg.minutes : 0)
  const destinationWalk = trip.destPlaceContext?.walkTimeMinutes
    ?? (finalLeg?.kind === 'walk' ? finalLeg.minutes : 0)
  const transferWalk = trip.legs.find(leg => leg.kind === 'transfer')?.minutes ?? trip.walkTime

  const originStationX = originWalk > 0 ? 224 : 150
  const destinationStationX = destinationWalk > 0 ? 976 : 1050
  const transferX = 600
  const y = 421
  const labelY = 477
  const detailY = 502

  const walkingStart = originWalk > 0 ? `
    <line x1="112" y1="${y}" x2="${originStationX}" y2="${y}" stroke="#c6b5a6" stroke-width="8" stroke-linecap="round" stroke-dasharray="4 15" />
    <circle cx="112" cy="${y}" r="11" fill="#faf3eb" />
    <text x="112" y="${detailY}" text-anchor="middle" font-size="14" font-weight="700" fill="#cdbbad">${Math.round(originWalk)} min walk</text>
  ` : ''
  const walkingEnd = destinationWalk > 0 ? `
    <line x1="${destinationStationX}" y1="${y}" x2="1088" y2="${y}" stroke="#c6b5a6" stroke-width="8" stroke-linecap="round" stroke-dasharray="4 15" />
    <circle cx="1088" cy="${y}" r="11" fill="#faf3eb" />
    <text x="1088" y="${detailY}" text-anchor="middle" font-size="14" font-weight="700" fill="#cdbbad">${Math.round(destinationWalk)} min walk</text>
  ` : ''

  const rail = hasTransfer ? `
    <line x1="${originStationX}" y1="${y}" x2="${transferX - 12}" y2="${y}" stroke="${LINE_COLORS[firstLine].background}" stroke-width="15" stroke-linecap="round" />
    <line x1="${transferX + 12}" y1="${y}" x2="${destinationStationX}" y2="${y}" stroke="${LINE_COLORS[finalLine].background}" stroke-width="15" stroke-linecap="round" />
    <circle cx="${transferX}" cy="${y}" r="18" fill="#2c231d" stroke="#faf3eb" stroke-width="7" />
    <circle cx="${transferX}" cy="${y}" r="6" fill="#faf3eb" />
    <text x="${transferX}" y="${labelY}" text-anchor="middle" font-size="18" font-weight="800" fill="#faf3eb">${escapeXml(truncate(trip.transferName ?? 'Transfer', 24))}</text>
    <text x="${transferX}" y="${detailY}" text-anchor="middle" font-size="14" font-weight="700" fill="#cdbbad">${Math.round(transferWalk)} min transfer</text>
    ${lineBadge(firstLine, originStationX + 30, y - 60)}
    ${lineBadge(finalLine, destinationStationX - 122, y - 60)}
  ` : `
    <line x1="${originStationX}" y1="${y}" x2="${destinationStationX}" y2="${y}" stroke="${LINE_COLORS[firstLine].background}" stroke-width="15" stroke-linecap="round" />
    ${lineBadge(firstLine, (originStationX + destinationStationX) / 2 - 46, y - 60)}
  `

  const liveMarker = (() => {
    const trains = trip.tracking?.trains
    if (!trains?.length) return ''
    const capturedAt = trip.timing.capturedAtMs
    const active = trains.find(train => train.arrivalAtMs == null || train.arrivalAtMs >= capturedAt)
      ?? trains.at(-1)!
    const startX = active.leg === 2 && hasTransfer ? transferX : originStationX
    const endX = active.leg === 1 && hasTransfer ? transferX : destinationStationX
    const departureAt = active.departureAtMs ?? capturedAt
    const arrivalAt = active.arrivalAtMs ?? departureAt + 30 * 60_000
    const progress = arrivalAt <= departureAt
      ? 0
      : Math.max(0, Math.min(1, (capturedAt - departureAt) / (arrivalAt - departureAt)))
    const markerX = startX + (endX - startX) * progress
    return `
      <circle cx="${markerX}" cy="${y}" r="25" fill="#faf3eb" fill-opacity="0.18" />
      <circle cx="${markerX}" cy="${y}" r="15" fill="#faf3eb" stroke="#372c24" stroke-width="4" />
      <text x="${markerX}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="900" fill="#372c24">T</text>
    `
  })()

  return `
    ${walkingStart}
    ${rail}
    ${liveMarker}
    ${walkingEnd}
    <circle cx="${originStationX}" cy="${y}" r="13" fill="#faf3eb" stroke="#2c231d" stroke-width="4" />
    <circle cx="${destinationStationX}" cy="${y}" r="13" fill="#faf3eb" stroke="#2c231d" stroke-width="4" />
    <text x="${originStationX}" y="${labelY}" text-anchor="middle" font-size="18" font-weight="800" fill="#faf3eb">${escapeXml(truncate(trip.origin.name, 24))}</text>
    <text x="${destinationStationX}" y="${labelY}" text-anchor="middle" font-size="18" font-weight="800" fill="#faf3eb">${escapeXml(truncate(trip.destination.name, 24))}</text>
  `
}

export function renderShareCardSvg(trip: SharedTripPayload): string {
  const origin = endpointLabel(trip, 'origin')
  const destination = endpointLabel(trip, 'destination')
  const firstLeg = trip.legs[0]
  const originWalk = trip.originPlaceContext?.walkTimeMinutes
    ?? (firstLeg?.kind === 'walk' ? firstLeg.minutes : 0)
  const leaveAt = trip.departAt ?? (trip.timing.departureAtMs == null
    ? null
    : trip.timing.departureAtMs - originWalk * 60_000)
  const departureLabel = originWalk > 0 ? 'LEAVE' : 'TRAIN'
  const isLiveTracker = !!trip.tracking?.trains.length
  const status = isLiveTracker
    ? 'LIVE TRAIN TRACKER'
    : trip.timing.source === 'live'
      ? 'LIVE SNAPSHOT'
      : trip.timing.source === 'mixed'
        ? 'LIVE + SCHEDULED'
        : 'SCHEDULED'
  const title = `${truncate(origin, 28)} → ${truncate(destination, 28)}`
  const titleSize = title.length > 54 ? 30 : title.length > 40 ? 34 : 39

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <pattern id="grid" width="68" height="68" patternUnits="userSpaceOnUse" patternTransform="rotate(-22)">
        <line x1="0" y1="0" x2="0" y2="68" stroke="#372c24" stroke-opacity="0.05" stroke-width="2" />
      </pattern>
      <filter id="shadow" x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx="0" dy="12" stdDeviation="15" flood-color="#271e18" flood-opacity="0.24" />
      </filter>
    </defs>
    <rect width="1200" height="630" fill="#f2e7dc" />
    <rect width="1200" height="630" fill="url(#grid)" />
    <rect x="42" y="40" width="1116" height="548" rx="32" fill="#372c24" filter="url(#shadow)" />

    <rect x="78" y="68" width="58" height="58" rx="12" fill="#faf3eb" />
    <text x="107" y="109" text-anchor="middle" font-family="Inter" font-size="39" font-weight="900" fill="#372c24">T</text>
    <text x="156" y="91" font-family="Inter" font-size="29" font-weight="800" fill="#faf3eb">TransferHero</text>
    <text x="157" y="116" font-family="Inter" font-size="15" font-weight="700" fill="#cdbbad">DC METRO WAYFINDING</text>
    <rect x="856" y="76" width="266" height="42" rx="21" fill="#faf3eb" fill-opacity="0.11" />
    <text x="989" y="103" text-anchor="middle" font-family="Inter" font-size="15" font-weight="800" fill="#faf3eb">${status} · ${escapeXml(formatClock(trip.timing.capturedAtMs))}</text>
    <line x1="78" y1="144" x2="1122" y2="144" stroke="#faf3eb" stroke-opacity="0.14" stroke-width="2" />

    <text x="78" y="179" font-family="Inter" font-size="14" font-weight="800" letter-spacing="1.4" fill="#cdbbad">${isLiveTracker ? 'FOLLOW THIS TRAIN LIVE' : 'SHARED TRIP'}</text>
    <text x="78" y="222" font-family="Inter" font-size="${titleSize}" font-weight="800" fill="#faf3eb">${escapeXml(title)}</text>

    <rect x="78" y="246" width="310" height="86" rx="18" fill="#2c231d" />
    <text x="104" y="277" font-family="Inter" font-size="14" font-weight="800" letter-spacing="1.2" fill="#cdbbad">${departureLabel}</text>
    <text x="104" y="316" font-family="Inter" font-size="35" font-weight="850" fill="#faf3eb">${escapeXml(formatClock(leaveAt ?? trip.timing.departureAtMs))}</text>

    <rect x="405" y="246" width="310" height="86" rx="18" fill="#faf3eb" />
    <text x="431" y="277" font-family="Inter" font-size="14" font-weight="800" letter-spacing="1.2" fill="#6b584b">ARRIVE</text>
    <text x="431" y="316" font-family="Inter" font-size="35" font-weight="850" fill="#372c24">${escapeXml(formatClock(trip.timing.arrivalAtMs))}</text>

    <rect x="732" y="246" width="180" height="86" rx="18" fill="#2c231d" stroke="#faf3eb" stroke-opacity="0.14" />
    <text x="758" y="277" font-family="Inter" font-size="14" font-weight="800" letter-spacing="1.2" fill="#cdbbad">TRIP TIME</text>
    <text x="758" y="316" font-family="Inter" font-size="35" font-weight="850" fill="#faf3eb">${Math.round(trip.durationMinutes)} <tspan font-size="18">MIN</tspan></text>

    <rect x="929" y="246" width="193" height="86" rx="18" fill="#2c231d" stroke="#faf3eb" stroke-opacity="0.14" />
    <text x="955" y="277" font-family="Inter" font-size="14" font-weight="800" letter-spacing="1.2" fill="#cdbbad">ROUTE</text>
    <text x="955" y="310" font-family="Inter" font-size="20" font-weight="800" fill="#faf3eb">${escapeXml(trip.lines.map(line => LINE_NAMES[line]).join(' → '))}</text>

    <g font-family="Inter">
      ${diagramSvg(trip)}
    </g>

    <rect x="850" y="526" width="272" height="42" rx="21" fill="#faf3eb" />
    <text x="872" y="553" font-family="Inter" font-size="15" font-weight="850" letter-spacing="0.5" fill="#372c24">${isLiveTracker ? 'OPEN LIVE TRACKER' : 'OPEN TRIP DETAILS'}</text>
    <text x="1094" y="554" text-anchor="middle" font-family="Inter" font-size="22" font-weight="800" fill="#372c24">→</text>
  </svg>`
}

export function renderShareCardPng(trip: SharedTripPayload): Buffer {
  const renderer = new Resvg(renderShareCardSvg(trip), {
    fitTo: { mode: 'width', value: 1200 },
    background: '#f2e7dc',
    font: {
      fontFiles: [SHARE_CARD_FONT_PATH],
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
      sansSerifFamily: 'Inter',
    },
  })
  return Buffer.from(renderer.render().asPng())
}
