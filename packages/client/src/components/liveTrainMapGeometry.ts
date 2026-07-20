import type { Line, MetroMapData } from '@transferhero/shared'
import {
  LINE_OFFSETS,
  PHYSICAL_STATION_GROUPS,
  SCHEMATIC_BENDS,
  SCHEMATIC_STATIONS,
  type SchematicPoint,
} from '../data/metroSchematic'

const VIEW_ASPECT = 820 / 570
const MIN_VIEW_WIDTH = 520
const MIN_VIEW_HEIGHT = 400
const CORNER_RADIUS = 16
const LONGITUDE_SCALE = Math.cos(38.9 * Math.PI / 180)
const NETWORK_JUNCTION_CODES = new Set([
  'A01',
  'B01', 'F01',
  'B06', 'E06',
  'C05', 'C07', 'C13',
  'D03', 'F03',
  'D08', 'K05',
])

interface GeoPoint {
  lat: number
  lon: number
}

export interface LiveMapStation extends GeoPoint {
  code: string
  name: string
}

export interface LiveMapApproach {
  /** Upstream station codes in travel order; the last code is the trip origin. */
  stationCodes: string[]
  previousStop: { code: string; name: string; expectedAtMs?: number | null } | null
  nextStop: { code: string; name: string; expectedAtMs?: number | null } | null
  progress: number
}

export interface LiveMapTrain {
  id: string
  leg: number
  line: Line
  toward: string
  from: LiveMapStation
  to: LiveMapStation
  routeStationCodes: string[]
  position: (GeoPoint & { bearing?: number | null; source?: string; speedMph?: number | null }) | null
  previousStop: { code: string; name: string } | null
  nextStop: { code: string; name: string; expectedAtMs?: number | null } | null
  progress: number | null
  phase: string
  approach?: LiveMapApproach | null
  eta?: { arrivalAtMs: number; minutes: number } | null
  /** Expected time at each stop, aligned with routeStationCodes. */
  stopTimes?: (number | null)[] | null
  /** Other live same-direction trains on the corridor. */
  otherTrains?: Array<{ id: string; code: string; approaching: boolean }> | null
  ended: boolean
}

export interface SchematicNetworkPath {
  id: string
  line: Line
  d: string
}

export interface SchematicStationNode extends SchematicPoint {
  code: string
  name: string
  lines: Line[]
  isInterchange: boolean
  isOnRoute: boolean
}

export interface SchematicRouteStation extends SchematicPoint {
  code: string
  name: string
  lines: Line[]
  isJunction: boolean
  /** Distance along the route polyline from the origin to this station. */
  distance: number
}

export interface SchematicApproachStation extends SchematicPoint {
  code: string
  name: string
  lines: Line[]
  /** Distance along the approach polyline from the window start. */
  distance: number
}

export interface LiveMapGeometry {
  networkPaths: SchematicNetworkPath[]
  networkStations: SchematicStationNode[]
  routeStations: SchematicRouteStation[]
  routePath: string
  routePoints: SchematicPoint[]
  routeLength: number
  /** Inbound track the train covers before the boarding station, when known. */
  approachPath: string | null
  approachLength: number
  /** Approach window stations, excluding the boarding station itself. */
  approachStations: SchematicApproachStation[]
  /** Approach polyline joined to the route polyline at the boarding station. */
  combinedPoints: SchematicPoint[]
  combinedLength: number
  /**
   * Marker distance in the combined space: the approach occupies
   * [0, approachLength] and the ride occupies the remainder.
   */
  progressDistance: number
  /** Whether a real (or interpolated) position exists for the marker. */
  hasPosition: boolean
  fromPoint: SchematicPoint
  toPoint: SchematicPoint
  viewBox: { x: number; y: number; width: number; height: number }
}

const physicalCodeGroup = new Map<string, readonly string[]>(
  PHYSICAL_STATION_GROUPS.flatMap(group => group.map(code => [code, group] as const))
)

function groupForCode(code: string): readonly string[] {
  return physicalCodeGroup.get(code) ?? [code]
}

function pointsEqual(a: SchematicPoint, b: SchematicPoint): boolean {
  return a.x === b.x && a.y === b.y
}

function offsetPoint(point: SchematicPoint, line: Line): SchematicPoint {
  const offset = LINE_OFFSETS[line]
  return { x: point.x + offset.x, y: point.y + offset.y }
}

