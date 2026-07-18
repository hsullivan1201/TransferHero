import { useId, useMemo } from 'react'
import type { Line, MetroMapData } from '@transferhero/shared'
import { LINE_COLORS } from '../utils/lineColors'

const MAP_WIDTH = 820
const MAP_HEIGHT = 570
const DC_LONGITUDE_SCALE = Math.cos(38.9 * Math.PI / 180)

interface GeoPoint {
  lat: number
  lon: number
}

interface ScreenPoint {
  x: number
  y: number
}

export interface LiveMapStation extends GeoPoint {
  code: string
  name: string
}

export interface LiveMapTrain {
  id: string
  leg: number
  line: Line
  toward: string
  from: LiveMapStation
  to: LiveMapStation
  routeStationCodes: string[]
  position: (GeoPoint & { bearing?: number | null }) | null
  nextStop: { code: string; name: string } | null
  progress: number | null
  phase: string
  ended: boolean
}

interface LiveTrainMapProps {
  mapData: MetroMapData
  train: LiveMapTrain
  transferName?: string | null
  positionUnavailable?: boolean
}

function projectGeo(point: GeoPoint): ScreenPoint {
  return {
    x: point.lon * DC_LONGITUDE_SCALE,
    y: -point.lat,
  }
}

function smoothPath(points: readonly ScreenPoint[]): string {
  if (points.length === 0) return ''
  if (points.length < 3) {
    return `M ${points.map(point => `${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' L ')}`
  }

  const pointAt = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))]
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = pointAt(index - 1)
    const p1 = pointAt(index)
    const p2 = pointAt(index + 1)
    const p3 = pointAt(index + 2)
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    path += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }

  return path
}

function geoDistanceSquared(a: GeoPoint, b: GeoPoint): number {
  const lat = a.lat - b.lat
  const lon = (a.lon - b.lon) * DC_LONGITUDE_SCALE
  return lat * lat + lon * lon
}

function nearestIndex(points: readonly GeoPoint[], target: GeoPoint): number {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  points.forEach((point, index) => {
    const distance = geoDistanceSquared(point, target)
    if (distance < bestDistance) {
      bestDistance = distance
      bestIndex = index
    }
  })

  return bestIndex
}

function labelAnchor(point: ScreenPoint): 'start' | 'end' {
  return point.x > MAP_WIDTH * 0.63 ? 'end' : 'start'
}

function labelX(point: ScreenPoint, anchor: 'start' | 'end'): number {
  return point.x + (anchor === 'start' ? 18 : -18)
}

function lineLetter(line: Line): string {
  return line.slice(0, 1)
}

function markerInk(line: Line): string {
  return line === 'OR' || line === 'SV' || line === 'YL' ? '#271f1a' : '#ffffff'
}

export function LiveTrainMap({
  mapData,
  train,
  transferName,
  positionUnavailable = false,
}: LiveTrainMapProps) {
  const rawId = useId()
  const id = rawId.replace(/:/gu, '')

  const geometry = useMemo(() => {
    const stations = new Map(mapData.stations.map(station => [station.code, station]))
    const candidatePaths = mapData.paths.filter(path => path.line === train.line && path.points.length > 1)

    const scoredPaths = candidatePaths.map(path => {
      const codes = new Set(path.stationCodes)
      const routeMatches = train.routeStationCodes.filter(code => codes.has(code)).length
      const endpoints = Number(codes.has(train.from.code)) + Number(codes.has(train.to.code))
      return { path, score: endpoints * 100 + routeMatches }
    })
    scoredPaths.sort((a, b) => b.score - a.score)
    const activePath = scoredPaths[0]?.path ?? null
    const activePoints = activePath?.points ?? []

    let routePoints: GeoPoint[] = []
    if (activePoints.length > 1) {
      const fromIndex = nearestIndex(activePoints, train.from)
      const toIndex = nearestIndex(activePoints, train.to)
      routePoints = activePoints.slice(
        Math.min(fromIndex, toIndex),
        Math.max(fromIndex, toIndex) + 1
      )
      if (fromIndex > toIndex) routePoints.reverse()
    }
    if (routePoints.length < 2) routePoints = [train.from, train.to]

    const focusPoints = [...routePoints, train.from, train.to]
    if (train.position) focusPoints.push(train.position)
    const projectedFocus = focusPoints.map(projectGeo)
    let minX = Math.min(...projectedFocus.map(point => point.x))
    let maxX = Math.max(...projectedFocus.map(point => point.x))
    let minY = Math.min(...projectedFocus.map(point => point.y))
    let maxY = Math.max(...projectedFocus.map(point => point.y))

    // A minimum neighborhood keeps a one-stop trip from becoming an extreme close-up.
    const minimumSpan = 0.018
    if (maxX - minX < minimumSpan) {
      const center = (minX + maxX) / 2
      minX = center - minimumSpan / 2
      maxX = center + minimumSpan / 2
    }
    if (maxY - minY < minimumSpan) {
      const center = (minY + maxY) / 2
      minY = center - minimumSpan / 2
      maxY = center + minimumSpan / 2
    }

    const paddedWidth = (maxX - minX) * 1.34
    const paddedHeight = (maxY - minY) * 1.42
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const fitScale = Math.min(MAP_WIDTH / paddedWidth, MAP_HEIGHT / paddedHeight)
    const toScreen = (point: GeoPoint): ScreenPoint => {
      const projected = projectGeo(point)
      return {
        x: (projected.x - centerX) * fitScale + MAP_WIDTH / 2,
        y: (projected.y - centerY) * fitScale + MAP_HEIGHT / 2,
      }
    }

    const routeCodeSet = new Set(train.routeStationCodes)
    routeCodeSet.add(train.from.code)
    routeCodeSet.add(train.to.code)
    const routeStations = [...routeCodeSet]
      .map(code => stations.get(code))
      .filter((station): station is NonNullable<typeof station> => station != null)
      .filter(station => {
        const fromIndex = nearestIndex(routePoints, station)
        return geoDistanceSquared(routePoints[fromIndex], station) < 0.00008
      })

    const trainProgress = train.progress == null && train.position
      ? nearestIndex(routePoints, train.position) / Math.max(1, routePoints.length - 1)
      : train.progress ?? 0

    return {
      networkPaths: mapData.paths.map(path => ({
        id: path.id,
        line: path.line,
        path: smoothPath(path.points.map(toScreen)),
      })),
      routePath: smoothPath(routePoints.map(toScreen)),
      routeStations: routeStations.map(station => ({ ...station, point: toScreen(station) })),
      trainPoint: train.position ? toScreen(train.position) : null,
      fromPoint: toScreen(train.from),
      toPoint: toScreen(train.to),
      progress: Math.max(0, Math.min(1, trainProgress)),
    }
  }, [mapData, train])

  const destinationAnchor = labelAnchor(geometry.toPoint)
  const transferLabel = transferName && train.leg === 1
    ? `${transferName} · transfer`
    : null
  const destinationLabel = transferLabel ?? train.to.name
  const nextStation = geometry.routeStations.find(station => station.code === train.nextStop?.code)
  const showNextLabel = nextStation && nextStation.code !== train.to.code

  return (
    <div className="live-map-stage">
      <svg
        className="live-map-svg"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        preserveAspectRatio="xMidYMid slice"
      >
        <title id={`${id}-title`}>{train.line} Line live train map</title>
        <desc id={`${id}-description`}>
          {train.position
            ? `The train is between ${train.from.name} and ${train.to.name}, heading toward ${train.toward}.`
            : `Live position is temporarily unavailable for the train heading toward ${train.toward}.`}
        </desc>
        <defs>
          <pattern id={`${id}-grain`} width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="3" cy="3" r="1.1" fill="#ffffff" opacity="0.045" />
          </pattern>
          <filter id={`${id}-route-glow`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`${id}-train-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill={`url(#${id}-grain)`} />

        <g className="live-map-network" aria-hidden="true">
          {geometry.networkPaths.map(path => (
            <path
              key={path.id}
              d={path.path}
              fill="none"
              stroke={LINE_COLORS[path.line].bg}
              strokeWidth="4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>

        <g className="live-map-route" aria-hidden="true">
          <path
            d={geometry.routePath}
            fill="none"
            className="live-map-route-casing"
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={geometry.routePath}
            fill="none"
            stroke={LINE_COLORS[train.line].bg}
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${id}-route-glow)`}
          />
          {geometry.progress > 0 && (
            <path
              d={geometry.routePath}
              fill="none"
              className="live-map-route-complete"
              strokeWidth="9.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength="100"
              strokeDasharray={`${(geometry.progress * 100).toFixed(2)} 100`}
            />
          )}
        </g>

        <g className="live-map-stations" aria-hidden="true">
          {geometry.routeStations.map(station => {
            const isNext = station.code === train.nextStop?.code
            const isEndpoint = station.code === train.from.code || station.code === train.to.code
            return (
              <g key={station.code}>
                {isNext && <circle className="live-map-next-ring" cx={station.point.x} cy={station.point.y} r="13" />}
                <circle
                  className={isEndpoint ? 'live-map-station is-endpoint' : 'live-map-station'}
                  cx={station.point.x}
                  cy={station.point.y}
                  r={isEndpoint ? 8 : 4.5}
                />
              </g>
            )
          })}
          <circle className="live-map-origin" cx={geometry.fromPoint.x} cy={geometry.fromPoint.y} r="7" />
          <circle className="live-map-destination-ring" cx={geometry.toPoint.x} cy={geometry.toPoint.y} r="15" />
          <circle
            cx={geometry.toPoint.x}
            cy={geometry.toPoint.y}
            r="10"
            fill={LINE_COLORS[train.line].bg}
          />
          <text
            x={geometry.toPoint.x}
            y={geometry.toPoint.y + 5}
            textAnchor="middle"
            className="live-map-line-letter"
          >
            {lineLetter(train.line)}
          </text>
          <text
            x={labelX(geometry.toPoint, destinationAnchor)}
            y={geometry.toPoint.y - 17}
            textAnchor={destinationAnchor}
            className="live-map-node-kicker"
          >
            {transferLabel ? 'CHANGE HERE' : 'DESTINATION'}
          </text>
          <text
            x={labelX(geometry.toPoint, destinationAnchor)}
            y={geometry.toPoint.y + 5}
            textAnchor={destinationAnchor}
            className="live-map-node-label"
          >
            {destinationLabel}
          </text>
          {showNextLabel && (
            <>
              <text
                x={labelX(nextStation.point, labelAnchor(nextStation.point))}
                y={nextStation.point.y - 11}
                textAnchor={labelAnchor(nextStation.point)}
                className="live-map-node-kicker"
              >
                NEXT STOP
              </text>
              <text
                x={labelX(nextStation.point, labelAnchor(nextStation.point))}
                y={nextStation.point.y + 11}
                textAnchor={labelAnchor(nextStation.point)}
                className="live-map-node-label is-next"
              >
                {train.nextStop?.name}
              </text>
            </>
          )}
        </g>

        {geometry.trainPoint && (
          <g
            className={train.ended ? 'live-map-train is-ended' : 'live-map-train'}
            transform={`translate(${geometry.trainPoint.x} ${geometry.trainPoint.y})`}
            aria-hidden="true"
          >
            <circle
              className="live-map-train-halo"
              r="37"
              fill={LINE_COLORS[train.line].bg}
              filter={`url(#${id}-train-glow)`}
            />
            <circle className="live-map-train-disc" r="24" fill={LINE_COLORS[train.line].bg} />
            <g fill={markerInk(train.line)}>
              <rect x="-10" y="-12" width="20" height="21" rx="6" />
              <rect x="-6.5" y="-8" width="5" height="5" rx="1" fill={LINE_COLORS[train.line].bg} />
              <rect x="1.5" y="-8" width="5" height="5" rx="1" fill={LINE_COLORS[train.line].bg} />
              <circle cx="-6" cy="5" r="1.7" fill={LINE_COLORS[train.line].bg} />
              <circle cx="6" cy="5" r="1.7" fill={LINE_COLORS[train.line].bg} />
              <path d="M -7 12 L -3 8 M 7 12 L 3 8" fill="none" stroke={markerInk(train.line)} strokeWidth="2.5" strokeLinecap="round" />
            </g>
            <g className="live-map-train-label" transform="translate(0 42)">
              <rect x="-43" y="-12" width="86" height="24" rx="12" />
              <text textAnchor="middle" y="4">LIVE TRAIN</text>
            </g>
          </g>
        )}
      </svg>

      {(positionUnavailable || !geometry.trainPoint) && !train.ended && (
        <div className="live-map-unavailable" role="status">
          <span aria-hidden="true" />
          Reconnecting to the train…
        </div>
      )}
      <div className="live-map-compass" aria-hidden="true">
        <span>N</span>
        <i />
      </div>
    </div>
  )
}
