import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Link2,
  Share2,
  X,
} from 'lucide-react'
import {
  SHARE_IMAGE_HEIGHT,
  SHARE_IMAGE_WIDTH,
  SHARE_TRIP_VERSION,
  parseSharedTripPayload,
  type Line,
  type PlaceContext,
  type SharedPlaceContext,
  type SharedTripLeg,
  type SharedTripPayload,
  type SharedTripTiming,
  type Station,
} from '@transferhero/shared'
import { createTripShareLink } from '../api/shares'
import { LINE_COLORS } from '../utils/lineColors'

const SHARE_PAYLOAD_VERSION = SHARE_TRIP_VERSION
const LINE_NAMES: Record<Line, string> = {
  RD: 'Red',
  OR: 'Orange',
  SV: 'Silver',
  BL: 'Blue',
  YL: 'Yellow',
  GR: 'Green',
}

const SHARE_BADGE_TEXT: Record<Line, string> = {
  RD: '#ffffff',
  OR: '#2c231d',
  SV: '#2c231d',
  BL: '#ffffff',
  YL: '#2c231d',
  GR: '#152019',
}

export interface TripShareData {
  origin: Station
  destination: Station
  originPlaceContext?: PlaceContext | null
  destPlaceContext?: PlaceContext | null
  lines: Line[]
  durationMinutes: number
  arrivalClock: string | null
  routeSummary: string
  transferWalkSummary: string
  walkTime: number
  accessible: boolean
  legs: SharedTripLeg[]
  timing: SharedTripTiming
  transferName: string | null
  plannedForMs?: number | null
}

export interface TripShareProps extends TripShareData {
  className?: string
}

function compactPlaceContext(context: PlaceContext): SharedPlaceContext {
  return {
    place: {
      id: context.place.id,
      name: context.place.name,
      context: context.place.context,
      lat: context.place.lat,
      lon: context.place.lon,
    },
    station: {
      code: context.station.code,
      name: context.station.name,
      lines: [...context.station.lines],
    },
    exit: {
      id: context.exit.id,
      name: context.exit.name,
      lat: context.exit.lat,
      lon: context.exit.lon,
      isAccessible: context.exit.isAccessible,
    },
    walkTimeMinutes: context.walkTimeMinutes,
    walkDistanceMeters: context.walkDistanceMeters,
    direction: context.direction,
    ...(context.busOnly == null ? {} : { busOnly: context.busOnly }),
  }
}