function bendPoints(fromCode: string, toCode: string): readonly SchematicPoint[] {
  const direct = SCHEMATIC_BENDS[`${fromCode}>${toCode}`]
  if (direct) return direct
  const reverse = SCHEMATIC_BENDS[`${toCode}>${fromCode}`]
  return reverse ? [...reverse].reverse() : []
}

function expandedPoints(codes: readonly string[], line: Line): SchematicPoint[] {
  const result: SchematicPoint[] = []
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]
    const station = SCHEMATIC_STATIONS[code]
    if (!station) continue
    if (result.length > 0) {
      const previousCode = codes[index - 1]
      result.push(...bendPoints(previousCode, code).map(point => offsetPoint(point, line)))
    }
    const point = offsetPoint(station, line)
    if (!result.at(-1) || !pointsEqual(result.at(-1)!, point)) result.push(point)
  }
  return result
}

/** Octilinear polyline rendered with soft arcs at every corner. */
export function roundedPathData(points: readonly SchematicPoint[], radius = CORNER_RADIUS): string {
  if (points.length === 0) return ''
  if (points.length < 3) return `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}`
  const parts = [`M ${points[0].x} ${points[0].y}`]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]
    const corner = points[index]
    const next = points[index + 1]
    const inLength = distance(previous, corner)
    const outLength = distance(corner, next)
    const r = Math.min(radius, inLength / 2, outLength / 2)
    if (r < 0.5 || inLength === 0 || outLength === 0) {
      parts.push(`L ${corner.x} ${corner.y}`)
      continue
    }
    const inX = corner.x - (corner.x - previous.x) / inLength * r
    const inY = corner.y - (corner.y - previous.y) / inLength * r
    const outX = corner.x + (next.x - corner.x) / outLength * r
    const outY = corner.y + (next.y - corner.y) / outLength * r
    parts.push(`L ${inX} ${inY}`, `Q ${corner.x} ${corner.y} ${outX} ${outY}`)
  }
  const last = points.at(-1)!
  parts.push(`L ${last.x} ${last.y}`)
  return parts.join(' ')
}

function distance(a: SchematicPoint, b: SchematicPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

function polylineLength(points: readonly SchematicPoint[]): number {
  let total = 0
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1], points[index])
  }
  return total
}

export function pointAtDistance(points: readonly SchematicPoint[], requested: number): SchematicPoint {
  if (points.length === 0) return { x: 0, y: 0 }
  let remaining = Math.max(0, requested)
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const segmentLength = distance(start, end)
    if (remaining <= segmentLength || index === points.length - 1) {
      const ratio = segmentLength === 0 ? 0 : Math.min(1, remaining / segmentLength)
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
      }
    }
    remaining -= segmentLength
  }
  return points.at(-1)!
}

/** Travel direction, in degrees, of the polyline at the given distance. */
export function bearingAtDistance(points: readonly SchematicPoint[], requested: number): number {
  if (points.length < 2) return 0
  let remaining = Math.max(0, requested)
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]
    const end = points[index]
    const segmentLength = distance(start, end)
    if ((remaining <= segmentLength && segmentLength > 0) || index === points.length - 1) {
      return Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI
    }
    remaining -= segmentLength
  }
  return 0
}

function routeIndexForCode(routeCodes: readonly string[], code: string): number {
  const exact = routeCodes.indexOf(code)
  if (exact >= 0) return exact
  const aliases = new Set(groupForCode(code))
  return routeCodes.findIndex(routeCode => aliases.has(routeCode))
}

function stationGeo(mapData: MetroMapData, code: string): GeoPoint | null {
  for (const candidate of groupForCode(code)) {
    const station = mapData.stations.find(item => item.code === candidate)
    if (station) return station
  }
  return null
}

function projectedSegmentFraction(position: GeoPoint, from: GeoPoint, to: GeoPoint): number {
  const vx = (to.lon - from.lon) * LONGITUDE_SCALE
  const vy = to.lat - from.lat
  const px = (position.lon - from.lon) * LONGITUDE_SCALE
  const py = position.lat - from.lat
  const magnitude = vx * vx + vy * vy
  if (magnitude <= Number.EPSILON) return 0
  return Math.max(0, Math.min(1, (px * vx + py * vy) / magnitude))
}

function distanceBeforeRouteIndex(codes: readonly string[], line: Line, index: number): number {
  return polylineLength(expandedPoints(codes.slice(0, Math.max(0, index) + 1), line))
}

