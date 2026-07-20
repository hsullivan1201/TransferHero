import {
  useCallback,
  useEffect,
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
import { LINE_NAMES } from './liveTrackerFormat'
import {
  bearingAtDistance,
  buildLiveMapGeometry,
  pointAtDistance,
  type LiveMapGeometry,
  type LiveMapTrain,
  type SchematicApproachStation,
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

type MapFocus =
  | { kind: 'station'; code: string }
  | { kind: 'train' }
  | { kind: 'ghost'; id: string }

const MAX_ZOOM = 4
const MINOR_LABEL_ZOOM = 1.55
const LABEL_MARGIN = 14
const PASSED_SLACK = 8
/** Labels re-plan only when the train moves a full cell, so they stay put. */
const PLAN_GRID = 22

const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform)

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
  return Math.max(56, name.length * (emphasized ? 9 : 7.8) + 8)
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
    station: SchematicPoint,
    name: string,
    options: { emphasized?: boolean; preferSide?: 'start' | 'end'; distance?: number } = {}
  ): LabelPlacement {
    const emphasized = options.emphasized ?? false
    const gap = options.distance ?? 18
    const width = estimateLabelWidth(name, emphasized)
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
  tryPlaceMinor(station: SchematicPoint, name: string): LabelPlacement | null {
    const width = Math.max(40, name.length * 6.4)
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

  /** Claim an arbitrary rect (e.g. a time chip) when the spot is free. */
  tryClaim(rect: LabelRect): boolean {
    if (!this.fitsFrame(rect)) return false
    if (this.occupied.some(other => rectsIntersect(rect, other))) return false
    this.occupied.push(rect)
    return true
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
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [wheelHint, setWheelHint] = useState(false)
  const wheelHintTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setZoom(1)
    setManualCenter(null)
    setFocus(null)
  }, [routeKey])

  useEffect(() => () => window.clearTimeout(wheelHintTimer.current), [])

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

  // --- Gestures: drag to pan, pinch to zoom, ⌘/Ctrl-wheel zoom, double-tap.
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

  // The pointer is captured only once a real drag starts: capturing on
  // pointerdown would retarget the tap's click event to the svg root and
  // silently swallow station and train taps.
  const capturePointer = useCallback((pointerId: number) => {
    const svg = svgRef.current
    if (!svg || svg.hasPointerCapture(pointerId)) return
    try {
      svg.setPointerCapture(pointerId)
    } catch {
      // The pointer may already be gone; dragging just ends at the edge.
    }
  }, [])

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size === 1) movedRef.current = 0
    if (pointersRef.current.size === 2) {
      for (const pointerId of pointersRef.current.keys()) capturePointer(pointerId)
    }
    draggingRef.current = true
    setDragging(true)
  }, [capturePointer])

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
      if (movedRef.current > 6) {
        capturePointer(event.pointerId)
        setFocus(null)
      }
      const zoomNow = fitRef.current ? fitRef.current.width / metrics.view.w : 1
      setManualCenter(clampCenter({
        x: metrics.view.x + metrics.view.w / 2 - dx,
        y: metrics.view.y + metrics.view.h / 2 - dy,
      }, zoomNow))
      return
    }

    if (pointers.length === 2) {
      movedRef.current = 100
      setFocus(null)
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
  }, [applyZoomAt, capturePointer, clampCenter, stageMetrics, toUserPoint])

  const releasePointer = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size === 0) {
      draggingRef.current = false
      setDragging(false)
      suppressClickRef.current = movedRef.current > 6
    }
  }, [])

  // ⌘/Ctrl-wheel (and trackpad pinch) zooms; a bare wheel keeps scrolling the
  // page and briefly shows a hint instead of hijacking the gesture.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        setWheelHint(true)
        window.clearTimeout(wheelHintTimer.current)
        wheelHintTimer.current = window.setTimeout(() => setWheelHint(false), 1500)
        return
      }
      event.preventDefault()
      const fit = fitRef.current
      const currentView = renderViewRef.current
      if (!fit || !currentView) return
      const delta = event.deltaMode === 1 ? event.deltaY * 20 : event.deltaY
      const factor = Math.exp(-delta * 0.008)
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

  // Tapping the train zooms in on it and follows it; once close, taps just
  // toggle the info card.
  const focusTrain = useCallback(() => {
    if (suppressClickRef.current) return
    const fit = fitRef.current
    const currentView = renderViewRef.current
    const zoomNow = fit && currentView ? fit.width / currentView.w : 1
    focusFromTapRef.current = true
    if (zoomNow < 2.2) {
      setZoom(2.4)
      setManualCenter(null)
      setFocus({ kind: 'train' })
      return
    }
    setFocus(current => (current?.kind === 'train' ? null : { kind: 'train' }))
  }, [])

  // A card opened by tap stays open until the next tap or drag; hover-opened
  // cards follow the cursor. Without this, tapping the train would zoom, the
  // marker would recenter out from under the cursor, and the card would close.
  const focusFromTapRef = useRef(false)

  const toggleFocus = useCallback((next: MapFocus) => {
    if (suppressClickRef.current) return
    focusFromTapRef.current = true
    setFocus(current => (
      current && JSON.stringify(current) === JSON.stringify(next) ? null : next
    ))
  }, [])

  const hoverFocus = useCallback((next: MapFocus | null, pointerType: string) => {
    if (pointerType !== 'mouse') return
    focusFromTapRef.current = false
    setFocus(current => {
      if (next) return next
      return current
    })
  }, [])

  const hoverLeave = useCallback((leaving: MapFocus, pointerType: string) => {
    if (pointerType !== 'mouse') return
    if (focusFromTapRef.current) return
    setFocus(current => (
      current && JSON.stringify(current) === JSON.stringify(leaving) ? null : current
    ))
  }, [])

  // --- Annotations: stations, rings, labels, hit targets ------------------
  // Re-planned only on discrete changes (a station flips to passed, the train
  // crosses a planning cell, zoom crosses the minor-label threshold), never
  // per animation frame — labels stay put while the train glides.

  const approachActive = Boolean(geometry?.approachPath) && !train.ended
  const approachNextCode = approachActive ? train.approach?.nextStop?.code ?? null : null
  const minorZoom = currentZoom >= MINOR_LABEL_ZOOM
  const deepZoom = currentZoom >= 2.1
  const boardsAtMs = train.phase === 'not_started' ? train.nextStop?.expectedAtMs ?? null : null
  const boardsInMinutes = boardsAtMs != null
    ? Math.max(0, Math.ceil((boardsAtMs - Date.now()) / 60_000))
    : null
  const timesKey = deepZoom && train.stopTimes
    ? train.stopTimes.map(time => (time == null ? '' : Math.round(time / 60_000))).join(',')
    : ''
  const planPoint = trainPoint
    ? {
        x: Math.round(trainPoint.x / PLAN_GRID) * PLAN_GRID,
        y: Math.round(trainPoint.y / PLAN_GRID) * PLAN_GRID,
      }
    : null
  const tripPassedCount = geometry
    ? geometry.routeStations.reduce(
        (count, station) => count + (tripDrawDistance > station.distance + PASSED_SLACK ? 1 : 0),
        0
      )
    : 0
  const approachPassedCount = geometry && approachActive
    ? geometry.approachStations.reduce(
        (count, station) => count + (drawDistance > station.distance + PASSED_SLACK ? 1 : 0),
        0
      )
    : 0

  const annotations = useMemo(() => {
    if (!geometry) return null
    const fit = geometry.viewBox
    const centerX = fit.x + fit.width / 2
    const lineColor = LINE_COLORS[train.line].bg
    const destination = geometry.routeStations.find(station => station.code === train.to.code)
    const origin = geometry.routeStations.find(station => station.code === train.from.code)
    const nextStation = geometry.routeStations.find(station => station.code === train.nextStop?.code)
    const approachNextStation = approachNextCode
      ? geometry.approachStations.find(station => station.code === approachNextCode)
        ?? (approachNextCode === train.from.code ? origin : undefined)
      : undefined
    const tripPassed = (station: SchematicRouteStation) => (
      tripDrawDistance > station.distance + PASSED_SLACK
    )
    const approachPassed = (station: SchematicApproachStation) => (
      drawDistance > station.distance + PASSED_SLACK
    )
    const nearTrain = (station: SchematicPoint | undefined, radius: number) => Boolean(
      planPoint && station && Math.hypot(planPoint.x - station.x, planPoint.y - station.y) < radius
    )

    const obstacles: LabelRect[] = []
    if (planPoint) {
      obstacles.push({
        left: planPoint.x - 30,
        right: planPoint.x + 30,
        top: planPoint.y - 26,
        bottom: planPoint.y + 26,
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
      key: string
      x: number
      y: number
      name: string
      kicker: string
      emphasized: boolean
      placement: LabelPlacement
    }> = []
    const planLabel = (
      station: SchematicPoint & { code: string; name: string },
      kicker: string,
      options: { emphasized?: boolean; preferSide?: 'start' | 'end'; distance?: number } = {}
    ) => {
      plannedLabels.push({
        key: station.code,
        x: station.x,
        y: station.y,
        name: station.name,
        kicker,
        emphasized: options.emphasized ?? false,
        placement: planner.place(station, station.name, options),
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
      const isBoarding = nextStation.code === train.from.code
      const boardingKicker = boardsInMinutes == null
        ? 'STARTS HERE'
        : boardsInMinutes <= 0 ? 'BOARDS NOW' : `BOARDS IN ${boardsInMinutes} MIN`
      planLabel(nextStation, isBoarding ? boardingKicker : 'NEXT STOP', {
        emphasized: true,
        preferSide: planPoint && planPoint.x > nextStation.x ? 'end' : 'start',
      })
    }
    if (
      approachNextStation
      && approachNextStation.code !== train.from.code
      && approachNextStation.code !== nextStation?.code
    ) {
      planLabel(approachNextStation, 'NEXT STOP', {
        emphasized: true,
        preferSide: planPoint && planPoint.x > approachNextStation.x ? 'end' : 'start',
      })
    }
    if (origin && !nearTrain(origin, 46) && origin.code !== nextStation?.code) {
      planLabel(origin, 'START', { preferSide: 'end', distance: 20 })
    }

    const labeledCodes = new Set(plannedLabels.map(item => item.key))
    const secondaryLabels: Array<{
      key: string
      name: string
      placement: LabelPlacement
    }> = []
    const planSecondary = (station: SchematicPoint & { code: string; name: string }) => {
      if (labeledCodes.has(station.code) || nearTrain(station, 34)) return
      const placement = planner.tryPlaceMinor(station, station.name)
      if (placement) {
        labeledCodes.add(station.code)
        secondaryLabels.push({ key: station.code, name: station.name, placement })
      }
    }
    // Junctions read as quiet name labels at every zoom; everything else joins
    // once the rider zooms in.
    for (const station of geometry.routeStations) {
      if (station.isJunction) planSecondary(station)
    }
    if (minorZoom) {
      for (const station of geometry.routeStations) planSecondary(station)
      for (const station of geometry.approachStations) planSecondary(station)
    }

    const ringStation = approachActive
      ? approachNextStation ?? null
      : nextStation && !train.ended ? nextStation : null

    // Deep zoom turns the diagram into a timetable strip: each upcoming stop
    // shows its live-predicted arrival time when the spot below the dot is free.
    const timeLabels: Array<{ code: string; x: number; y: number; text: string }> = []
    if (deepZoom && train.stopTimes) {
      const timeByCode = new Map<string, number>()
      train.routeStationCodes.forEach((code, index) => {
        const time = train.stopTimes?.[index]
        if (time != null) timeByCode.set(code, time)
      })
      for (const station of geometry.routeStations) {
        if (tripPassed(station)) continue
        const time = timeByCode.get(station.code)
        const text = clockTime(time)?.replace(/\s?(AM|PM)$/iu, '')
        if (!text) continue
        const rect = {
          left: station.x - 17,
          right: station.x + 17,
          top: station.y + 10,
          bottom: station.y + 24,
        }
        if (!planner.tryClaim(rect)) continue
        timeLabels.push({ code: station.code, x: station.x, y: station.y + 21, text })
      }
    }

    const track = (
      <>
        {geometry.approachPath && (
          <g className="live-map-approach" aria-hidden="true">
            <path d={geometry.approachPath} className="live-map-approach-casing" />
            <path
              d={geometry.approachPath}
              className="live-map-approach-line"
              stroke={lineColor}
            />
            {geometry.approachStations.map(station => (
              <circle
                key={`approach-${station.code}`}
                className={approachPassed(station)
                  ? 'live-map-approach-station is-passed'
                  : 'live-map-approach-station'}
                cx={station.x}
                cy={station.y}
                r="3.2"
              />
            ))}
          </g>
        )}

        <g className="live-map-route" aria-hidden="true">
          <path d={geometry.routePath} className="live-map-route-casing" />
          <path
            d={geometry.routePath}
            className="live-map-route-line"
            stroke={lineColor}
          />
        </g>
      </>
    )

    const overlay = (
      <>
        <g className="live-map-stations" aria-hidden="true">
          {ringStation && (
            <circle className="live-map-next-ring" cx={ringStation.x} cy={ringStation.y} r="12" />
          )}
          {geometry.routeStations.map(station => {
            const isEndpoint = station.code === train.from.code || station.code === train.to.code
            const isInterchange = station.isJunction
            return (
              <circle
                key={station.code}
                className={[
                  'live-map-station',
                  isEndpoint ? 'is-endpoint' : '',
                  isInterchange ? 'is-interchange' : '',
                  tripPassed(station) && station.code !== train.to.code ? 'is-passed' : '',
                ].filter(Boolean).join(' ')}
                cx={station.x}
                cy={station.y}
                r={isEndpoint ? 7 : isInterchange ? 6 : 4}
              />
            )
          })}

          {timeLabels.map(({ code, x, y, text }) => (
            <text
              key={`time-${code}`}
              className="live-map-time-label"
              x={x}
              y={y}
              textAnchor="middle"
            >
              {text}
            </text>
          ))}

          {secondaryLabels.map(({ key, name, placement }) => (
            <text
              key={`minor-${key}`}
              className="live-map-minor-label"
              x={placement.x}
              y={placement.labelY}
              textAnchor={placement.anchor}
            >
              {name}
            </text>
          ))}

          {plannedLabels.map(({ key, kicker, name, emphasized, placement }) => (
            <g
              key={`label-${key}`}
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
                {name}
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
        </g>

        <g className="live-map-hits">
          {[...geometry.routeStations, ...geometry.approachStations].map(station => (
            <circle
              key={`hit-${station.code}`}
              className="live-map-hit"
              cx={station.x}
              cy={station.y}
              r="15"
              onPointerEnter={event => hoverFocus({ kind: 'station', code: station.code }, event.pointerType)}
              onPointerLeave={event => hoverLeave({ kind: 'station', code: station.code }, event.pointerType)}
              onClick={() => toggleFocus({ kind: 'station', code: station.code })}
            />
          ))}
        </g>
      </>
    )

    return { track, overlay }
  }, [
    geometry,
    approachActive,
    approachNextCode,
    minorZoom,
    deepZoom,
    boardsInMinutes,
    timesKey,
    planPoint?.x,
    planPoint?.y,
    tripPassedCount,
    approachPassedCount,
    hoverFocus,
    hoverLeave,
    toggleFocus,
    train.ended,
    train.leg,
    train.line,
    train.from.code,
    train.to.code,
    train.nextStop?.code,
    transferName,
  ])

  // Every other live train on the line rides the schematic as a quiet ghost:
  // dimmer than the rider's train, extra-dim when headed the other way, but
  // still hoverable and tappable for a quick "what's that train" card.
  const ghostLayer = useMemo(() => {
    if (!geometry || train.ended || geometry.ghostTrains.length === 0) return null
    const visible = geometry.ghostTrains.filter(ghost => (
      !planPoint || Math.hypot(ghost.x - planPoint.x, ghost.y - planPoint.y) >= 32
    ))
    if (visible.length === 0) return null
    const lineColor = LINE_COLORS[train.line].bg
    return {
      visuals: (
        <g className="live-map-ghosts" aria-hidden="true">
          {visible.map(ghost => (
            <g
              key={ghost.id}
              className={ghost.sameDirection === false
                ? 'live-map-ghost-train is-opposite'
                : 'live-map-ghost-train'}
              style={{ transform: `translate(${ghost.x}px, ${ghost.y}px)` }}
            >
              <circle className="live-map-ghost-casing" r="6.5" />
              <circle className="live-map-ghost-disc" r="5" fill={lineColor} />
            </g>
          ))}
        </g>
      ),
      hits: (
        <g className="live-map-hits">
          {visible.map(ghost => (
            <circle
              key={`ghost-hit-${ghost.id}`}
              className="live-map-hit"
              cx={ghost.x}
              cy={ghost.y}
              r="12"
              onPointerEnter={event => hoverFocus({ kind: 'ghost', id: ghost.id }, event.pointerType)}
              onPointerLeave={event => hoverLeave({ kind: 'ghost', id: ghost.id }, event.pointerType)}
              onClick={() => toggleFocus({ kind: 'ghost', id: ghost.id })}
            />
          ))}
        </g>
      ),
    }
  }, [geometry, hoverFocus, hoverLeave, planPoint?.x, planPoint?.y, toggleFocus, train.ended, train.line])

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

  const lineColor = LINE_COLORS[train.line].bg
  const isLivePosition = train.position?.source === 'vehicle'
  const positionKind = isLivePosition ? 'live train' : 'estimated train position'
  const description = train.position && train.previousStop && train.nextStop
    ? `The ${positionKind} is between ${train.previousStop.name} and ${train.nextStop.name}, heading toward ${train.toward}.`
    : train.position
      ? `The ${positionKind} is on the ${train.line} Line, heading toward ${train.toward}.`
      : `Live position is temporarily unavailable for the train heading toward ${train.toward}.`

  // --- Tooltip -----------------------------------------------------------

  const focusTarget = (() => {
    if (!focus) return null
    if (focus.kind === 'train') {
      if (!trainPoint) return null
      const inboundNext = train.approach?.nextStop
      const status = train.phase === 'not_started'
        ? inboundNext
          ? `Inbound · next stop ${inboundNext.name}`
          : `Departs ${train.from.name} soon`
        : train.phase === 'at_station'
          ? `At ${train.previousStop?.name ?? train.from.name}`
          : train.previousStop && train.nextStop
            ? `Between ${train.previousStop.name} and ${train.nextStop.name}`
            : `Heading toward ${train.toward}`
      const arrives = train.eta ? clockTime(train.eta.arrivalAtMs) : null
      const moving = train.phase === 'in_transit' || train.phase === 'arriving' || train.phase === 'not_started'
      const speedMph = moving ? train.position?.speedMph ?? null : null
      const detail = [
        isLivePosition ? 'Live position' : 'Estimated position',
        speedMph != null && speedMph >= 3 ? `~${speedMph} mph` : null,
        arrives ? `arrives ${train.to.name} ${arrives}` : null,
      ].filter(Boolean).join(' · ')
      return {
        point: trainPoint,
        title: `${LINE_NAMES[train.line]} Line · toward ${train.toward}`,
        status,
        detail,
        lines: null as Line[] | null,
      }
    }
    if (focus.kind === 'ghost') {
      const ghost = geometry.ghostTrains.find(item => item.id === focus.id)
      if (!ghost) return null
      const stationName = geometry.routeStations.find(item => item.code === ghost.code)?.name
        ?? geometry.approachStations.find(item => item.code === ghost.code)?.name
        ?? mapData.stations.find(item => item.code === ghost.code)?.name
        ?? ghost.code
      const direction = ghost.sameDirection === true
        ? `Same direction${ghost.toward ? ` · toward ${ghost.toward}` : ''}`
        : ghost.sameDirection === false
          ? `Opposite direction${ghost.toward ? ` · toward ${ghost.toward}` : ''}`
          : null
      return {
        point: { x: ghost.x, y: ghost.y },
        title: `${LINE_NAMES[train.line]} Line train`,
        status: ghost.approaching ? `Approaching ${stationName}` : `At ${stationName}`,
        detail: direction,
        lines: null as Line[] | null,
      }
    }
    const station = geometry.routeStations.find(item => item.code === focus.code)
      ?? geometry.approachStations.find(item => item.code === focus.code)
      ?? null
    if (!station) return null
    const isApproachStation = !geometry.routeStations.some(item => item.code === focus.code)
    const status = isApproachStation
      ? focus.code === approachNextCode
        ? `Next stop · expected ${clockTime(train.approach?.nextStop?.expectedAtMs) ?? 'soon'}`
        : drawDistance > (station as SchematicApproachStation).distance + PASSED_SLACK
          ? 'Passed'
          : 'On the way in'
      : focus.code === train.to.code
        ? transferName && train.leg === 1 ? 'Transfer here' : 'Final destination'
        : focus.code === train.nextStop?.code && !approachActive
          ? clockTime(train.nextStop?.expectedAtMs)
            ? `Next stop · expected ${clockTime(train.nextStop?.expectedAtMs)}`
            : 'Next stop'
          : focus.code === train.from.code
            ? approachActive ? `Boards here${clockTime(train.nextStop?.expectedAtMs) ? ` · ${clockTime(train.nextStop?.expectedAtMs)}` : ''}` : 'Trip start'
            : tripDrawDistance > (station as SchematicRouteStation).distance + PASSED_SLACK
              ? 'Passed'
              : 'Coming up'
    return {
      point: { x: station.x, y: station.y },
      title: station.name,
      status,
      detail: null as string | null,
      lines: station.lines,
    }
  })()

  const focusScreen = (() => {
    if (!focusTarget) return null
    const metrics = stageMetrics()
    if (!metrics) return null
    const { point } = focusTarget
    const inView = point.x >= metrics.view.x
      && point.x <= metrics.view.x + metrics.view.w
      && point.y >= metrics.view.y
      && point.y <= metrics.view.y + metrics.view.h
    if (!inView) return null
    return {
      left: metrics.offsetX + (point.x - metrics.view.x) * metrics.scale,
      top: metrics.offsetY + (point.y - metrics.view.y) * metrics.scale,
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
        aria-label={description}
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
        {networkLayer}
        {annotations?.track}

        {tripDrawDistance > 1 && (
          <path
            d={geometry.routePath}
            className="live-map-route-complete"
            pathLength={geometry.routeLength}
            strokeDasharray={`${tripDrawDistance} ${geometry.routeLength}`}
            aria-hidden="true"
          />
        )}

        {ghostLayer?.visuals}
        {annotations?.overlay}
        {ghostLayer?.hits}

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

        {trainPoint && (
          <circle
            className="live-map-hit is-train"
            cx={trainPoint.x}
            cy={trainPoint.y}
            r="22"
            onPointerEnter={event => hoverFocus({ kind: 'train' }, event.pointerType)}
            onPointerLeave={event => hoverLeave({ kind: 'train' }, event.pointerType)}
            onClick={focusTrain}
          />
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

      {focusTarget && focusScreen && (
        <div
          className={focus?.kind === 'train' ? 'live-map-tooltip is-train' : 'live-map-tooltip'}
          style={{ left: focusScreen.left, top: focusScreen.top }}
          role="status"
        >
          <strong>{focusTarget.title}</strong>
          {focusTarget.status && <span>{focusTarget.status}</span>}
          {focusTarget.detail && <span>{focusTarget.detail}</span>}
          {focusTarget.lines && focusTarget.lines.length > 0 && (
            <span className="live-map-tooltip-lines" aria-hidden="true">
              {focusTarget.lines.map(line => (
                <i key={line} style={{ backgroundColor: LINE_COLORS[line].bg, color: LINE_COLORS[line].text }}>
                  {lineLetter(line)}
                </i>
              ))}
            </span>
          )}
        </div>
      )}

      {wheelHint && (
        <div className="live-map-wheel-hint" role="status">
          Hold {IS_APPLE ? '⌘' : 'Ctrl'} and scroll to zoom
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
