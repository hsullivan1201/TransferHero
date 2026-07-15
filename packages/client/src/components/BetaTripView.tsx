import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Footprints,
  RefreshCw,
  Rss,
  Satellite,
  TrainFront,
} from 'lucide-react'
import type {
  CarPosition,
  CatchableTrain,
  DoorRecommendation,
  ExitOption,
  Line,
  PlaceContext,
  Station,
  Train,
  TransferResult,
} from '@transferhero/shared'
import { LINE_COLORS } from '../utils/lineColors'
import { getDisplayName } from '../utils/displayNames'
import {
  computeTotalMinutes,
  deriveWaitMinutes,
  getTrainMinutes,
  resolveArrivalClock,
} from '../utils/time'
import { buildMapsUrl, formatDistance } from '../utils/geo'
import { resolveExitLabel } from '../data/exitMapping'
import { useNow } from '../hooks/useNow'
import { PlatformEgressIcon } from './PlatformEgressIcon'
import { UpdatedAgo } from './UpdatedAgo'

type WalkingAlt = NonNullable<PlaceContext['alternatives']>[number]

const LINE_NAMES: Record<Line, string> = {
  RD: 'Red',
  OR: 'Orange',
  SV: 'Silver',
  BL: 'Blue',
  YL: 'Yellow',
  GR: 'Green',
}

const LINE_LETTERS: Record<Line, string> = {
  RD: 'R',
  OR: 'O',
  SV: 'S',
  BL: 'B',
  YL: 'Y',
  GR: 'G',
}

const LINE_DISC_ORDER: Line[] = ['RD', 'YL', 'GR', 'OR', 'SV', 'BL']

interface BetaTripViewProps {
  origin: Station
  destination: Station
  transfer: TransferResult | null
  leg1Trains: Train[]
  leg2Trains: Train[]
  leg1CarPosition: CarPosition | null
  leg1LineCarPositions?: Partial<Record<Line, CarPosition>>
  leg2CarPosition: CarPosition | null
  leg1Stops: Station[]
  leg1StopsBeyond: Station[]
  leg1LineStops?: Partial<Record<Line, Station[]>>
  leg1LineStopsBeyond?: Partial<Record<Line, Station[]>>
  leg2Stops: Station[]
  leg2StopsBeyond: Station[]
  /** canonical per-line termini for signage — falls back to headsigns when absent */
  leg1DirectionLabels?: Partial<Record<Line, string>>
  leg2DirectionLabels?: Partial<Record<Line, string>>
  leg1Time: number
  leg2Time: number
  walkTime: number
  onSelectLeg1Train: (train: Train, index: number) => void
  onClearLeg1Selection: () => void
  selectedLeg1Train: Train | null
  departureTimestamp: number | null
  onRefresh: () => void
  isRefreshing: boolean
  fetchedAt?: string
  scheduledLabel?: string
  /** epoch ms of the planned departure for schedule-only trips; anchors durations */
  plannedForMs?: number | null
  isLoadingLeg2: boolean
  isDirect: boolean
  showDeparted: boolean
  onToggleShowDeparted: () => void
  accessible: boolean
  originPlaceContext: PlaceContext | null
  destPlaceContext: PlaceContext | null
  onSelectOriginWalkingAlt: (alt: WalkingAlt) => void
  onSelectDestWalkingAlt: (alt: WalkingAlt) => void
  embedded?: boolean
  stepOffset?: number
  overviewTitle?: string
  selectedLeg2Train?: Train | null
  onSelectLeg2Train?: (train: Train, index: number) => void
  onClearLeg2Selection?: () => void
  preferredLeg1Train?: Train | null
}

function isCatchable(train: Train | CatchableTrain): train is CatchableTrain {
  return '_waitTime' in train
}

function sameTrain(
  a: Train | null | undefined,
  b: Train | null | undefined,
  departureTimestamp?: number | null,
  now = Date.now()
): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a._tripId && b._tripId) return a._tripId === b._tripId
  if (a.TrainId != null && b.TrainId != null) return String(a.TrainId) === String(b.TrainId)
  if (a.TrainNumber != null && b.TrainNumber != null) return String(a.TrainNumber) === String(b.TrainNumber)
  if (a.Line !== b.Line || a.DestinationName !== b.DestinationName) return false

  // WMATA rows do not always carry a stable ID. Match their predicted absolute
  // departure instead of mutable `Min`, which changes on every poll.
  if (departureTimestamp) {
    const minutes = getTrainMinutes(a.Min)
    if (Number.isFinite(minutes)) {
      const predictedDeparture = now + minutes * 60_000
      return Math.abs(predictedDeparture - departureTimestamp) <= 180_000
    }
  }

  return a.Min === b.Min
}

function isDeparted(train: Train): boolean {
  const minutes = getTrainMinutes(train.Min)
  return train._departed === true || (Number.isFinite(minutes) && minutes < 0)
}

function getDirectRideMinutes(train: Train | null | undefined): number | null {
  if (!train || train._destArrivalMin == null) return null
  const departure = getTrainMinutes(train.Min)
  if (!Number.isFinite(departure)) return null
  return Math.max(0, Math.round(train._destArrivalMin - departure))
}

function getRemainingRideMinutes(
  train: Train | null | undefined,
  isDirect: boolean,
  fallback: number,
  now: number
): number {
  if (!train) return fallback
  const timestamp = isDirect ? train._destArrivalTimestamp : train._transferArrivalTimestamp
  if (timestamp) return Math.max(0, Math.round((timestamp - now) / 60_000))

  const minutes = isDirect ? train._destArrivalMin : train._transferArrivalMin
  return minutes != null && Number.isFinite(minutes)
    ? Math.max(0, Math.round(minutes))
    : fallback
}

const DOOR_LABELS: Record<1 | 2 | 3, string> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
}

function resolveDisplayDoor(
  requestedCar: number,
  recommendation: DoorRecommendation | undefined,
  carCount: number
): { car: number; door: 1 | 2 | 3; exact: boolean } {
  const referenceCar = Math.max(1, Math.min(8, recommendation?.car ?? requestedCar))
  if (referenceCar > carCount) {
    return { car: carCount, door: 3, exact: !!recommendation }
  }
  return {
    car: referenceCar,
    door: recommendation?.door ?? 2,
    exact: !!recommendation,
  }
}

type EgressType = ExitOption['type']

interface BoardingMarker {
  trainXPosition: number
  type: EgressType
  label: string
  primary: boolean
  row: 0 | 1 | 2
  labelXPosition: number
}

interface PrimaryBoardingMarker {
  trainXPosition?: number
  type?: EgressType
  label: string
}

function exitGroupLetter(exitLabel: number | undefined): string | null {
  if (!exitLabel || exitLabel < 1 || exitLabel > 26) return null
  return String.fromCharCode(64 + exitLabel)
}

function diagramPositionStyle(trainXPosition: number, carCount: number): CSSProperties {
  const gap = 4
  const maxX = carCount * 9
  const clampedX = Math.max(0, Math.min(maxX, trainXPosition))
  const rawCar = Math.floor(clampedX / 9)
  const carIndex = Math.min(carCount - 1, rawCar)
  const withinCar = Math.max(0, Math.min(1, (clampedX - carIndex * 9) / 9))
  const gridUnits = carIndex + withinCar
  const percent = (gridUnits / carCount) * 100
  const gapOffset = gap * (carIndex - (gridUnits * (carCount - 1)) / carCount)
  return { left: `calc(${percent}% + ${gapOffset}px)` }
}