function trainDistance(
  mapData: MetroMapData,
  train: LiveMapTrain,
  routePoints: readonly SchematicPoint[]
): number {
  const total = polylineLength(routePoints)
  const previousIndex = train.previousStop
    ? routeIndexForCode(train.routeStationCodes, train.previousStop.code)
    : -1
  const nextIndex = train.nextStop
    ? routeIndexForCode(train.routeStationCodes, train.nextStop.code)
    : -1

  if (train.position && previousIndex >= 0 && nextIndex === previousIndex + 1) {
    const previousGeo = stationGeo(mapData, train.routeStationCodes[previousIndex])
    const nextGeo = stationGeo(mapData, train.routeStationCodes[nextIndex])
    if (previousGeo && nextGeo) {
      const segmentPoints = expandedPoints(
        train.routeStationCodes.slice(previousIndex, nextIndex + 1),
        train.line
      )
      const before = distanceBeforeRouteIndex(train.routeStationCodes, train.line, previousIndex)
      return Math.min(total, before + polylineLength(segmentPoints) * projectedSegmentFraction(
        train.position,
        previousGeo,
        nextGeo
      ))
    }
  }

  return total * Math.max(0, Math.min(1, train.progress ?? 0))
}

function physicalKey(code: string): string {
  return [...groupForCode(code)].sort().join('_')
}

function stationNodes(mapData: MetroMapData, routeCodes: ReadonlySet<string>): SchematicStationNode[] {
  const nodes = new Map<string, SchematicStationNode>()
  for (const station of mapData.stations) {
    const point = SCHEMATIC_STATIONS[station.code]
    if (!point) continue
    const key = physicalKey(station.code)
    const current = nodes.get(key)
    const lines = [...new Set([...(current?.lines ?? []), ...station.lines])]
    nodes.set(key, {
      code: current?.code ?? station.code,
      name: current?.name ?? station.name,
      lines,
      x: point.x,
      y: point.y,
      isInterchange: groupForCode(station.code).length > 1
        || NETWORK_JUNCTION_CODES.has(station.code),
      isOnRoute: (current?.isOnRoute ?? false)
        || groupForCode(station.code).some(code => routeCodes.has(code)),
    })
  }
  return [...nodes.values()]
}

function codesMatch(a: string, b: string): boolean {
  if (a === b) return true
  const aliases = new Set(groupForCode(a))
  return groupForCode(b).some(code => aliases.has(code))
}

function pathHasSegment(mapData: MetroMapData, line: Line, fromCode: string, toCode: string): boolean {
  return mapData.paths.some(path => {
    if (path.line !== line) return false
    return path.stationCodes.some((code, index) => (
      index > 0
      && codesMatch(path.stationCodes[index - 1], fromCode)
      && codesMatch(code, toCode)
    ) || (
      index > 0
      && codesMatch(path.stationCodes[index - 1], toCode)
      && codesMatch(code, fromCode)
    ))
  })
}

function isRouteJunction(
  mapData: MetroMapData,
  routeCodes: readonly string[],
  index: number,
  activeLine: Line,
  lines: readonly Line[]
): boolean {
  const previous = routeCodes[index - 1]
  const next = routeCodes[index + 1]
  return lines.some(line => {
    if (line === activeLine) return false
    const sharesPrevious = previous ? pathHasSegment(mapData, line, previous, routeCodes[index]) : false
    const sharesNext = next ? pathHasSegment(mapData, line, routeCodes[index], next) : false
    return !sharesPrevious || !sharesNext
  })
}

function routeStationNodes(mapData: MetroMapData, train: LiveMapTrain): SchematicRouteStation[] {
  return train.routeStationCodes.flatMap((code, index) => {
    const point = SCHEMATIC_STATIONS[code]
    if (!point) return []
    const station = mapData.stations.find(item => item.code === code)
    const aliases = groupForCode(code)
    const lines = [...new Set(mapData.stations
      .filter(item => aliases.includes(item.code))
      .flatMap(item => item.lines))]
    return [{
      code,
      name: station?.name
        ?? (code === train.from.code ? train.from.name : code === train.to.code ? train.to.name : code),
      lines,
      isJunction: isRouteJunction(mapData, train.routeStationCodes, index, train.line, lines),
      distance: distanceBeforeRouteIndex(train.routeStationCodes, train.line, index),
      ...offsetPoint(point, train.line),
    }]
  })
}

