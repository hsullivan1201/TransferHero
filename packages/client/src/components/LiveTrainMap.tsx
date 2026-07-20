import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { LocateFixed, Minus, Plus } from 'lucide-react'
import type { Line, MetroMapData } from '@transferhero/shared'
import { LINE_DRAW_ORDER, type SchematicPoint } from '../data/metroSchematic'
import { LINE_COLORS } from '../utils/lineColors'
import {
  bearingAtDistance,
  buildLiveMapGeometry,
  pointAtDistance,
  type LiveMapGeometry,
  type LiveMapTrain,
  type SchematicNetworkPath,
  type SchematicRouteStation,
} from './liveTrainMapGeometry'

export type { LiveMapStation, LiveMapTrain } from './liveTrainMapGeometry'

interface LiveTrainMapProps {
  mapData: MetroMapData
  train: LiveMapTrain
  transferName?: string | null
  positionUnavailable?: boolean
}

interface MapView {
  x: number
  y: number
  w: number
  h: number
}

const MAX_ZOOM = 4
const MINOR_LABEL_ZOOM = 1.55
const LABEL_MARGIN = 14
const PASSED_SLACK = 8

function lineLetter(line: Line): string {
  return line.slice(0, 1)
}

function markerInk(line: Line): string {
  return line === 'OR' || line === 'SV' || line === 'YL' ? '#211a16' : '#ffffff'
}

function sortedNetworkPaths(paths: readonly SchematicNetworkPath[]): SchematicNetworkPath[] {
  return [...paths].sort((a, b) => (
    LINE_DRAW_ORDER.indexOf(a.line) - LINE_DRAW_ORDER.indexOf(b.line)
  ))
}

function estimateLabelWidth(name: string, emphasized: boolean): number {
  return Math.max(52, name.length * (emphasized ? 9 : 7.8))
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function viewsClose(a: MapView, b: MapView): boolean {
  const epsilon = Math.max(a.w, b.w) * 0.0005
  return Math.abs(a.x - b.x) < epsilon
    && Math.abs(a.y - b.y) < epsilon
    && Math.abs(a.w - b.w) < epsilon
    && Math.abs(a.h - b.h) < epsilon
}

function lerpView(a: MapView, b: MapView, t: number): MapView {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ))
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return reduced
}