function buildBoardingMarkers(
  carPosition: CarPosition,
  primary: PrimaryBoardingMarker | undefined
): BoardingMarker[] {
  if (!primary || !Number.isFinite(primary.trainXPosition)) return []

  const markers: Omit<BoardingMarker, 'row' | 'labelXPosition'>[] = [{
    trainXPosition: primary.trainXPosition!,
    type: primary.type ?? 'exit',
    label: primary.label,
    primary: true,
  }]
  const seenExitGroups = new Set<number>()
  const seenPositions = new Set<string>()

  // every distinct egress goes on the strip — riders should see all their options
  for (const marker of carPosition.platformMarkers ?? []) {
    if (/line|platform/i.test(marker.description ?? '')) continue
    if (!Number.isFinite(marker.trainXPosition)) continue
    // skip only what is effectively the primary's own egress
    if (Math.abs(marker.trainXPosition! - primary.trainXPosition!) < 3) continue

    if (marker.exitLabel != null) {
      if (seenExitGroups.has(marker.exitLabel)) continue
      seenExitGroups.add(marker.exitLabel)
    } else {
      const positionKey = `${Math.round(marker.trainXPosition! / 3)}:${marker.type}`
      if (seenPositions.has(positionKey)) continue
      seenPositions.add(positionKey)
    }

    const letter = exitGroupLetter(marker.exitLabel)
    markers.push({
      trainXPosition: marker.trainXPosition!,
      type: marker.type,
      label: marker.description ?? marker.label ?? (letter ? `Exit ${letter}` : marker.type),
      primary: false,
    })
  }

  const sorted = [...markers].sort((a, b) => a.trainXPosition - b.trainXPosition)

  // nudge markers that sit on top of each other so bubbles stay legible —
  // 6 units clears the (responsively shrunk) bubbles down to phone widths
  const MIN_MARKER_GAP = 6
  for (let index = 1; index < sorted.length; index++) {
    const gap = sorted[index].trainXPosition - sorted[index - 1].trainXPosition
    if (gap < MIN_MARKER_GAP) {
      sorted[index] = {
        ...sorted[index],
        trainXPosition: Math.min(72, sorted[index - 1].trainXPosition + MIN_MARKER_GAP),
      }
    }
  }

  const rowEnds = [-Infinity, -Infinity, -Infinity]
  return sorted.map((marker) => {
    const estimatedWidth = Math.min(Math.max(8, marker.label.length * 0.72), 33)
    const halfWidth = estimatedWidth / 2
    const labelXPosition = Math.max(halfWidth, Math.min(72 - halfWidth, marker.trainXPosition))
    const start = labelXPosition - halfWidth
    const openRow = rowEnds.findIndex((end) => start > end + 1)
    const row = (openRow === -1 ? rowEnds.length - 1 : openRow) as 0 | 1 | 2
    rowEnds[row] = labelXPosition + halfWidth
    return { ...marker, row, labelXPosition }
  })
}

function getReportedCarCount(train: Train | null | undefined): number | null {
  if (!train) return null
  const parsed = Number.parseInt(train.Car, 10)
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 8 ? parsed : null
}

function getPositionForEightCar(car: number): 'front' | 'middle' | 'back' {
  if (car <= 2) return 'front'
  if (car <= 6) return 'middle'
  return 'back'
}

function LineDisc({ line, small = false }: { line: Line; small?: boolean }) {
  // 2026 rail discs: dark fields (R, G, B) carry white letters; light fields
  // (Y, O, S) carry black — per-disc contrast, fixed per line systemwide.
  const darkInk = line === 'YL' || line === 'OR' || line === 'SV'
  return (
    <span
      className={`beta-line-disc ${small ? 'beta-line-disc--small' : ''}`}
      style={{ backgroundColor: LINE_COLORS[line].bg, color: darkInk ? '#17110d' : '#fff' }}
      title={`${LINE_NAMES[line]} Line`}
      aria-label={`${LINE_NAMES[line]} Line`}
    >
      {LINE_LETTERS[line]}
    </span>
  )
}

function LineDiscs({ lines, small = false }: { lines: Line[]; small?: boolean }) {
  const unique = [...new Set(lines)].sort((a, b) => LINE_DISC_ORDER.indexOf(a) - LINE_DISC_ORDER.indexOf(b))
  return (
    <span className="beta-line-discs">
      {unique.map((line) => <LineDisc key={line} line={line} small={small} />)}
    </span>
  )
}

interface PylonRow {
  station: Station
  beyond: boolean
  isDestination: boolean
  isOrigin: boolean
}