function fittedViewBox(points: readonly SchematicPoint[]): LiveMapGeometry['viewBox'] {
  const minX = Math.min(...points.map(point => point.x))
  const maxX = Math.max(...points.map(point => point.x))
  const minY = Math.min(...points.map(point => point.y))
  const maxY = Math.max(...points.map(point => point.y))
  let width = Math.max(MIN_VIEW_WIDTH, maxX - minX + 260)
  let height = Math.max(MIN_VIEW_HEIGHT, maxY - minY + 210)
  if (width / height < VIEW_ASPECT) width = height * VIEW_ASPECT
  else height = width / VIEW_ASPECT
  return {
    x: (minX + maxX - width) / 2,
    y: (minY + maxY - height) / 2,
    width,
    height,
  }
}

/** Marker distance along the approach polyline for a not-yet-boarded train. */
function approachDistance(
  mapData: MetroMapData,
  train: LiveMapTrain,
  approachPoints: readonly SchematicPoint[]
): number {
  const approach = train.approach!
  const codes = approach.stationCodes
  const total = polylineLength(approachPoints)
  const previousIndex = approach.previousStop
    ? routeIndexForCode(codes, approach.previousStop.code)
    : -1
  const nextIndex = approach.nextStop
    ? routeIndexForCode(codes, approach.nextStop.code)
    : -1

  if (train.position && previousIndex >= 0 && nextIndex === previousIndex + 1) {
    const previousGeo = stationGeo(mapData, codes[previousIndex])
    const nextGeo = stationGeo(mapData, codes[nextIndex])
    if (previousGeo && nextGeo) {
      const segmentPoints = expandedPoints(codes.slice(previousIndex, nextIndex + 1), train.line)
      const before = distanceBeforeRouteIndex(codes, train.line, previousIndex)
      return Math.min(total, before + polylineLength(segmentPoints) * projectedSegmentFraction(
        train.position,
        previousGeo,
        nextGeo
      ))
    }
  }

  return total * Math.max(0, Math.min(1, approach.progress))
}

export function buildLiveMapGeometry(mapData: MetroMapData, train: LiveMapTrain): LiveMapGeometry | null {
  const routePoints = expandedPoints(train.routeStationCodes, train.line)
  const fromBase = SCHEMATIC_STATIONS[train.from.code]
  const toBase = SCHEMATIC_STATIONS[train.to.code]
  if (routePoints.length < 2 || !fromBase || !toBase) return null

  // The approach only renders when its polyline genuinely joins the route at
  // the boarding station; otherwise fall back to origin-pinned behavior.
  const rawApproachPoints = train.approach && !train.ended
    ? expandedPoints(train.approach.stationCodes, train.line)
    : []
  const approachPoints = rawApproachPoints.length >= 2
    && pointsEqual(rawApproachPoints.at(-1)!, routePoints[0])
    ? rawApproachPoints
    : []
  const approachLength = polylineLength(approachPoints)
  const combinedPoints = approachPoints.length > 0
    ? [...approachPoints.slice(0, -1), ...routePoints]
    : routePoints

  const approachStations: SchematicApproachStation[] = approachPoints.length > 0
    ? train.approach!.stationCodes.slice(0, -1).flatMap((code, index) => {
        const point = SCHEMATIC_STATIONS[code]
        if (!point) return []
        const aliases = groupForCode(code)
        const info = mapData.stations.find(item => aliases.includes(item.code))
        return [{
          code,
          name: info?.name ?? code,
          lines: info?.lines ?? [train.line],
          distance: distanceBeforeRouteIndex(train.approach!.stationCodes, train.line, index),
          ...offsetPoint(point, train.line),
        }]
      })
    : []

  const routeCodes = new Set(train.routeStationCodes)
  const progressDistance = approachPoints.length > 0
    ? approachDistance(mapData, train, approachPoints)
    : approachLength + trainDistance(mapData, train, routePoints)

  return {
    networkPaths: mapData.paths.flatMap(path => {
      const points = expandedPoints(path.stationCodes, path.line)
      return points.length > 1 ? [{ id: path.id, line: path.line, d: roundedPathData(points) }] : []
    }),
    networkStations: stationNodes(mapData, routeCodes),
    routeStations: routeStationNodes(mapData, train),
    routePath: roundedPathData(routePoints),
    routePoints,
    routeLength: polylineLength(routePoints),
    approachPath: approachPoints.length > 0 ? roundedPathData(approachPoints) : null,
    approachLength,
    approachStations,
    combinedPoints,
    combinedLength: approachLength + polylineLength(routePoints),
    progressDistance,
    hasPosition: train.position != null,
    fromPoint: offsetPoint(fromBase, train.line),
    toPoint: offsetPoint(toBase, train.line),
    viewBox: fittedViewBox(approachPoints.length > 0
      ? [...approachPoints, ...routePoints]
      : routePoints),
  }
}