/** Creates the exact, versioned data stored in a shared trip URL. */
export function createTripSharePayload(data: TripShareData): SharedTripPayload {
  return {
    v: SHARE_PAYLOAD_VERSION,
    origin: {
      code: data.origin.code,
      name: data.origin.name,
      lines: [...data.origin.lines],
    },
    destination: {
      code: data.destination.code,
      name: data.destination.name,
      lines: [...data.destination.lines],
    },
    ...(data.originPlaceContext
      ? { originPlaceContext: compactPlaceContext(data.originPlaceContext) }
      : {}),
    ...(data.destPlaceContext
      ? { destPlaceContext: compactPlaceContext(data.destPlaceContext) }
      : {}),
    lines: [...data.lines],
    durationMinutes: data.durationMinutes,
    arrivalClock: data.arrivalClock,
    routeSummary: data.routeSummary,
    transferWalkSummary: data.transferWalkSummary,
    walkTime: data.walkTime,
    accessible: data.accessible,
    legs: data.legs.map((leg) => ({ ...leg })),
    timing: { ...data.timing },
    departAt: data.plannedForMs ?? null,
    transferName: data.transferName,
    // The server replaces this with the exact share-creation time before signing.
    sharedAtMs: data.timing.capturedAtMs,
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''

  // Keeping chunks small avoids exceeding the argument limit on long place names.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Builds a reloadable URL without adding timestamps or other nondeterministic data. */
export function buildTripShareUrl(
  payload: SharedTripPayload,
  baseUrl = typeof window === 'undefined'
    ? 'https://transferhero.app/'
    : window.location.href
): string {
  const url = new URL(baseUrl, 'https://transferhero.app/')
  url.hash = ''
  // A shared trip should never carry unrelated search parameters from the sender's URL.
  url.search = ''
  url.searchParams.set('trip', encodeBase64Url(JSON.stringify(payload)))
  return url.toString()
}

/** Safely decodes and validates an individual `trip` query parameter. */
export function decodeTripShareParam(encoded: string): SharedTripPayload | null {
  try {
    const value: unknown = JSON.parse(decodeBase64Url(encoded))
    return parseSharedTripPayload(value)
  } catch {
    return null
  }
}

/** Parses either a full URL, a query string, or URLSearchParams. */
export function parseTripShareUrl(
  input: string | URLSearchParams = typeof window === 'undefined'
    ? ''
    : window.location.search
): SharedTripPayload | null {
  let encoded: string | null = null

  if (input instanceof URLSearchParams) {
    encoded = input.get('trip')
  } else {
    try {
      encoded = /^https?:\/\//i.test(input)
        ? new URL(input).searchParams.get('trip')
        : new URLSearchParams(input.startsWith('?') ? input.slice(1) : input).get('trip')
    } catch {
      return null
    }
  }

  return encoded ? decodeTripShareParam(encoded) : null
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(x + r, y)
  context.lineTo(x + width - r, y)
  context.quadraticCurveTo(x + width, y, x + width, y + r)
  context.lineTo(x + width, y + height - r)
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  context.lineTo(x + r, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - r)
  context.lineTo(x, y + r)
  context.quadraticCurveTo(x, y, x + r, y)
  context.closePath()
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string
) {
  roundedRectPath(context, x, y, width, height, radius)
  context.fillStyle = color
  context.fill()
}

interface FittedTextOptions {
  color: string
  fontSize: number
  minFontSize?: number
  fontWeight?: number
  align?: CanvasTextAlign
}

function drawFittedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  options: FittedTextOptions
) {
  const minFontSize = options.minFontSize ?? Math.min(20, options.fontSize)
  const fontWeight = options.fontWeight ?? 700
  let fontSize = options.fontSize

  context.textAlign = options.align ?? 'left'
  context.textBaseline = 'alphabetic'
  context.fillStyle = options.color
  context.font = `${fontWeight} ${fontSize}px Arial, Helvetica, sans-serif`

  while (fontSize > minFontSize && context.measureText(text).width > maxWidth) {
    fontSize -= 1
    context.font = `${fontWeight} ${fontSize}px Arial, Helvetica, sans-serif`
  }

  let output = text
  if (context.measureText(output).width > maxWidth) {
    while (output.length > 1 && context.measureText(`${output}…`).width > maxWidth) {
      output = output.slice(0, -1)
    }
    output = `${output.trimEnd()}…`
  }

  context.fillText(output, x, y)
}

function drawLabel(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = 'rgba(250, 243, 235, 0.66)'
) {
  context.fillStyle = color
  context.font = '800 16px Arial, Helvetica, sans-serif'
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  context.fillText(text.toUpperCase(), x, y)
}

function formatMinutes(minutes: number): string {
  if (Number.isInteger(minutes)) return String(minutes)
  return minutes.toFixed(1).replace(/\.0$/, '')
}

function formatEasternClock(timestamp: number | null): string {
  if (timestamp == null) return 'Open trip'
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(new Date(timestamp))
}

function getEndpointLabel(station: Station, context?: SharedPlaceContext): string {
  return context?.place.name ?? station.name
}

function drawLineBadges(
  context: CanvasRenderingContext2D,
  lines: Line[],
  x: number,
  y: number
) {
  let cursor = x
  context.font = '800 15px Arial, Helvetica, sans-serif'
  for (const line of lines) {
    const width = Math.max(78, context.measureText(LINE_NAMES[line]).width + 55)
    fillRoundedRect(context, cursor, y, width, 36, 18, LINE_COLORS[line].bg)
    context.fillStyle = SHARE_BADGE_TEXT[line]
    context.font = '800 15px Arial, Helvetica, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(LINE_NAMES[line], cursor + width / 2, y + 18)
    cursor += width + 10
  }
}

/** Draws the image preview from supplied pathfinding/live values only. */
export function drawTripShareImage(
  canvas: HTMLCanvasElement,
  payload: SharedTripPayload
) {
  canvas.width = SHARE_IMAGE_WIDTH
  canvas.height = SHARE_IMAGE_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) return

  const cream = '#f2e7dc'
  const paper = '#faf3eb'
  const sign = '#372c24'
  const signDeep = '#2c231d'
  const softCream = 'rgba(250, 243, 235, 0.66)'
  const originLabel = getEndpointLabel(payload.origin, payload.originPlaceContext)
  const destinationLabel = getEndpointLabel(payload.destination, payload.destPlaceContext)
  const firstLeg = payload.legs[0]
  const finalLeg = payload.legs.at(-1)
  const originWalk = payload.originPlaceContext?.walkTimeMinutes
    ?? (firstLeg?.kind === 'walk' ? firstLeg.minutes : 0)
  const destinationWalk = payload.destPlaceContext?.walkTimeMinutes
    ?? (finalLeg?.kind === 'walk' ? finalLeg.minutes : 0)
  const firstLine = payload.lines[0]
  const finalLine = payload.lines.at(-1) ?? firstLine
  const transferLeg = payload.legs.find(leg => leg.kind === 'transfer')
  const hasTransfer = payload.lines.length > 1 && payload.transferName != null
  const leaveAtMs = payload.timing.departureAtMs == null
    ? null
    : payload.timing.departureAtMs - originWalk * 60_000
  const statusLabel = payload.timing.source === 'live'
    ? 'LIVE SNAPSHOT'
    : payload.timing.source === 'mixed'
      ? 'LIVE + SCHEDULED'
      : 'SCHEDULED'

  context.clearRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)
  context.fillStyle = cream
  context.fillRect(0, 0, SHARE_IMAGE_WIDTH, SHARE_IMAGE_HEIGHT)

  // A fixed signage-grid texture gives depth without introducing random pixels.
  context.strokeStyle = 'rgba(55, 44, 36, 0.045)'
  context.lineWidth = 2
  for (let x = -180; x < SHARE_IMAGE_WIDTH + 180; x += 68) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x + 250, SHARE_IMAGE_HEIGHT)
    context.stroke()
  }

  context.save()
  context.shadowColor = 'rgba(55, 44, 36, 0.24)'
  context.shadowBlur = 32
  context.shadowOffsetY = 14
  fillRoundedRect(context, 42, 40, 1116, 548, 32, sign)
  context.restore()

  fillRoundedRect(context, 78, 68, 58, 58, 12, paper)
  context.fillStyle = sign
  context.font = '900 39px Arial, Helvetica, sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('T', 107, 98)

  context.fillStyle = paper
  context.font = '800 29px Arial, Helvetica, sans-serif'
  context.textAlign = 'left'
  context.fillText('TransferHero', 156, 91)
  context.fillStyle = softCream
  context.font = '700 15px Arial, Helvetica, sans-serif'
  context.fillText('DC METRO WAYFINDING', 157, 116)

  const scheduleLabel = `${statusLabel} · ${formatEasternClock(payload.timing.capturedAtMs)}`
  const scheduleWidth = Math.min(370, Math.max(126, context.measureText(scheduleLabel).width + 42))
  fillRoundedRect(context, 1118 - scheduleWidth, 78, scheduleWidth, 38, 19, 'rgba(250, 243, 235, 0.11)')
  drawFittedText(
    context,
    scheduleLabel,
    1118 - scheduleWidth / 2,
    103,
    scheduleWidth - 28,
    { color: paper, fontSize: 15, minFontSize: 12, fontWeight: 800, align: 'center' }
  )

  context.strokeStyle = 'rgba(250, 243, 235, 0.14)'
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(78, 144)
  context.lineTo(1122, 144)
  context.stroke()

  drawLabel(context, 'Shared trip', 78, 179)
  drawFittedText(context, `${originLabel} → ${destinationLabel}`, 78, 222, 1044, {
    color: paper,
    fontSize: 39,
    minFontSize: 27,
    fontWeight: 800,
  })

  const timingCards = [
    { x: 78, width: 310, label: originWalk > 0 ? 'Leave' : 'Train', value: formatEasternClock(leaveAtMs ?? payload.timing.departureAtMs), paper: false },
    { x: 405, width: 310, label: 'Arrive', value: formatEasternClock(payload.timing.arrivalAtMs), paper: true },
    { x: 732, width: 180, label: 'Trip time', value: `${Math.round(payload.durationMinutes)} min`, paper: false },
    { x: 929, width: 193, label: 'Route', value: payload.lines.map(line => LINE_NAMES[line]).join(' → '), paper: false },
  ]
  for (const card of timingCards) {
    fillRoundedRect(context, card.x, 246, card.width, 86, 18, card.paper ? paper : signDeep)
    drawLabel(context, card.label, card.x + 26, 277, card.paper ? 'rgba(55, 44, 36, 0.58)' : softCream)
    drawFittedText(context, card.value, card.x + 26, 316, card.width - 52, {
      color: card.paper ? sign : paper,
      fontSize: 35,
      minFontSize: 19,
      fontWeight: 850,
    })
  }

  const diagramY = 421
  const originStationX = originWalk > 0 ? 224 : 150
  const destinationStationX = destinationWalk > 0 ? 976 : 1050
  const transferX = 600
  context.lineCap = 'round'

  if (originWalk > 0) {
    context.setLineDash([4, 15])
    context.strokeStyle = '#c6b5a6'
    context.lineWidth = 8
    context.beginPath()
    context.moveTo(112, diagramY)
    context.lineTo(originStationX, diagramY)
    context.stroke()
    context.setLineDash([])
    context.fillStyle = paper
    context.beginPath()
    context.arc(112, diagramY, 11, 0, Math.PI * 2)
    context.fill()
    drawFittedText(context, `${Math.round(originWalk)} min walk`, 112, 502, 128, {
      color: '#cdbbad', fontSize: 14, minFontSize: 11, fontWeight: 700, align: 'center',
    })
  }

  if (hasTransfer) {
    context.strokeStyle = LINE_COLORS[firstLine].bg
    context.lineWidth = 15
    context.beginPath()
    context.moveTo(originStationX, diagramY)
    context.lineTo(transferX - 12, diagramY)
    context.stroke()
    context.strokeStyle = LINE_COLORS[finalLine].bg
    context.beginPath()
    context.moveTo(transferX + 12, diagramY)
    context.lineTo(destinationStationX, diagramY)
    context.stroke()
    drawLineBadges(context, [firstLine], originStationX + 30, 361)
    drawLineBadges(context, [finalLine], destinationStationX - 122, 361)
    context.fillStyle = signDeep
    context.strokeStyle = paper
    context.lineWidth = 7
    context.beginPath()
    context.arc(transferX, diagramY, 18, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    context.fillStyle = paper
    context.beginPath()
    context.arc(transferX, diagramY, 6, 0, Math.PI * 2)
    context.fill()
    drawFittedText(context, payload.transferName ?? 'Transfer', transferX, 477, 260, {
      color: paper, fontSize: 18, minFontSize: 13, fontWeight: 800, align: 'center',
    })
    drawFittedText(context, `${Math.round(transferLeg?.minutes ?? payload.walkTime)} min transfer`, transferX, 502, 190, {
      color: '#cdbbad', fontSize: 14, minFontSize: 11, fontWeight: 700, align: 'center',
    })
  } else {
    context.strokeStyle = LINE_COLORS[firstLine].bg
    context.lineWidth = 15
    context.beginPath()
    context.moveTo(originStationX, diagramY)
    context.lineTo(destinationStationX, diagramY)
    context.stroke()
    drawLineBadges(context, [firstLine], (originStationX + destinationStationX) / 2 - 46, 361)
  }

  if (destinationWalk > 0) {
    context.setLineDash([4, 15])
    context.strokeStyle = '#c6b5a6'
    context.lineWidth = 8
    context.beginPath()
    context.moveTo(destinationStationX, diagramY)
    context.lineTo(1088, diagramY)
    context.stroke()
    context.setLineDash([])
    context.fillStyle = paper
    context.beginPath()
    context.arc(1088, diagramY, 11, 0, Math.PI * 2)
    context.fill()
    drawFittedText(context, `${Math.round(destinationWalk)} min walk`, 1088, 502, 128, {
      color: '#cdbbad', fontSize: 14, minFontSize: 11, fontWeight: 700, align: 'center',
    })
  }

  for (const [x, stationName] of [
    [originStationX, payload.origin.name],
    [destinationStationX, payload.destination.name],
  ] as const) {
    context.fillStyle = paper
    context.strokeStyle = signDeep
    context.lineWidth = 4
    context.beginPath()
    context.arc(x, diagramY, 13, 0, Math.PI * 2)
    context.fill()
    context.stroke()
    drawFittedText(context, stationName, x, 477, hasTransfer ? 260 : 280, {
      color: paper, fontSize: 18, minFontSize: 13, fontWeight: 800, align: 'center',
    })
  }

  fillRoundedRect(context, 850, 526, 272, 42, 21, paper)
  drawFittedText(context, 'OPEN TRIP DETAILS', 872, 553, 188, {
    color: sign,
    fontSize: 15,
    minFontSize: 13,
    fontWeight: 850,
  })
  drawFittedText(context, '→', 1094, 554, 28, {
    color: sign,
    fontSize: 22,
    minFontSize: 18,
    fontWeight: 800,
    align: 'center',
  })
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Clipboard access can be blocked on non-secure local origins; use the DOM fallback.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('Clipboard copy was not available')
}