function LegPylon({
  line,
  directionLabel,
  rows,
  rideMinutes,
  destinationNote,
}: {
  line: Line | undefined
  directionLabel: string
  rows: PylonRow[]
  rideMinutes: number
  destinationNote?: string
}) {
  // collapsed by default on phones — the header row doubles as a compact
  // summary (line · direction · stops · ride) without the intermediate stops
  const [expanded, setExpanded] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia('(max-width: 650px)').matches
  )
  const stopCount = Math.max(0, rows.filter((row) => !row.beyond).length - 1)

  return (
    <div
      className={`beta-sign beta-pylon ${expanded ? '' : 'is-collapsed'}`}
      style={{ '--line-color': line ? LINE_COLORS[line].bg : '#fff' } as CSSProperties}
    >
      <button
        type="button"
        className="beta-pylon-header"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="beta-pylon-service">
          {line && <LineDisc line={line} />}
          <span>
            <strong>{line ? `${LINE_NAMES[line]} Line` : 'Metro'}</strong>
            <small>Toward {directionLabel}</small>
          </span>
        </span>
        <span className="beta-pylon-meta">
          {stopCount} {stopCount === 1 ? 'stop' : 'stops'}{rideMinutes > 0 ? ` · ${rideMinutes} min` : ''}
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </span>
      </button>
      {expanded && (
        <div className="beta-pylon-route">
          {rows.map(({ station, beyond, isDestination, isOrigin }, index) => (
            <div
              key={`${station.code}-${index}`}
              className={`beta-pylon-stop ${beyond ? 'is-beyond' : ''} ${isDestination ? 'is-destination' : ''} ${isOrigin ? 'is-origin' : ''}`}
            >
              <span className="beta-pylon-track" aria-hidden="true" />
              <span className="beta-pylon-stop-copy">
                {isDestination ? <strong>{station.name}</strong> : <span>{station.name}</span>}
                {isDestination && destinationNote && <small>{destinationNote}</small>}
                {isOrigin && <small>You are here</small>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function BetaStep({ number, title, children, trailing }: {
  number: number
  title: string
  children: ReactNode
  trailing?: ReactNode
}) {
  return (
    <section className="beta-step">
      <div className="beta-step-caption">
        <span className="beta-step-number">{number}</span>
        <span>{title}</span>
        {trailing && <span className="beta-step-trailing">{trailing}</span>}
      </div>
      {children}
    </section>
  )
}

function TrainTime({ train, clockMode = false }: { train: Train; clockMode?: boolean }) {
  const minutes = getTrainMinutes(train.Min)

  // schedule-planned trips read better as timetable clock times than "509 min"
  if (clockMode && Number.isFinite(minutes) && minutes >= 0 && train.Min !== 'ARR' && train.Min !== 'BRD') {
    const clock = new Date(Date.now() + minutes * 60_000)
      .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return <span className="beta-min-box is-clock">{clock}</span>
  }

  const display = train.Min === 'ARR' || train.Min === 'BRD'
    ? train.Min
    : Number.isFinite(minutes) && minutes < 0
      ? `${Math.abs(minutes)} ago`
      : `${train.Min}`

  return (
    <span className="beta-min-box">
      {display}
      {train.Min !== 'ARR' && train.Min !== 'BRD' && Number.isFinite(minutes) && minutes >= 0 && <small>min</small>}
    </span>
  )
}

function TrainRow({
  train,
  selected = false,
  connection = false,
  connectionWait,
  bestConnection = false,
  clockMode = false,
  onClick,
}: {
  train: Train | CatchableTrain
  selected?: boolean
  connection?: boolean
  connectionWait?: number | null
  bestConnection?: boolean
  clockMode?: boolean
  onClick?: () => void
}) {
  const departed = isDeparted(train)
  const destination = getDisplayName(train.DestinationName)
  const reportedCarCount = getReportedCarCount(train)
  const carDetail = reportedCarCount
    ? `${reportedCarCount}-car train`
    : 'train length unavailable'
  // data-source helper chip, styled after the wayfinding guide's helper blocks
  const source = train._gtfs
    ? { Icon: Satellite, label: 'GTFS', title: 'Tracked via GTFS realtime' }
    : train._scheduled
      ? { Icon: CalendarClock, label: 'Sched', title: 'From the timetable' }
      : { Icon: Rss, label: 'Live', title: 'Live at station' }
  const departureMinutes = getTrainMinutes(train.Min)
  const departureClock = !clockMode && !departed && Number.isFinite(departureMinutes) && departureMinutes > 0
    ? new Date(Date.now() + departureMinutes * 60_000)
        .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : null
  const rowClass = `beta-train-row ${selected ? 'is-selected' : ''} ${departed ? 'is-muted' : ''}`
  const effectiveConnectionWait = connectionWait ?? (isCatchable(train) ? train._waitTime : null)
  // split into a keyword (hidden on small screens) and the wait itself (always shown)
  const isConnectionRow = !selected && (connection || isCatchable(train)) && effectiveConnectionWait != null
  const statusKeyword = selected
    ? 'Your train'
    : isConnectionRow
      ? effectiveConnectionWait! < 0
        ? 'Tight connection'
        : bestConnection
          ? 'Best connection'
          : null
      : null
  const statusDetail = selected
    ? departed
      ? train.Min === 'ARR' ? 'arriving' : 'en route'
      : null
    : isConnectionRow
      ? `${effectiveConnectionWait} min wait`
      : null
  const hasStatus = statusKeyword != null || statusDetail != null

  const content = (
    <>
      <LineDisc line={train.Line} small />
      <span className="beta-train-destination">
        {destination}
        <small>
          <span className="beta-source-chip" title={source.title} aria-label={source.title}>
            <source.Icon aria-hidden="true" />
            {source.label}
          </span>
          {carDetail}
          {departureClock ? ` · ${departureClock}` : ''}
        </small>
      </span>
      {hasStatus && (
        <span className="beta-live-pill">
          {(selected || bestConnection) && <span className="beta-live-pip" />}
          {statusKeyword && (
            <span className={isConnectionRow && statusDetail ? 'beta-pill-keyword' : undefined}>
              {statusKeyword}
              {statusDetail ? ' · ' : ''}
            </span>
          )}
          {statusDetail}
        </span>
      )}
      <TrainTime train={train} clockMode={clockMode} />
      {selected && <Check className="beta-row-check" aria-hidden="true" />}
    </>
  )

  if (!onClick) {
    return <div className={rowClass}>{content}</div>
  }

  return (
    <button
      type="button"
      className={rowClass}
      onClick={onClick}
      aria-pressed={selected}
      data-testid={selected ? 'train-card-selected' : 'train-card'}
      data-line={train.Line}
      data-destination={destination}
    >
      {content}
    </button>
  )
}

function BoardingSign({
  line,
  carPosition,
  carCount,
  useExitCar = false,
  highlightCar,
  doorRecommendation,
  label,
  detail,
  arrivalName,
  primaryMarker,
}: {
  line: Line
  carPosition: CarPosition
  carCount: number | null
  useExitCar?: boolean
  highlightCar?: number
  doorRecommendation?: DoorRecommendation
  label: string
  detail?: string
  arrivalName: string
  primaryMarker?: PrimaryBoardingMarker
}) {
  const requestedCar = highlightCar ?? (useExitCar ? carPosition.exitCar : carPosition.boardCar)
  const diagramCarCount = carCount ?? 8
  const displayDoor = resolveDisplayDoor(requestedCar || 1, doorRecommendation, diagramCarCount)
  const highlightedCar = displayDoor.car
  const doorOffset = displayDoor.door === 1 ? 2.25 : displayDoor.door === 2 ? 5 : 7.75
  const doorTrainX = (highlightedCar - 1) * 9 + doorOffset
  // px-based clamp: the label has a fixed rendered width, so diagram units
  // can't keep it inside the sign at phone widths. The caret is positioned
  // separately so it always points at the door even when the label clamps.
  const doorPercent = (doorTrainX / (diagramCarCount * 9)) * 100
  const standLabelStyle: CSSProperties = {
    left: `clamp(78px, ${doorPercent}%, calc(100% - 78px))`,
  }
  const doorText = displayDoor.exact ? `${DOOR_LABELS[displayDoor.door]} door` : 'center door'
  const rawLegend = detail ?? carPosition.legend
  const legend = rawLegend.replace(/car\s+\d+/i, (match) => (
    `${match.startsWith('C') ? 'Car' : 'car'} ${highlightedCar}`
  ))
  const markers = buildBoardingMarkers(carPosition, primaryMarker)
  // full exit list (destination signs only — the server populates exits there)
  const exitOptions = [...(carPosition.exits ?? [])].sort((a, b) => a.car - b.car)

  return (
    <div className="beta-sign beta-boarding-sign">
      <div className="beta-board-heading">
        <strong>
          Car {highlightedCar}
          <small> of {diagramCarCount} · {doorText}{!carCount ? ' · planned layout' : ''}</small>
        </strong>
        <span><ArrowLeft className="w-4 h-4" /> FRONT OF TRAIN</span>
      </div>
      <p>{label}{markers.length > 1 ? ` · exits shown at ${arrivalName}` : ''}</p>
      <div
        className="beta-train-diagram"
        aria-label={`Stand at car ${highlightedCar} of ${diagramCarCount}, ${doorText}`}
      >
        <div className="beta-stand-label" style={standLabelStyle}>
          STAND HERE · {doorText.toUpperCase()}
        </div>
        <ChevronDown className="beta-stand-caret" aria-hidden="true" style={{ left: `${doorPercent}%` }} />
        <div className="beta-car-row">
          {Array.from({ length: diagramCarCount }, (_, index) => {
            const number = index + 1
            return (
              <span
                key={number}
                className={`beta-car ${number === highlightedCar ? 'is-highlighted' : ''}`}
                style={number === highlightedCar ? { backgroundColor: LINE_COLORS[line].bg } : undefined}
              >
                {([1, 2, 3] as const).map((door) => (
                  <i
                    key={door}
                    className={number === highlightedCar && door === displayDoor.door ? 'is-target' : ''}
                    style={{ '--door-position': door === 1 ? '25%' : door === 2 ? '55.56%' : '86.11%' } as CSSProperties}
                  />
                ))}
              </span>
            )
          })}
        </div>
        <div className="beta-car-numbers">
          {Array.from({ length: diagramCarCount }, (_, index) => (
            <span key={index + 1} className={index + 1 === highlightedCar ? 'is-highlighted' : ''}>{index + 1}</span>
          ))}
        </div>
        <div className="beta-platform" style={{ '--platform-line': LINE_COLORS[line].bg } as CSSProperties} />
        {markers.length > 0 && (
          <div className={`beta-platform-markers ${markers.some((marker) => marker.row === 2) ? 'has-three-rows' : markers.some((marker) => marker.row === 1) ? 'has-two-rows' : ''}`}>
            {markers.map((marker, index) => (
              <div key={`${marker.label}-${marker.trainXPosition}-${index}`}>
                <span
                  className={`beta-egress-marker ${marker.primary ? 'is-primary' : ''}`}
                  style={diagramPositionStyle(marker.trainXPosition, diagramCarCount)}
                  aria-hidden="true"
                >
                  <span className="beta-egress-leader" />
                  <span className="beta-egress-bubble">
                    <PlatformEgressIcon type={marker.type} />
                  </span>
                </span>
                <span
                  className={`beta-egress-label ${marker.primary ? 'is-primary' : ''} is-row-${marker.row + 1}`}
                  style={diagramPositionStyle(marker.labelXPosition, diagramCarCount)}
                >
                  {marker.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="beta-board-legend">
        {legend}{!displayDoor.exact ? ' · use the center doorway' : ''}
      </div>
      {exitOptions.length > 1 && (
        <ul className="beta-exit-options" aria-label={`All exits at ${arrivalName}`}>
          {exitOptions.map((exit, index) => {
            const primary = exit.car === requestedCar
            return (
              <li
                key={`${exit.car}-${exit.label}-${index}`}
                className={`beta-exit-option ${primary ? 'is-primary' : exit.preferred ? 'is-preferred' : ''}`}
              >
                <b>{exit.car}</b>
                <PlatformEgressIcon type={exit.type} />
                <span>{exit.label}</span>
                {primary && <small>your exit</small>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function WalkingWayfindingStep({
  context,
  onSelectAlternative,
}: {
  context: PlaceContext
  onSelectAlternative: (alt: WalkingAlt) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isOrigin = context.direction === 'to_station'
  const fromLat = isOrigin ? context.place.lat : context.exit.lat
  const fromLon = isOrigin ? context.place.lon : context.exit.lon
  const toLat = isOrigin ? context.exit.lat : context.place.lat
  const toLon = isOrigin ? context.exit.lon : context.place.lon
  const duplicateFallbackCoordinates = context.walkDistanceMeters > 30
    && Math.abs(fromLat - toLat) < 0.00001
    && Math.abs(fromLon - toLon) < 0.00001
  const stationExitQuery = encodeURIComponent(`${context.station.name} ${context.exit.name}`)
  const placeCoordinates = `${context.place.lat},${context.place.lon}`
  const mapsUrl = duplicateFallbackCoordinates
    ? `https://www.google.com/maps/dir/?api=1&origin=${isOrigin ? placeCoordinates : stationExitQuery}&destination=${isOrigin ? stationExitQuery : placeCoordinates}&travelmode=walking`
    : buildMapsUrl(fromLat, fromLon, toLat, toLon)
  const alternatives = context.alternatives ?? []

  return (
    <div>
      <div className="beta-sign beta-direction-sign">
        <span className="beta-helper-tile"><Footprints aria-hidden="true" /></span>
        <span className="beta-direction-copy">
          <strong>{isOrigin ? context.station.name : context.place.name}</strong>
          <small>
            {context.walkTimeMinutes} min walk · {formatDistance(context.walkDistanceMeters)} · via {context.exit.name}
          </small>
        </span>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="beta-maps-link">
          Maps <ExternalLink aria-hidden="true" />
        </a>
        <ArrowUp className="beta-direction-arrow" aria-hidden="true" />
      </div>
      {alternatives.length > 0 && (
        <div className="beta-alternatives">
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {alternatives.length} nearby station {alternatives.length === 1 ? 'alternative' : 'alternatives'}
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </button>
          {expanded && (
            <div className="beta-alternative-list">
              {alternatives.map((alternative) => (
                <button key={alternative.station.code} type="button" onClick={() => onSelectAlternative(alternative)}>
                  <strong>{alternative.station.name}</strong>
                  <span>{alternative.walkTimeMinutes} min · {formatDistance(alternative.walkDistanceMeters)} · {alternative.exit.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function destinationGuidance(context: PlaceContext | null, carPosition: CarPosition | null) {
  if (context) {
    const exactExitLabel = resolveExitLabel(context.station.code, context.exit.name)
    const exactOption = exactExitLabel == null
      ? undefined
      : [
          ...(carPosition?.allExits ?? carPosition?.exits ?? []),
          ...(carPosition?.platformMarkers ?? []),
        ].find((option) => option.exitLabel === exactExitLabel)
    return {
      name: context.exit.name,
      type: exactOption?.type,
      car: exactOption?.car,
      position: exactOption?.position,
      exitLabel: exactExitLabel,
      trainXPosition: exactOption?.trainXPosition,
      doorRecommendation: exactOption?.doorRecommendation,
    }
  }

  const exitOptions = carPosition?.allExits ?? carPosition?.exits
  const preferred = exitOptions?.find((option) => option.preferred) ?? exitOptions?.[0]
  return {
    name: preferred?.label ?? carPosition?.details?.exitDescription ?? carPosition?.legend ?? 'Follow station exit signs',
    type: preferred?.type ?? carPosition?.details?.exitType,
    car: preferred?.car ?? carPosition?.exitCar,
    position: preferred?.position ?? (carPosition?.exitCar ? getPositionForEightCar(carPosition.exitCar) : undefined),
    exitLabel: preferred?.exitLabel,
    trainXPosition: preferred?.trainXPosition ?? carPosition?.details?.trainXPosition,
    doorRecommendation: preferred?.doorRecommendation ?? carPosition?.details?.doorRecommendation,
  }
}

function getConnectionWaitMinutes(train: Train | CatchableTrain, arrivalAtPlatform: number): number | null {
  const annotatedWait = isCatchable(train) && Number.isFinite(train._waitTime)
    ? train._waitTime
    : null
  const departureMinutes = getTrainMinutes(train.Min)
  // Recompute from the chosen first train whenever possible. Schedule-only
  // responses annotate leg two relative to the first listed departure, while
  // the rider may choose a later one.
  const wait = Number.isFinite(departureMinutes)
    ? departureMinutes - arrivalAtPlatform
    : annotatedWait ?? Number.NaN
  const roundedWait = Math.round(wait)
  if (!Number.isFinite(roundedWait) || roundedWait < -3) return null
  return roundedWait
}

export function BetaTripView({
  origin,
  destination,
  transfer,
  leg1Trains,
  leg2Trains,
  leg1CarPosition,
  leg1LineCarPositions,
  leg2CarPosition,
  leg1Stops,
  leg1StopsBeyond,
  leg1LineStops,
  leg1LineStopsBeyond,
  leg2Stops,
  leg2StopsBeyond,
  leg1DirectionLabels,
  leg2DirectionLabels,
  leg1Time,
  leg2Time,
  walkTime,
  onSelectLeg1Train,
  onClearLeg1Selection,
  selectedLeg1Train,
  departureTimestamp,
  onRefresh,
  isRefreshing,
  fetchedAt,
  scheduledLabel,
  plannedForMs = null,
  isLoadingLeg2,
  isDirect,
  showDeparted,
  onToggleShowDeparted,
  accessible,
  originPlaceContext,
  destPlaceContext,
  onSelectOriginWalkingAlt,
  onSelectDestWalkingAlt,
  embedded = false,
  stepOffset = 0,
  overviewTitle = 'Your leg at a glance',
  selectedLeg2Train = null,
  onSelectLeg2Train,
  onClearLeg2Selection,
  preferredLeg1Train = null,
}: BetaTripViewProps) {
  const [showAllTrains, setShowAllTrains] = useState(false)
  const nowMinute = useNow(60_000)

  const liveSelectedTrain = useMemo(() => {
    if (!selectedLeg1Train) return null
    if (selectedLeg1Train._tripId) {
      return leg1Trains.find((train) => train._tripId === selectedLeg1Train._tripId) ?? selectedLeg1Train
    }
    if (selectedLeg1Train.TrainId != null) {
      return leg1Trains.find((train) => String(train.TrainId) === String(selectedLeg1Train.TrainId)) ?? selectedLeg1Train
    }
    if (selectedLeg1Train.TrainNumber != null) {
      return leg1Trains.find((train) => String(train.TrainNumber) === String(selectedLeg1Train.TrainNumber)) ?? selectedLeg1Train
    }
    // WMATA rows often omit stable identifiers. Keep the exact train the
    // rider chose instead of silently adopting a later train with the same
    // line and destination.
    return selectedLeg1Train
  }, [selectedLeg1Train, leg1Trains])

  const liveSelectedLeg2Train = useMemo(() => {
    if (!selectedLeg2Train) return null
    return leg2Trains.find((train) => sameTrain(train, selectedLeg2Train)) ?? selectedLeg2Train
  }, [selectedLeg2Train, leg2Trains])

  const livePreferredLeg1Train = useMemo(() => {
    if (!preferredLeg1Train) return null
    return leg1Trains.find((train) => sameTrain(train, preferredLeg1Train)) ?? preferredLeg1Train
  }, [preferredLeg1Train, leg1Trains])

  const indexedTrains = leg1Trains.map((train, index) => ({ train, index }))
  const matchesSelection = (train: Train) => sameTrain(
    train,
    liveSelectedTrain,
    departureTimestamp,
    nowMinute
  )
  const currentTrains = indexedTrains.filter(({ train }) => !isDeparted(train) || matchesSelection(train))
  const departedTrains = indexedTrains.filter(({ train }) => isDeparted(train) && !matchesSelection(train))
  const selectedRow = currentTrains.find(({ train }) => matchesSelection(train))
  const baseVisibleTrains = showAllTrains ? currentTrains : currentTrains.slice(0, 4)
  const visibleTrains = liveSelectedTrain && !selectedRow
    ? [{ train: liveSelectedTrain, index: -1 }, ...(showAllTrains ? baseVisibleTrains : baseVisibleTrains.slice(0, 3))]
    : selectedRow && !baseVisibleTrains.includes(selectedRow)
      ? [selectedRow, ...baseVisibleTrains.slice(0, 3)]
      : baseVisibleTrains
  const firstWalk = originPlaceContext?.walkTimeMinutes ?? 0
  const reachableTrain = currentTrains.find(({ train }) => {
    const departure = getTrainMinutes(train.Min)
    return !Number.isFinite(departure) || departure >= firstWalk
  })?.train
  const summaryTrain = liveSelectedTrain ?? livePreferredLeg1Train ?? reachableTrain ?? null
  const primaryLine = summaryTrain?.Line ?? transfer?.fromLine ?? origin.lines[0]
  const activeLeg1CarPosition = primaryLine
    ? leg1LineCarPositions?.[primaryLine] ?? leg1CarPosition
    : leg1CarPosition
  const routeDirectRideTime = isDirect
    ? leg1Trains
        .filter((train) => !primaryLine || train.Line === primaryLine)
        .map((train) => getDirectRideMinutes(train))
        .find((minutes) => minutes != null && minutes > 0) ?? null
    : null
  const directRideTime = isDirect ? getDirectRideMinutes(summaryTrain) ?? routeDirectRideTime : null
  const selectedDeparturePassed = !!liveSelectedTrain
    && departureTimestamp != null
    && departureTimestamp <= nowMinute
  const alreadyOnTrain = !!summaryTrain && (isDeparted(summaryTrain) || selectedDeparturePassed)
  const fullLeg1Time = isDirect ? (directRideTime ?? Math.max(0, leg1Time)) : leg1Time
  const pathBasedRemainingLeg1 = alreadyOnTrain && departureTimestamp
    ? Math.max(0, fullLeg1Time + Math.round((departureTimestamp - nowMinute) / 60_000))
    : fullLeg1Time
  const effectiveLeg1Time = alreadyOnTrain
    ? getRemainingRideMinutes(summaryTrain, isDirect, pathBasedRemainingLeg1, nowMinute)
    : fullLeg1Time
  const effectiveFirstWalk = alreadyOnTrain ? 0 : firstWalk
  const departureFromNow = deriveWaitMinutes(summaryTrain, liveSelectedTrain ? departureTimestamp : null) ?? 0
  const firstWait = Math.max(0, departureFromNow - effectiveFirstWalk)
  const arrivalAtConnectingPlatform = effectiveFirstWalk + firstWait + effectiveLeg1Time + walkTime
  const connectionRows = leg2Trains.flatMap((train) => {
    const wait = getConnectionWaitMinutes(train, arrivalAtConnectingPlatform)
    return wait == null ? [] : [{ train, wait }]
  })
  const bestConnection = connectionRows.find((item) => item.wait >= 0) ?? null
  const selectedConnection = liveSelectedLeg2Train
    ? connectionRows.find(({ train }) => sameTrain(train, liveSelectedLeg2Train)) ?? null
    : null
  const catchableTrain = selectedConnection?.train ?? bestConnection?.train ?? null
  const routeLeg2Train = catchableTrain
    ?? connectionRows[0]?.train
    ?? leg2Trains.find((train) => !isDeparted(train))
    ?? leg2Trains[0]
    ?? null
  const representativeLeg2Train = catchableTrain
  const secondWait = Math.max(0, selectedConnection?.wait ?? bestConnection?.wait ?? 0)
  const finalLine = representativeLeg2Train?.Line ?? routeLeg2Train?.Line ?? transfer?.toLine ?? primaryLine
  const targetPlatformLines = transfer?.toPlatformLines?.length
    ? transfer.toPlatformLines
    : [...new Set([
        ...(finalLine ? [finalLine] : []),
        ...connectionRows.map(({ train }) => train.Line),
      ])]
  const levelInstruction = transfer?.levelInstruction ?? 'across the station'
  const finalLegStops = isDirect && finalLine
    ? leg1LineStops?.[finalLine] ?? leg1Stops
    : isDirect
      ? leg1Stops
      : leg2Stops
  const finalLegStopsBeyond = isDirect && finalLine
    ? leg1LineStopsBeyond?.[finalLine] ?? leg1StopsBeyond
    : isDirect
      ? leg1StopsBeyond
      : leg2StopsBeyond
  const lastWalk = destPlaceContext?.walkTimeMinutes ?? 0
  const totalMinutes = computeTotalMinutes([
    effectiveFirstWalk,
    firstWait,
    effectiveLeg1Time,
    isDirect ? null : walkTime,
    isDirect ? null : secondWait,
    isDirect ? null : leg2Time,
    lastWalk,
  ])
  const hasKnownConnection = isDirect || (!!catchableTrain && !isLoadingLeg2)
  const hasKnownRideTime = !!summaryTrain
    && hasKnownConnection
    && (isDirect ? effectiveLeg1Time > 0 : leg1Time > 0 && leg2Time > 0)
  // schedule-only trips: the headline should show trip duration from the planned
  // departure, not minutes-from-now (which balloons for an evening trip)
  const scheduledWaitOffset = plannedForMs
    ? Math.min(firstWait, Math.max(0, Math.round((plannedForMs - nowMinute) / 60_000)))
    : 0
  const displayTotalMinutes = Math.max(0, totalMinutes - scheduledWaitOffset)
  const displayFirstWait = Math.max(0, firstWait - scheduledWaitOffset)
  const glanceSegments: Array<{ label: string; minutes: number | null; icon: ReactNode }> = [
    ...(effectiveFirstWalk > 0 ? [{ label: 'Walk to Metro', minutes: effectiveFirstWalk as number | null, icon: <Footprints /> as ReactNode }] : []),
    { label: 'Platform wait', minutes: displayFirstWait, icon: <Clock3 /> },
    ...(isDirect
      ? [{ label: 'Metro ride', minutes: effectiveLeg1Time > 0 ? effectiveLeg1Time : null, icon: <TrainFront /> }]
      : [
          { label: 'Metro leg 1', minutes: leg1Time > 0 ? effectiveLeg1Time : null, icon: <TrainFront /> },
          { label: 'Transfer walk', minutes: walkTime, icon: <Footprints /> },
          { label: 'Transfer wait', minutes: hasKnownConnection ? secondWait : null, icon: <Clock3 /> },
          { label: 'Metro leg 2', minutes: leg2Time > 0 ? leg2Time : null, icon: <TrainFront /> },
        ]),
    ...(lastWalk > 0 ? [{ label: 'Exit walk', minutes: lastWalk, icon: <Footprints /> }] : []),
  ]
  const stationArrivalClock = isDirect
    ? summaryTrain?._destArrivalTime
    : (catchableTrain && isCatchable(catchableTrain) ? catchableTrain._arrivalClock : undefined)
      ?? catchableTrain?._destArrivalTime
  const arrivalClock = hasKnownRideTime
    ? (lastWalk > 0 ? resolveArrivalClock(totalMinutes) : stationArrivalClock ?? resolveArrivalClock(totalMinutes))
    : null
  const destinationExit = destinationGuidance(destPlaceContext, isDirect ? activeLeg1CarPosition : leg2CarPosition)
  const destinationExitLetter = exitGroupLetter(destinationExit.exitLabel)
  const transferName = transfer?.name ?? ''
  const firstHeadsign = summaryTrain ? getDisplayName(summaryTrain.DestinationName) : 'your train'
  const secondHeadsign = routeLeg2Train
    ? getDisplayName(routeLeg2Train.DestinationName)
    : 'your destination'
  // Signage shows canonical full-line termini (what the permanent station signs
  // say), never short-turn headsigns. Train rows keep their real destinations.
  const joinSignageLabels = (
    labels: Partial<Record<Line, string>> | undefined,
    lines: Line[]
  ): string | null => {
    const named = [...new Set(lines.map((line) => labels?.[line]).filter((label): label is string => !!label))]
    return named.length > 0 ? named.join(', ') : null
  }
  const firstDirectionLabel = (primaryLine ? leg1DirectionLabels?.[primaryLine] : undefined) ?? firstHeadsign
  const firstDirectionSignage = joinSignageLabels(leg1DirectionLabels, origin.lines) ?? firstDirectionLabel
  const secondDirectionLabel = (finalLine ? leg2DirectionLabels?.[finalLine] : undefined) ?? secondHeadsign
  const secondDirectionSignage = joinSignageLabels(leg2DirectionLabels, targetPlatformLines) ?? secondDirectionLabel
  const firstCarCount = getReportedCarCount(summaryTrain)
  const secondCarCount = getReportedCarCount(representativeLeg2Train)
  const fallbackTransferArrivalTimestamp = liveSelectedTrain
    ? (departureTimestamp
        ?? (nowMinute + Math.max(0, getTrainMinutes(liveSelectedTrain.Min)) * 60_000))
      + leg1Time * 60_000
    : null
  const transferArrivalClock = liveSelectedTrain?._transferArrivalTime
    ?? (liveSelectedTrain?._transferArrivalTimestamp || fallbackTransferArrivalTimestamp
      ? new Date(liveSelectedTrain?._transferArrivalTimestamp ?? fallbackTransferArrivalTimestamp!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : null)
  const destinationCarCount = isDirect ? firstCarCount : secondCarCount
  const destinationDisplayCar = destinationExit.car && destinationCarCount
    ? resolveDisplayDoor(
        destinationExit.car,
        destinationExit.doorRecommendation,
        destinationCarCount
      ).car
    : undefined
  const destinationPosition = destinationExit.position
    ?? (destinationExit.car ? getPositionForEightCar(destinationExit.car) : undefined)
  const destinationPositionText = destinationDisplayCar
    ? `near car ${destinationDisplayCar}`
    : destinationPosition
      ? `near ${destinationPosition} of train`
      : null
  const finalLegOrigin: Station = finalLegStops[0] ?? (isDirect || !transfer
    ? origin
    : {
        code: transfer.toPlatform,
        name: transfer.name,
        lines: finalLine ? [finalLine] : [],
      })
  const pylonStops = finalLegStops.length >= 2
    ? finalLegStops
    : [finalLegOrigin, destination]
  const pylonStopsDestinationFirst = [...pylonStops].reverse()
  const finalPylonRows: PylonRow[] = [
    ...[...finalLegStopsBeyond].reverse().map((station) => ({
      station,
      beyond: true,
      isDestination: false,
      isOrigin: false,
    })),
    ...pylonStopsDestinationFirst.map((station, index) => ({
      station,
      beyond: false,
      isDestination: index === 0,
      isOrigin: index === pylonStopsDestinationFirst.length - 1,
    })),
  ]
  const finalPylonNote = `Your stop · ${isDirect ? effectiveLeg1Time : leg2Time} min ride${destinationPositionText ? ` · exit ${destinationPositionText}` : ''}`
  // first leg gets its own glance on transfer trips
  const firstLegStops = leg1Stops.length >= 2
    ? leg1Stops
    : transfer
      ? [origin, { code: transfer.fromPlatform, name: transfer.name, lines: primaryLine ? [primaryLine] : [] }]
      : []
  const firstPylonRows: PylonRow[] = [...firstLegStops].reverse().map((station, index, reversed) => ({
    station,
    beyond: false,
    isDestination: index === 0,
    isOrigin: index === reversed.length - 1,
  }))
  const firstPylonNote = `Transfer here · ${effectiveLeg1Time} min ride`
  const selectedDisplayTrain = liveSelectedTrain
    ? {
        ...liveSelectedTrain,
        Min: alreadyOnTrain
          ? effectiveLeg1Time <= 0 ? 'ARR' : effectiveLeg1Time
          : departureFromNow <= 0 ? liveSelectedTrain.Min === 'ARR' ? 'ARR' : 'BRD' : departureFromNow,
        _departed: alreadyOnTrain,
      }
    : null
  let step = 1 + stepOffset
  const originWalkStep = originPlaceContext ? step++ : null
  const originStationStep = step++
  const firstBoardingStep = activeLeg1CarPosition ? step++ : null
  const firstGlanceStep = !isDirect && transfer && firstPylonRows.length >= 2 ? step++ : null
  const transferStep = !isDirect && transfer ? step++ : null
  const secondBoardingStep = !isDirect && leg2CarPosition ? step++ : null
  const overviewStep = step++
  const exitStep = step++
  const destinationWalkStep = destPlaceContext ? step++ : null
  const glanceStep = embedded ? null : step++
  const firstGlanceTitle = embedded ? 'Metro leg 1 at a glance' : 'First leg at a glance'
  const finalOverviewTitle = isDirect
    ? overviewTitle
    : embedded ? 'Metro leg 2 at a glance' : 'Second leg at a glance'

  return (
    <div className={`beta-trip-view ${embedded ? 'is-embedded' : ''}`}>
      {!embedded && (
        <>
          <div className="beta-summary" aria-live="polite">
            <span className="beta-total">{hasKnownRideTime ? displayTotalMinutes : '—'}<small> min</small></span>
            <span className="beta-via">
              {isDirect
                ? `${primaryLine ? LINE_NAMES[primaryLine] : 'Metro'} Line direct`
                : `via ${transferName}`}
              {(firstWalk || lastWalk) ? ' + walk' : ''}
            </span>
            {arrivalClock && <span className="beta-arrival">Arr {arrivalClock}</span>}
          </div>

          <div className="beta-refresh-row">
            <UpdatedAgo fetchedAt={fetchedAt} isFetching={isRefreshing} label={scheduledLabel} />
            <button type="button" onClick={onRefresh} disabled={isRefreshing}>
              <RefreshCw className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
          </div>
        </>
      )}

      {originPlaceContext && originWalkStep && (
        <BetaStep number={originWalkStep} title={`Start at ${originPlaceContext.place.name} — walk to Metro`}>
          <WalkingWayfindingStep context={originPlaceContext} onSelectAlternative={onSelectOriginWalkingAlt} />
        </BetaStep>
      )}

      <BetaStep
        number={originStationStep}
        title={`${origin.name} — ${primaryLine ? LINE_NAMES[primaryLine] : 'Metro'} Line toward ${firstDirectionLabel}`}
        trailing={liveSelectedTrain ? (
          <button type="button" className="beta-change-link" onClick={onClearLeg1Selection}>Change train</button>
        ) : (
          <span className="beta-select-note">Optional · select for exact timing</span>
        )}
      >
        <div className="beta-sign beta-station-sign">
          <div className="beta-station-top">
            <div>
              <h2>{origin.name}</h2>
              <p>Platform toward {firstDirectionSignage}</p>
            </div>
            <LineDiscs lines={origin.lines} />
          </div>
          <div className="beta-train-list" aria-label={`Trains from ${origin.name}`}>
            {visibleTrains.map(({ train, index }) => {
              const selected = matchesSelection(train) || (index === -1 && !!liveSelectedTrain)
              return (
                <TrainRow
                  key={train._tripId ?? train.TrainId ?? train.TrainNumber ?? `${train.Line}-${train.DestinationName}-${index}`}
                  train={selected && selectedDisplayTrain ? selectedDisplayTrain : train}
                  selected={selected}
                  bestConnection={isCatchable(train) && train === currentTrains[0]?.train}
                  clockMode={!!plannedForMs}
                  onClick={index >= 0 && !selected ? () => onSelectLeg1Train(train, index) : undefined}
                />
              )
            })}
            {currentTrains.length === 0 && <div className="beta-no-trains">No current trains found</div>}
          </div>
          {currentTrains.length > 4 && (
            <button type="button" className="beta-show-more" onClick={() => setShowAllTrains((value) => !value)}>
              {showAllTrains ? 'Show fewer trains' : `Show ${currentTrains.length - 4} more trains`}
            </button>
          )}
          <button type="button" className="beta-departed-toggle" onClick={onToggleShowDeparted} aria-expanded={showDeparted}>
            {showDeparted ? <ChevronDown /> : <ChevronUp />}
            {showDeparted ? 'Hide recently departed trains' : 'Already on a train?'}
          </button>
          {showDeparted && (
            <div className="beta-departed-list">
              {departedTrains.length > 0 ? departedTrains.map(({ train, index }) => (
                <TrainRow
                  key={train._tripId ?? `${train.Line}-${train.DestinationName}-departed-${index}`}
                  train={train}
                  selected={matchesSelection(train)}
                  onClick={() => onSelectLeg1Train(train, index)}
                />
              )) : <div className="beta-no-trains">No recently departed trains found</div>}
            </div>
          )}
        </div>
      </BetaStep>

      {activeLeg1CarPosition && firstBoardingStep && primaryLine && (
        <BetaStep number={firstBoardingStep} title="On the platform — stand here">
          <BoardingSign
            line={primaryLine}
            carPosition={activeLeg1CarPosition}
            carCount={firstCarCount}
            useExitCar={isDirect}
            highlightCar={isDirect ? destinationExit.car : undefined}
            doorRecommendation={
              isDirect
                ? destinationExit.doorRecommendation ?? activeLeg1CarPosition.details?.doorRecommendation
                : activeLeg1CarPosition.details?.doorRecommendation
            }
            label={isDirect && destinationExit.car ? `Ride here for ${destinationExit.name}` : isDirect ? 'Ride here for the best destination exit position' : `Best position for your transfer at ${transferName}`}
            detail={isDirect && destinationExit.car ? `Closest car for ${destinationExit.name}` : undefined}
            arrivalName={isDirect ? destination.name : transferName}
            primaryMarker={{
              trainXPosition: isDirect
                ? destinationExit.trainXPosition ?? activeLeg1CarPosition.details?.trainXPosition
                : activeLeg1CarPosition.details?.trainXPosition,
              type: isDirect
                ? destinationExit.type ?? activeLeg1CarPosition.details?.exitType
                : activeLeg1CarPosition.details?.exitType ?? 'escalator',
              label: isDirect ? destinationExit.name : `${finalLine ? LINE_NAMES[finalLine] : 'Connecting'} Line`,
            }}
          />
        </BetaStep>
      )}

      {firstGlanceStep && (
        <BetaStep number={firstGlanceStep} title={firstGlanceTitle}>
          <LegPylon
            line={primaryLine}
            directionLabel={firstDirectionLabel}
            rows={firstPylonRows}
            rideMinutes={effectiveLeg1Time}
            destinationNote={firstPylonNote}
          />
        </BetaStep>
      )}

      {!isDirect && transfer && transferStep && (
        <BetaStep
          number={transferStep}
          title={`Off the train at ${transferName}${transferArrivalClock ? ` — arrives ${transferArrivalClock}` : ''}`}
          trailing={(accessible || liveSelectedLeg2Train) ? (
            <span className="beta-step-actions">
              {accessible && <span className="beta-accessible-note"><Accessibility /> elevator-aware</span>}
              {liveSelectedLeg2Train && onClearLeg2Selection && (
                <button type="button" className="beta-change-link" onClick={onClearLeg2Selection}>Change train</button>
              )}
            </span>
          ) : undefined}
        >
          <div className="beta-sign beta-station-sign beta-transfer-sign">
            <div className="beta-station-top">
              <div>
                <h2>{transferName}</h2>
                <p>Transfer to the {finalLine ? LINE_NAMES[finalLine] : ''} Line · {levelInstruction}</p>
              </div>
              {targetPlatformLines.length > 0 && <LineDiscs lines={targetPlatformLines} />}
            </div>
            {/* street exits are omitted here on purpose: the rider is
                transferring, and we have no bearing data to point at them */}
            <div className="beta-transfer-direction">
              <span className="beta-transfer-target">
                <span className="beta-follow-block">
                  {targetPlatformLines.length > 0 && <LineDiscs lines={targetPlatformLines} small />}
                  <strong>{secondDirectionSignage}</strong>
                </span>
                <ArrowRight className="beta-sign-arrow" aria-hidden="true" />
              </span>
            </div>
            <div className="beta-trains-heading">Next trains · toward {secondDirectionSignage}</div>
            {isLoadingLeg2 ? (
              <div className="beta-connection-loading"><span /> Confirming the live connection…</div>
            ) : (
              <div className="beta-train-list">
                {connectionRows.length > 0 ? connectionRows.slice(0, 5).map(({ train, wait }, index) => {
                  const selected = !!liveSelectedLeg2Train && sameTrain(train, liveSelectedLeg2Train)
                  return (
                  <TrainRow
                    key={train._tripId ?? `${train.Line}-${train.DestinationName}-leg2-${index}`}
                    train={train}
                    selected={selected}
                    connection
                    connectionWait={wait}
                    bestConnection={train === bestConnection?.train}
                    clockMode={!!plannedForMs}
                    onClick={onSelectLeg2Train && !selected ? () => onSelectLeg2Train(train, index) : undefined}
                  />
                  )
                }) : (
                  <div className="beta-no-trains">
                    {liveSelectedTrain ? 'No confirmed connection is available yet' : 'No connection is currently available'}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="beta-follow-caption"><span /> Follow this block — {levelInstruction}, about {walkTime} min</div>
        </BetaStep>
      )}

      {!isDirect && leg2CarPosition && secondBoardingStep && finalLine && (
        <BetaStep number={secondBoardingStep} title={`On the ${LINE_NAMES[finalLine]} Line platform — stand here`}>
          <BoardingSign
            line={finalLine}
            carPosition={leg2CarPosition}
            carCount={secondCarCount}
            useExitCar
            highlightCar={destinationExit.car}
            doorRecommendation={destinationExit.doorRecommendation ?? leg2CarPosition.details?.doorRecommendation}
            label={destinationExit.car ? `Ride here for ${destinationExit.name}` : `Ride here for the best exit position at ${destination.name}`}
            detail={destinationExit.car ? `Closest car for ${destinationExit.name}` : undefined}
            arrivalName={destination.name}
            primaryMarker={{
              trainXPosition: destinationExit.trainXPosition ?? leg2CarPosition.details?.trainXPosition,
              type: destinationExit.type ?? leg2CarPosition.details?.exitType,
              label: destinationExit.name,
            }}
          />
        </BetaStep>
      )}

      {overviewStep && (
        <BetaStep number={overviewStep} title={finalOverviewTitle}>
          <LegPylon
            line={finalLine}
            directionLabel={isDirect ? firstDirectionLabel : secondDirectionLabel}
            rows={finalPylonRows}
            rideMinutes={isDirect ? effectiveLeg1Time : leg2Time}
            destinationNote={finalPylonNote}
          />
        </BetaStep>
      )}

      {exitStep && (
        <BetaStep number={exitStep} title={`At ${destination.name} — take this exit`}>
          <div className="beta-sign beta-direction-sign beta-exit-sign">
            <span className="beta-exit-tag">
              <b>Exit</b>
              {destinationExitLetter && <span>{destinationExitLetter}</span>}
            </span>
            <span className="beta-direction-copy">
              <strong>{destinationExit.name}</strong>
              <small>
                {[destinationExit.type, destinationPositionText, accessible ? 'accessible routing on' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
            <ArrowUp className="beta-direction-arrow" aria-hidden="true" />
          </div>
        </BetaStep>
      )}

      {destPlaceContext && destinationWalkStep && (
        <BetaStep number={destinationWalkStep} title={`Walk to ${destPlaceContext.place.name}${arrivalClock ? ` — arrive ${arrivalClock}` : ''}`}>
          <WalkingWayfindingStep context={destPlaceContext} onSelectAlternative={onSelectDestWalkingAlt} />
        </BetaStep>
      )}

      {!embedded && glanceStep && hasKnownRideTime && (
        <BetaStep number={glanceStep} title="Your trip at a glance">
          <div className="beta-sign beta-hybrid-glance">
            <div className="beta-hybrid-glance-head">
              <span>
                <TrainFront />
                <strong>{isDirect && primaryLine ? `${LINE_NAMES[primaryLine]} Line` : `via ${transferName}`}</strong>
              </span>
              <span><b>{displayTotalMinutes}</b> min{arrivalClock ? ` · Arr ${arrivalClock}` : ''}</span>
            </div>
            <div className="beta-hybrid-breakdown">
              {glanceSegments.map((segment, index) => (
                <span key={`${segment.label}-${index}`}>
                  <i>{segment.icon}</i>
                  <small>{segment.label}</small>
                  <strong>{segment.minutes == null ? '—' : `${Math.round(segment.minutes)} min`}</strong>
                </span>
              ))}
            </div>
          </div>
        </BetaStep>
      )}

    </div>
  )
}