function clockTime(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

interface LabelRect {
  left: number
  right: number
  top: number
  bottom: number
}

interface LabelPlacement {
  x: number
  anchor: 'start' | 'end' | 'middle'
  kickerY: number
  labelY: number
}

function rectsIntersect(a: LabelRect, b: LabelRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/**
 * Greedy label planner: labels are placed in priority order, and each label
 * tries beside-the-station spots first, then above/below, picking the first
 * position that stays inside the frame and clear of the train marker and of
 * every label already placed. Keeps copy from being clipped or buried.
 */
class LabelPlanner {
  private readonly occupied: LabelRect[] = []

  constructor(
    private readonly fit: LiveMapGeometry['viewBox'],
    private readonly centerX: number,
    obstacles: LabelRect[]
  ) {
    this.occupied.push(...obstacles)
  }

  place(
    station: SchematicRouteStation,
    options: { emphasized?: boolean; preferSide?: 'start' | 'end'; distance?: number } = {}
  ): LabelPlacement {
    const emphasized = options.emphasized ?? false
    const gap = options.distance ?? 18
    const width = estimateLabelWidth(station.name, emphasized)
    const defaultSide: 'start' | 'end' = options.preferSide
      ?? (station.x > this.centerX ? 'end' : 'start')
    const otherSide: 'start' | 'end' = defaultSide === 'start' ? 'end' : 'start'

    const beside = (side: 'start' | 'end', sideGap: number): LabelPlacement => ({
      x: station.x + (side === 'start' ? sideGap : -sideGap),
      anchor: side,
      kickerY: station.y - 10,
      labelY: station.y + 10,
    })
    const stacked = (direction: 'above' | 'below'): LabelPlacement => ({
      x: station.x,
      anchor: 'middle',
      kickerY: direction === 'above' ? station.y - 44 : station.y + 30,
      labelY: direction === 'above' ? station.y - 26 : station.y + 48,
    })

    const candidates = [
      beside(defaultSide, gap),
      beside(otherSide, gap),
      beside(defaultSide, 56),
      beside(otherSide, 56),
      stacked(station.y > this.fit.y + this.fit.height / 2 ? 'above' : 'below'),
      stacked(station.y > this.fit.y + this.fit.height / 2 ? 'below' : 'above'),
    ]
    const chosen = candidates.find(candidate => {
      const rect = this.rectFor(candidate, width)
      return this.fitsFrame(rect) && this.occupied.every(other => !rectsIntersect(rect, other))
    }) ?? candidates[0]
    this.occupied.push(this.rectFor(chosen, width))
    return chosen
  }

  /** Single-line label for quieter stations; hidden when no clear spot exists. */
  tryPlaceMinor(station: SchematicRouteStation): LabelPlacement | null {
    const width = Math.max(40, station.name.length * 6.4)
    const sides: Array<'start' | 'end'> = station.x > this.centerX
      ? ['end', 'start']
      : ['start', 'end']
    for (const side of sides) {
      const x = station.x + (side === 'start' ? 12 : -12)
      const left = side === 'start' ? x : x - width
      const rect = { left, right: left + width, top: station.y - 9, bottom: station.y + 9 }
      if (!this.fitsFrame(rect)) continue
      if (this.occupied.some(other => rectsIntersect(rect, other))) continue
      this.occupied.push(rect)
      return { x, anchor: side, kickerY: station.y, labelY: station.y + 4 }
    }
    return null
  }

  private rectFor(placement: LabelPlacement, width: number): LabelRect {
    const left = placement.anchor === 'start'
      ? placement.x
      : placement.anchor === 'end' ? placement.x - width : placement.x - width / 2
    return {
      left,
      right: left + width,
      top: placement.kickerY - 10,
      bottom: placement.labelY + 6,
    }
  }

  private fitsFrame(rect: LabelRect): boolean {
    return rect.left >= this.fit.x + LABEL_MARGIN
      && rect.right <= this.fit.x + this.fit.width - LABEL_MARGIN
      && rect.top >= this.fit.y + LABEL_MARGIN
      && rect.bottom <= this.fit.y + this.fit.height - LABEL_MARGIN
  }
}

export function LiveTrainMap({
  mapData,
  train,
  transferName,
  positionUnavailable = false,
}: LiveTrainMapProps) {
  const rawId = useId()
  const id = rawId.replace(/:/gu, '')
  const reducedMotion = usePrefersReducedMotion()
  const geometry = useMemo(() => buildLiveMapGeometry(mapData, train), [mapData, train])
  const routeKey = `${train.id}:${(train.approach?.stationCodes ?? []).join(',')}|${train.routeStationCodes.join('>')}`

  const stageRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fitRef = useRef(geometry?.viewBox ?? null)
  fitRef.current = geometry?.viewBox ?? null

  // --- Train progress animation: glide along the polyline between updates.
  const targetDistance = geometry?.progressDistance ?? 0
  const [displayDistance, setDisplayDistance] = useState(targetDistance)
  const displayRef = useRef(displayDistance)
  const routeKeyRef = useRef(routeKey)

  useEffect(() => {
    if (routeKeyRef.current !== routeKey || reducedMotion) {
      routeKeyRef.current = routeKey
      displayRef.current = targetDistance
      setDisplayDistance(targetDistance)
      return
    }
    const from = displayRef.current
    const delta = targetDistance - from
    if (Math.abs(delta) < 0.25) {
      displayRef.current = targetDistance
      setDisplayDistance(targetDistance)
      return
    }
    const duration = Math.min(2600, Math.max(650, Math.abs(delta) * 16))
    const startedAt = performance.now()
    let frame = 0
    const step = (timestamp: number) => {
      const t = Math.min(1, (timestamp - startedAt) / duration)
      const value = from + delta * easeInOutCubic(t)
      displayRef.current = value
      setDisplayDistance(value)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    // Timer fallback so a starved requestAnimationFrame (background tab,
    // embedded pane) still lands the train on its target position.
    const fallback = window.setTimeout(() => {
      displayRef.current = targetDistance
      setDisplayDistance(targetDistance)
    }, duration + 150)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(fallback)
    }
  }, [reducedMotion, routeKey, targetDistance])

  const trainOnMap = Boolean(geometry && geometry.hasPosition && !train.ended)
  const drawDistance = train.ended
    ? geometry?.combinedLength ?? 0
    : Math.min(displayDistance, geometry?.combinedLength ?? 0)
  const tripDrawDistance = Math.max(
    0,
    Math.min(drawDistance - (geometry?.approachLength ?? 0), geometry?.routeLength ?? 0)
  )
  const trainPoint = geometry && trainOnMap ? pointAtDistance(geometry.combinedPoints, drawDistance) : null
  const trainBearing = geometry ? bearingAtDistance(geometry.combinedPoints, drawDistance) : 0

  // --- Camera: fit by default, follow the train while zoomed, free pan/zoom.
  const [zoom, setZoom] = useState(1)
  const [manualCenter, setManualCenter] = useState<SchematicPoint | null>(null)
  const manualCenterRef = useRef(manualCenter)
  manualCenterRef.current = manualCenter
  const following = manualCenter === null
  const [focusCode, setFocusCode] = useState<string | null>(null)

  useEffect(() => {
    setZoom(1)
    setManualCenter(null)
    setFocusCode(null)
  }, [routeKey])

  const clampCenter = useCallback((center: SchematicPoint, atZoom: number): SchematicPoint => {
    const fit = fitRef.current
    if (!fit) return center
    const w = fit.width / atZoom
    const h = fit.height / atZoom
    const clampAxis = (value: number, min: number, max: number) => (
      min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value))
    )
    return {
      x: clampAxis(center.x, fit.x + w / 2, fit.x + fit.width - w / 2),
      y: clampAxis(center.y, fit.y + h / 2, fit.y + fit.height - h / 2),
    }
  }, [])

  const targetView = useMemo<MapView | null>(() => {
    const fit = geometry?.viewBox
    if (!fit) return null
    const w = fit.width / zoom
    const h = fit.height / zoom
    let center: SchematicPoint
    if (manualCenter) center = clampCenter(manualCenter, zoom)
    else if (zoom > 1.001 && trainPoint) center = clampCenter(trainPoint, zoom)
    else center = { x: fit.x + fit.width / 2, y: fit.y + fit.height / 2 }
    return { x: center.x - w / 2, y: center.y - h / 2, w, h }
  }, [clampCenter, geometry?.viewBox, manualCenter, trainPoint, zoom])

  const [renderView, setRenderView] = useState<MapView | null>(targetView)
  const renderViewRef = useRef(renderView)
  const draggingRef = useRef(false)

  const targetViewRef = useRef(targetView)
  targetViewRef.current = targetView

  // Time-based camera ease with a timer fallback: if the environment starves
  // requestAnimationFrame (background tab, embedded pane), the view still
  // lands on its target instead of freezing mid-flight.
  useEffect(() => {
    const target = targetViewRef.current
    if (!target) return
    const current = renderViewRef.current
    if (current && viewsClose(current, target)) return
    if (!current || draggingRef.current || reducedMotion) {
      renderViewRef.current = target
      setRenderView(target)
      return
    }
    const from = current
    const duration = 420
    const startedAt = performance.now()
    let frame = 0
    const finish = () => {
      const latestTarget = targetViewRef.current
      if (!latestTarget) return
      renderViewRef.current = latestTarget
      setRenderView(latestTarget)
    }
    const step = (timestamp: number) => {
      const latestTarget = targetViewRef.current
      if (!latestTarget) return
      const t = Math.min(1, (timestamp - startedAt) / duration)
      if (t >= 1) {
        finish()
        return
      }
      const next = lerpView(from, latestTarget, easeInOutCubic(t))
      renderViewRef.current = next
      setRenderView(next)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    const fallback = window.setTimeout(finish, duration + 150)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(fallback)
    }
  }, [reducedMotion, targetView?.x, targetView?.y, targetView?.w, targetView?.h])

  const view = renderView ?? targetView
  const currentZoom = geometry && view ? geometry.viewBox.width / view.w : 1

  // --- Gestures: drag to pan, pinch and wheel to zoom, double-tap to zoom in.
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const movedRef = useRef(0)
  const suppressClickRef = useRef(false)
  const [dragging, setDragging] = useState(false)

  const stageMetrics = useCallback(() => {
    const stage = stageRef.current
    const currentView = renderViewRef.current
    if (!stage || !currentView) return null
    const rect = stage.getBoundingClientRect()
    const scale = Math.min(rect.width / currentView.w, rect.height / currentView.h)
    return {
      rect,
      scale,
      offsetX: (rect.width - currentView.w * scale) / 2,
      offsetY: (rect.height - currentView.h * scale) / 2,
      view: currentView,
    }
  }, [])

  const toUserPoint = useCallback((clientX: number, clientY: number): SchematicPoint | null => {
    const metrics = stageMetrics()
    if (!metrics) return null
    return {
      x: metrics.view.x + (clientX - metrics.rect.left - metrics.offsetX) / metrics.scale,
      y: metrics.view.y + (clientY - metrics.rect.top - metrics.offsetY) / metrics.scale,
    }
  }, [stageMetrics])

  const applyZoomAt = useCallback((nextZoomRaw: number, anchor: SchematicPoint | null) => {
    const fit = fitRef.current
    const currentView = renderViewRef.current
    if (!fit || !currentView) return
    const currentZoomNow = fit.width / currentView.w
    const nextZoom = Math.min(MAX_ZOOM, Math.max(1, nextZoomRaw))
    if (nextZoom <= 1.001) {
      setZoom(1)
      setManualCenter(null)
      return
    }
    setZoom(nextZoom)
    if (anchor) {
      const center = { x: currentView.x + currentView.w / 2, y: currentView.y + currentView.h / 2 }
      setManualCenter(clampCenter({
        x: anchor.x - (anchor.x - center.x) * (currentZoomNow / nextZoom),
        y: anchor.y - (anchor.y - center.y) * (currentZoomNow / nextZoom),
      }, nextZoom))
    } else if (manualCenterRef.current) {
      setManualCenter(clampCenter(manualCenterRef.current, nextZoom))
    }
  }, [clampCenter])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    svgRef.current?.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 1) movedRef.current = 0
    draggingRef.current = true
    setDragging(true)
  }, [])

  const handlePointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    const entry = pointersRef.current.get(event.pointerId)
    if (!entry) return
    const previous = { x: entry.x, y: entry.y }
    entry.x = event.clientX
    entry.y = event.clientY
    const metrics = stageMetrics()
    if (!metrics) return
    const pointers = [...pointersRef.current.values()]

    if (pointers.length === 1) {
      const dx = (event.clientX - previous.x) / metrics.scale
      const dy = (event.clientY - previous.y) / metrics.scale
      if (dx === 0 && dy === 0) return
      movedRef.current += Math.abs(event.clientX - previous.x) + Math.abs(event.clientY - previous.y)
      if (movedRef.current > 6) setFocusCode(null)
      const zoomNow = fitRef.current ? fitRef.current.width / metrics.view.w : 1
      setManualCenter(clampCenter({
        x: metrics.view.x + metrics.view.w / 2 - dx,
        y: metrics.view.y + metrics.view.h / 2 - dy,
      }, zoomNow))
      return
    }

    if (pointers.length === 2) {
      movedRef.current = 100
      setFocusCode(null)
      const [a, b] = pointers
      const previousA = a === entry ? previous : a
      const previousB = b === entry ? previous : b
      const previousSpan = Math.max(1, Math.hypot(previousA.x - previousB.x, previousA.y - previousB.y))
      const span = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const anchor = toUserPoint(middle.x, middle.y)
      const zoomNow = fitRef.current ? fitRef.current.width / metrics.view.w : 1
      if (anchor) applyZoomAt(zoomNow * (span / previousSpan), anchor)
    }
  }, [applyZoomAt, clampCenter, stageMetrics, toUserPoint])

  const releasePointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size === 0) {
      draggingRef.current = false
      setDragging(false)
      suppressClickRef.current = movedRef.current > 6
    }
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const fit = fitRef.current
      const currentView = renderViewRef.current
      if (!fit || !currentView) return
      const delta = event.deltaMode === 1 ? event.deltaY * 20 : event.deltaY
      const factor = Math.exp(-delta * (event.ctrlKey ? 0.008 : 0.0019))
      const anchor = toUserPoint(event.clientX, event.clientY)
      applyZoomAt((fit.width / currentView.w) * factor, anchor)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [applyZoomAt, toUserPoint])

  const zoomBy = useCallback((factor: number) => {
    const fit = fitRef.current
    const currentView = renderViewRef.current
    if (!fit || !currentView) return
    const nextZoom = Math.min(MAX_ZOOM, Math.max(1, (fit.width / currentView.w) * factor))
    if (nextZoom <= 1.001) {
      setZoom(1)
      setManualCenter(null)
      return
    }
    setZoom(nextZoom)
    if (manualCenterRef.current) setManualCenter(clampCenter(manualCenterRef.current, nextZoom))
  }, [clampCenter])

  const recenter = useCallback(() => {
    if (manualCenterRef.current === null) setZoom(1)
    else setManualCenter(null)
  }, [])

  // --- Render ------------------------------------------------------------

  const paths = useMemo(
    () => (geometry ? sortedNetworkPaths(geometry.networkPaths) : []),
    [geometry]
  )

  const networkLayer = useMemo(() => geometry && (
    <g className="live-map-network" aria-hidden="true">
      <g className="live-map-network-casings">
        {paths.map(path => (
          <path key={`case-${path.id}`} d={path.d} className="live-map-network-casing" />
        ))}
      </g>
      <g className="live-map-network-colors">
        {paths.map(path => (
          <path
            key={path.id}
            d={path.d}
            className="live-map-network-line"
            stroke={LINE_COLORS[path.line].bg}
          />
        ))}
      </g>
      <g className="live-map-network-stations">
        {geometry.networkStations.filter(station => !station.isOnRoute).map(station => (
          <circle
            key={station.code}
            className={station.isInterchange
              ? 'live-map-context-station is-interchange'
              : 'live-map-context-station'}
            cx={station.x}
            cy={station.y}
            r={station.isInterchange ? 5 : 2.6}
          />
        ))}
      </g>
    </g>
  ), [geometry, paths])

  if (!geometry || !view) {
    return (
      <div className="live-map-unavailable is-inline" role="status">
        <span aria-hidden="true" /> The schematic is updating…
      </div>
    )
  }

  const fit = geometry.viewBox
  const centerX = fit.x + fit.width / 2
  const lineColor = LINE_COLORS[train.line].bg
  const destination = geometry.routeStations.find(station => station.code === train.to.code)
  const origin = geometry.routeStations.find(station => station.code === train.from.code)
  const nextStation = geometry.routeStations.find(station => station.code === train.nextStop?.code)
  const stationIsNearTrain = (station: SchematicRouteStation | undefined, radius: number) => Boolean(
    trainPoint
    && station
    && Math.hypot(trainPoint.x - station.x, trainPoint.y - station.y) < radius
  )
  const isLivePosition = train.position?.source === 'vehicle'
  const positionKind = isLivePosition ? 'live train' : 'estimated train position'
  const description = train.position && train.previousStop && train.nextStop
    ? `The ${positionKind} is between ${train.previousStop.name} and ${train.nextStop.name}, heading toward ${train.toward}.`
    : train.position
      ? `The ${positionKind} is on the ${train.line} Line, heading toward ${train.toward}.`
      : `Live position is temporarily unavailable for the train heading toward ${train.toward}.`

  const stationPassed = (station: SchematicRouteStation) => (
    tripDrawDistance > station.distance + PASSED_SLACK
  )

  const obstacles: LabelRect[] = []
  if (trainPoint) {
    obstacles.push({
      left: trainPoint.x - 28,
      right: trainPoint.x + 28,
      top: trainPoint.y - 24,
      bottom: trainPoint.y + 24,
    })
  }
  if (destination) {
    obstacles.push({
      left: destination.x - 18,
      right: destination.x + 18,
      top: destination.y - 18,
      bottom: destination.y + 18,
    })
  }

  const planner = new LabelPlanner(fit, centerX, obstacles)
  const plannedLabels: Array<{
    station: SchematicRouteStation
    kicker: string
    emphasized: boolean
    placement: LabelPlacement
  }> = []
  const planLabel = (
    station: SchematicRouteStation,
    kicker: string,
    options: { emphasized?: boolean; preferSide?: 'start' | 'end'; distance?: number } = {}
  ) => {
    plannedLabels.push({
      station,
      kicker,
      emphasized: options.emphasized ?? false,
      placement: planner.place(station, options),
    })
  }

  if (destination) {
    planLabel(
      destination,
      train.ended ? 'ARRIVED' : transferName && train.leg === 1 ? 'CHANGE HERE' : 'DESTINATION',
      { emphasized: true, distance: 24 }
    )
  }
  if (nextStation && nextStation.code !== destination?.code && !train.ended) {
    planLabel(nextStation, nextStation.code === train.from.code ? 'STARTS HERE' : 'NEXT STOP', {
      emphasized: true,
      preferSide: trainPoint && trainPoint.x > nextStation.x ? 'end' : 'start',
    })
  }
  const trainNearOrigin = stationIsNearTrain(origin, 46)
  if (origin && !trainNearOrigin && origin.code !== nextStation?.code) {
    planLabel(origin, 'START', { preferSide: 'end', distance: 20 })
  }
  for (const station of geometry.routeStations) {
    if (!station.isJunction) continue
    if (station.code === origin?.code || station.code === destination?.code) continue
    if (station.code === nextStation?.code) continue
    if (stationIsNearTrain(station, 52)) continue
    planLabel(station, 'TRANSFER')
  }

  const majorLabelCodes = new Set(plannedLabels.map(item => item.station.code))
  if (origin) majorLabelCodes.add(origin.code)
  if (destination) majorLabelCodes.add(destination.code)

  const minorLabels = currentZoom >= MINOR_LABEL_ZOOM
    ? geometry.routeStations
        .filter(station => !majorLabelCodes.has(station.code))
        .flatMap(station => {
          const placement = planner.tryPlaceMinor(station)
          return placement ? [{ station, placement }] : []
        })
    : []

  const focusStation = focusCode
    ? geometry.routeStations.find(station => station.code === focusCode) ?? null
    : null
  const focusStatus = focusStation
    ? focusStation.code === train.to.code
      ? transferName && train.leg === 1 ? 'Transfer here' : 'Final destination'
      : focusStation.code === train.nextStop?.code
        ? clockTime(train.nextStop?.expectedAtMs)
          ? `Next stop · expected ${clockTime(train.nextStop?.expectedAtMs)}`
          : 'Next stop'
        : focusStation.code === train.from.code && !stationPassed(focusStation)
          ? 'Trip start'
          : stationPassed(focusStation) ? 'Passed' : 'Coming up'
    : null
  const focusScreen = (() => {
    if (!focusStation) return null
    const metrics = stageMetrics()
    if (!metrics) return null
    const inView = focusStation.x >= metrics.view.x
      && focusStation.x <= metrics.view.x + metrics.view.w
      && focusStation.y >= metrics.view.y
      && focusStation.y <= metrics.view.y + metrics.view.h
    if (!inView) return null
    return {
      left: metrics.offsetX + (focusStation.x - metrics.view.x) * metrics.scale,
      top: metrics.offsetY + (focusStation.y - metrics.view.y) * metrics.scale,
    }
  })()

  return (
    <div
      className="live-map-stage"
      ref={stageRef}
      style={{ '--route-color': lineColor } as CSSProperties}
    >
      <svg
        ref={svgRef}
        className={dragging ? 'live-map-svg is-dragging' : 'live-map-svg'}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releasePointer}
        onPointerCancel={releasePointer}
        onDoubleClick={event => {
          const anchor = toUserPoint(event.clientX, event.clientY)
          if (anchor) applyZoomAt(currentZoom * 1.8, anchor)
        }}
      >
        <title id={`${id}-title`}>{train.line} Line live train schematic</title>
        <desc id={`${id}-description`}>{description}</desc>

        {networkLayer}

        {geometry.approachPath && (
          <g className="live-map-approach" aria-hidden="true">
            <path d={geometry.approachPath} className="live-map-approach-casing" />
            <path
              d={geometry.approachPath}
              className="live-map-approach-line"
              stroke={lineColor}
            />
          </g>
        )}

        <g className="live-map-route" aria-hidden="true">
          <path d={geometry.routePath} className="live-map-route-casing" />
          <path
            d={geometry.routePath}
            className="live-map-route-line"
            stroke={lineColor}
          />
          {tripDrawDistance > 1 && (
            <path
              d={geometry.routePath}
              className="live-map-route-complete"
              pathLength={geometry.routeLength}
              strokeDasharray={`${tripDrawDistance} ${geometry.routeLength}`}
            />
          )}
        </g>

        <g className="live-map-stations" aria-hidden="true">
          {geometry.routeStations.map(station => {
            const isNext = station.code === train.nextStop?.code && !train.ended
            const isEndpoint = station.code === train.from.code || station.code === train.to.code
            const isInterchange = station.isJunction
            return (
              <g key={station.code}>
                {isNext && <circle className="live-map-next-ring" cx={station.x} cy={station.y} r="12" />}
                <circle
                  className={[
                    'live-map-station',
                    isEndpoint ? 'is-endpoint' : '',
                    isInterchange ? 'is-interchange' : '',
                    stationPassed(station) && station.code !== train.to.code ? 'is-passed' : '',
                  ].filter(Boolean).join(' ')}
                  cx={station.x}
                  cy={station.y}
                  r={isEndpoint ? 7 : isInterchange ? 6 : 4}
                />
              </g>
            )
          })}

          {minorLabels.map(({ station, placement }) => (
            <text
              key={`minor-${station.code}`}
              className="live-map-minor-label"
              x={placement.x}
              y={placement.labelY}
              textAnchor={placement.anchor}
            >
              {station.name}
            </text>
          ))}

          {plannedLabels.map(({ station, kicker, emphasized, placement }) => (
            <g
              key={`label-${station.code}`}
              className={emphasized ? 'live-map-node-copy is-emphasized' : 'live-map-node-copy'}
            >
              <text
                x={placement.x}
                y={placement.kickerY}
                textAnchor={placement.anchor}
                className="live-map-node-kicker"
              >
                {kicker}
              </text>
              <text
                x={placement.x}
                y={placement.labelY}
                textAnchor={placement.anchor}
                className="live-map-node-label"
              >
                {station.name}
              </text>
            </g>
          ))}

          {destination && (
            <>
              <circle
                className={train.ended
                  ? 'live-map-destination-ring is-arrived'
                  : 'live-map-destination-ring'}
                cx={destination.x}
                cy={destination.y}
                r="16"
              />
              <circle cx={destination.x} cy={destination.y} r="10" fill={lineColor} />
              <text
                x={destination.x}
                y={destination.y + 4}
                textAnchor="middle"
                className="live-map-line-letter"
              >
                {lineLetter(train.line)}
              </text>
            </>
          )}

          <g className="live-map-hits">
            {geometry.routeStations.map(station => (
              <circle
                key={`hit-${station.code}`}
                className="live-map-hit"
                cx={station.x}
                cy={station.y}
                r="15"
                onPointerEnter={event => {
                  if (event.pointerType === 'mouse') setFocusCode(station.code)
                }}
                onPointerLeave={event => {
                  if (event.pointerType === 'mouse') {
                    setFocusCode(code => (code === station.code ? null : code))
                  }
                }}
                onClick={() => {
                  if (suppressClickRef.current) return
                  setFocusCode(code => (code === station.code ? null : station.code))
                }}
              />
            ))}
          </g>
        </g>

        {trainPoint && (
          <g
            className="live-map-train"
            transform={`translate(${trainPoint.x} ${trainPoint.y})`}
            aria-hidden="true"
          >
            <circle className="live-map-train-ring" r="16" stroke={lineColor} />
            <g transform={`rotate(${trainBearing})`}>
              <path className="live-map-train-tail" d="M 10 -6.5 L 21.5 0 L 10 6.5 Z" />
            </g>
            <circle className="live-map-train-casing" r="15" />
            <circle className="live-map-train-band" r="13.5" />
            <circle className="live-map-train-disc" r="10.5" fill={lineColor} />
            <g fill={markerInk(train.line)} transform="scale(0.5)">
              <rect x="-10" y="-12" width="20" height="21" rx="6" />
              <rect x="-6.5" y="-8" width="5" height="5" rx="1" fill={lineColor} />
              <rect x="1.5" y="-8" width="5" height="5" rx="1" fill={lineColor} />
              <circle cx="-6" cy="5" r="1.7" fill={lineColor} />
              <circle cx="6" cy="5" r="1.7" fill={lineColor} />
            </g>
          </g>
        )}
      </svg>

      <div className="live-map-controls" role="group" aria-label="Map controls">
        <button
          type="button"
          onClick={() => zoomBy(1.5)}
          aria-label="Zoom in"
          disabled={currentZoom >= MAX_ZOOM - 0.01}
        >
          <Plus aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.5)}
          aria-label="Zoom out"
          disabled={currentZoom <= 1.01}
        >
          <Minus aria-hidden="true" />
        </button>
        <button
          type="button"
          className={following ? 'is-active' : ''}
          onClick={recenter}
          aria-label={following ? 'Fit the whole trip' : 'Follow the train'}
          aria-pressed={following}
        >
          <LocateFixed aria-hidden="true" />
        </button>
      </div>

      {focusStation && focusScreen && (
        <div
          className="live-map-tooltip"
          style={{ left: focusScreen.left, top: focusScreen.top }}
          role="status"
        >
          <strong>{focusStation.name}</strong>
          {focusStatus && <span>{focusStatus}</span>}
          {focusStation.lines.length > 0 && (
            <span className="live-map-tooltip-lines" aria-hidden="true">
              {focusStation.lines.map(line => (
                <i key={line} style={{ backgroundColor: LINE_COLORS[line].bg, color: LINE_COLORS[line].text }}>
                  {lineLetter(line)}
                </i>
              ))}
            </span>
          )}
        </div>
      )}

      {(positionUnavailable || (!trainPoint && !train.ended)) && (
        <div className="live-map-unavailable" role="status">
          <span aria-hidden="true" /> Reconnecting to the train…
        </div>
      )}
      <div className="live-map-scale-note" aria-hidden="true">METRO SCHEMATIC · NOT TO SCALE</div>
    </div>
  )
}