const TRIP_SHARE_STYLES = `
  .trip-share { display: inline-flex; }
  .trip-share * { box-sizing: border-box; }
  .trip-share-trigger,
  .trip-share-action,
  .trip-share-close {
    appearance: none;
    border: 0;
    font: inherit;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .trip-share-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    gap: 8px;
    padding: 0 15px;
    border: 1.5px solid rgba(55, 44, 36, 0.46);
    border-radius: 10px;
    background: var(--beta-paper, #faf3eb);
    color: var(--beta-ink, #372c24);
    font-size: 13px;
    font-weight: 750;
    transition: background 150ms ease, color 150ms ease, transform 150ms ease;
  }
  .trip-share-trigger:hover {
    background: var(--beta-sign, #372c24);
    color: #fff;
    transform: translateY(-1px);
  }
  .trip-share-trigger svg,
  .trip-share-action svg,
  .trip-share-close svg { width: 18px; height: 18px; flex: none; }
  .trip-share-trigger:focus-visible,
  .trip-share-action:focus-visible,
  .trip-share-close:focus-visible {
    outline: 3px solid #0076c0;
    outline-offset: 3px;
  }
  .trip-share-dialog {
    width: min(700px, calc(100% - 24px));
    max-width: none;
    max-height: calc(100dvh - 24px);
    padding: 0;
    border: 0;
    border-radius: 20px;
    background: transparent;
    color: #372c24;
    overflow: auto;
    box-shadow: 0 24px 70px rgba(23, 17, 13, 0.34);
  }
  .trip-share-dialog::backdrop {
    background: rgba(23, 17, 13, 0.68);
    backdrop-filter: blur(4px);
  }
  .trip-share-panel {
    padding: 22px;
    border: 1px solid rgba(55, 44, 36, 0.18);
    border-radius: 20px;
    background: #f2e7dc;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  }
  .trip-share-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 16px;
  }
  .trip-share-eyebrow {
    display: block;
    margin-bottom: 5px;
    color: #6b584b;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }
  .trip-share-header h2 {
    margin: 0;
    color: #372c24;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.025em;
    line-height: 1.15;
  }
  .trip-share-header p {
    margin: 7px 0 0;
    color: #6b584b;
    font-size: 13px;
    font-weight: 550;
    line-height: 1.4;
  }
  .trip-share-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: 1.5px solid rgba(55, 44, 36, 0.35);
    border-radius: 10px;
    background: #faf3eb;
    color: #372c24;
    flex: none;
  }
  .trip-share-preview-shell {
    padding: 8px;
    border: 1px solid rgba(55, 44, 36, 0.2);
    border-radius: 15px;
    background: #faf3eb;
    box-shadow: 0 4px 16px rgba(55, 44, 36, 0.11);
  }
  .trip-share-preview {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1200 / 630;
    border-radius: 10px;
    background: #372c24;
  }
  .trip-share-actions {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    margin-top: 14px;
  }
  .trip-share-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    gap: 9px;
    padding: 0 15px;
    border: 1.5px solid rgba(55, 44, 36, 0.38);
    border-radius: 10px;
    background: #faf3eb;
    color: #372c24;
    font-size: 13px;
    font-weight: 800;
  }
  .trip-share-action.is-primary {
    border-color: #372c24;
    background: #372c24;
    color: #fff;
  }
  .trip-share-action:hover { transform: translateY(-1px); }
  .trip-share-action:disabled { cursor: wait; opacity: 0.55; transform: none; }
  .trip-share-status {
    min-height: 18px;
    margin: 9px 2px -5px;
    color: #6b584b;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
  }
  .trip-share-privacy {
    margin: 10px 2px 0;
    color: #6b584b;
    font-size: 11px;
    font-weight: 650;
    line-height: 1.4;
    text-align: center;
  }
  .trip-share-canvas { display: none; }
  @media (max-width: 520px) {
    .trip-share-panel { padding: 16px; }
    .trip-share-header h2 { font-size: 19px; }
    .trip-share-header p { font-size: 12px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .trip-share-trigger,
    .trip-share-action { transition: none; }
  }
`

export function TripShare({
  origin,
  destination,
  originPlaceContext,
  destPlaceContext,
  lines,
  durationMinutes,
  arrivalClock,
  routeSummary,
  transferWalkSummary,
  walkTime,
  accessible,
  transferName,
  legs,
  timing,
  plannedForMs,
  className,
}: TripShareProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [previewDataUrl, setPreviewDataUrl] = useState('')
  const [status, setStatus] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [isCreatingLink, setIsCreatingLink] = useState(false)
  const shareRequestRef = useRef<Promise<string> | null>(null)

  const payload = useMemo(() => createTripSharePayload({
    origin,
    destination,
    originPlaceContext,
    destPlaceContext,
    lines,
    durationMinutes,
    arrivalClock,
    routeSummary,
    transferWalkSummary,
    walkTime,
    accessible,
    transferName,
    legs,
    timing,
    plannedForMs,
  }), [
    origin,
    destination,
    originPlaceContext,
    destPlaceContext,
    lines,
    durationMinutes,
    arrivalClock,
    routeSummary,
    transferWalkSummary,
    walkTime,
    accessible,
    transferName,
    legs,
    timing,
    plannedForMs,
  ])

  const originLabel = getEndpointLabel(payload.origin, payload.originPlaceContext)
  const destinationLabel = getEndpointLabel(payload.destination, payload.destPlaceContext)
  const previewStatus = payload.timing.source === 'live'
    ? 'live snapshot'
    : payload.timing.source === 'mixed'
      ? 'live and scheduled snapshot'
      : 'scheduled snapshot'
  const previewAlt = `TransferHero trip diagram from ${originLabel} to ${destinationLabel}, ${formatMinutes(durationMinutes)} minutes via ${routeSummary}${arrivalClock ? `, arriving ${arrivalClock}` : ''}; ${previewStatus} as of ${formatEasternClock(payload.timing.capturedAtMs)}.`

  useEffect(() => {
    shareRequestRef.current = null
    setShareUrl('')
  }, [payload])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    drawTripShareImage(canvas, payload)
    setPreviewDataUrl(canvas.toDataURL('image/png'))
  }, [payload])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen && !dialog.open) dialog.showModal()
    if (!isOpen && dialog.open) dialog.close()
  }, [isOpen])

  useEffect(() => {
    if (!status) return
    const timeout = window.setTimeout(() => setStatus(''), 3000)
    return () => window.clearTimeout(timeout)
  }, [status])

  const closeDialog = () => {
    setIsOpen(false)
    setStatus('')
  }

  const ensureShareUrl = async (): Promise<string> => {
    if (shareUrl) return shareUrl
    if (!shareRequestRef.current) {
      setIsCreatingLink(true)
      shareRequestRef.current = createTripShareLink(payload)
        .then((result) => {
          setShareUrl(result.url)
          return result.url
        })
        .finally(() => setIsCreatingLink(false))
    }
    try {
      return await shareRequestRef.current
    } catch (error) {
      shareRequestRef.current = null
      throw error
    }
  }

  const handleCopyLink = async () => {
    try {
      setStatus('Preparing the messaging preview…')
      const url = await ensureShareUrl()
      await copyText(url)
      setStatus('Link copied — its trip card will preview in messages.')
    } catch {
      setStatus('Could not create the preview link. Please try again.')
    }
  }

  return (
    <div className={`trip-share${className ? ` ${className}` : ''}`}>
      <style>{TRIP_SHARE_STYLES}</style>
      <button
        type="button"
        className="trip-share-trigger"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
      >
        <Share2 aria-hidden="true" />
        Share trip
      </button>

      <dialog
        ref={dialogRef}
        className="trip-share-dialog"
        aria-labelledby="trip-share-title"
        aria-describedby="trip-share-description"
        onCancel={() => setIsOpen(false)}
        onClose={() => setIsOpen(false)}
        onClick={(event) => {
          if (event.currentTarget === event.target) closeDialog()
        }}
      >
        <div className="trip-share-panel">
          <header className="trip-share-header">
            <div>
              <span className="trip-share-eyebrow">Ready to send</span>
              <h2 id="trip-share-title">Share this trip</h2>
              <p id="trip-share-description">
                Copy a live trip link with a message-sized preview.
              </p>
            </div>
            <button
              type="button"
              className="trip-share-close"
              onClick={closeDialog}
              aria-label="Close trip sharing"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div className="trip-share-preview-shell">
            {previewDataUrl && (
              <img
                className="trip-share-preview"
                src={previewDataUrl}
                alt={previewAlt}
              />
            )}
          </div>

          <div className="trip-share-actions">
            <button
              type="button"
              className="trip-share-action is-primary"
              onClick={handleCopyLink}
              disabled={isCreatingLink}
            >
              {status.startsWith('Link copied')
                ? <Check aria-hidden="true" />
                : <Link2 aria-hidden="true" />}
              {isCreatingLink ? 'Preparing…' : 'Copy link'}
            </button>
          </div>
          {(originPlaceContext || destPlaceContext) && (
            <p className="trip-share-privacy">
              Anyone with this link can see the trip endpoints.
            </p>
          )}
          <p className="trip-share-status" role="status" aria-live="polite">{status}</p>
        </div>
      </dialog>

      <canvas
        ref={canvasRef}
        className="trip-share-canvas"
        width={SHARE_IMAGE_WIDTH}
        height={SHARE_IMAGE_HEIGHT}
        aria-hidden="true"
      />
    </div>
  )
}

export default TripShare
