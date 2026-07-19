import { useId, useMemo } from 'react'
import type { Line, MetroMapData } from '@transferhero/shared'
import { LINE_DRAW_ORDER } from '../data/metroSchematic'
import { LINE_COLORS } from '../utils/lineColors'
import {
  buildLiveMapGeometry,
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

function lineLetter(line: Line): string {
  return line.slice(0, 1)
}

function markerInk(line: Line): string {
  return line === 'OR' || line === 'SV' || line === 'YL' ? '#211a16' : '#ffffff'
}

function labelPlacement(
  station: SchematicRouteStation,
  centerX: number,
  distance = 18,
  forcedAnchor?: 'start' | 'end'
): { x: number; anchor: 'start' | 'end' } {
  const anchor = forcedAnchor ?? (station.x > centerX ? 'end' : 'start')
  return { x: station.x + (anchor === 'start' ? distance : -distance), anchor }
}

function sortedNetworkPaths(paths: readonly SchematicNetworkPath[]): SchematicNetworkPath[] {
  return [...paths].sort((a, b) => (
    LINE_DRAW_ORDER.indexOf(a.line) - LINE_DRAW_ORDER.indexOf(b.line)
  ))
}

export function LiveTrainMap({
  mapData,
  train,
  transferName,
  positionUnavailable = false,
}: LiveTrainMapProps) {
  const rawId = useId()
  const id = rawId.replace(/:/gu, '')
  const geometry = useMemo(() => buildLiveMapGeometry(mapData, train), [mapData, train])

  if (!geometry) {
    return (
      <div className="live-map-unavailable is-inline" role="status">
        <span aria-hidden="true" /> The schematic is updating…
      </div>
    )
  }

  const centerX = geometry.viewBox.x + geometry.viewBox.width / 2
  const paths = sortedNetworkPaths(geometry.networkPaths)
  const destination = geometry.routeStations.find(station => station.code === train.to.code)
  const origin = geometry.routeStations.find(station => station.code === train.from.code)
  const nextStation = geometry.routeStations.find(station => station.code === train.nextStop?.code)
  const stationIsNearTrain = (station: SchematicRouteStation | undefined, radius: number) => Boolean(
    geometry.trainPoint
    && station
    && Math.hypot(geometry.trainPoint.x - station.x, geometry.trainPoint.y - station.y) < radius
  )
  const trainNearOrigin = stationIsNearTrain(origin, 55)
  const nextLabelDistance = stationIsNearTrain(nextStation, 80) ? 55 : 32
  const markerLabel = train.position?.source === 'vehicle' ? 'LIVE TRAIN' : 'ESTIMATED'
  const positionKind = train.position?.source === 'vehicle' ? 'live train' : 'estimated train position'
  const description = train.position && train.previousStop && train.nextStop
    ? `The ${positionKind} is between ${train.previousStop.name} and ${train.nextStop.name}, heading toward ${train.toward}.`
    : train.position
      ? `The ${positionKind} is on the ${train.line} Line, heading toward ${train.toward}.`
      : `Live position is temporarily unavailable for the train heading toward ${train.toward}.`

  const stationLabel = (
    station: SchematicRouteStation,
    kicker: string,
    emphasized = false,
    distance = 18,
    forcedAnchor?: 'start' | 'end'
  ) => {
    const placement = labelPlacement(station, centerX, distance, forcedAnchor)
    return (
      <g className={emphasized ? 'live-map-node-copy is-emphasized' : 'live-map-node-copy'}>
        <text
          x={placement.x}
          y={station.y - 10}
          textAnchor={placement.anchor}
          className="live-map-node-kicker"
        >
          {kicker}
        </text>
        <text
          x={placement.x}
          y={station.y + 10}
          textAnchor={placement.anchor}
          className="live-map-node-label"
        >
          {station.name}
        </text>
      </g>
    )
  }

  return (
    <div className="live-map-stage">
      <svg
        className="live-map-svg"
        viewBox={`${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}`}
        role="img"
        aria-labelledby={`${id}-title ${id}-description`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={`${id}-title`}>{train.line} Line live train schematic</title>
        <desc id={`${id}-description`}>{description}</desc>
        <defs>
          <filter id={`${id}-route-glow`} x="-25%" y="-25%" width="150%" height="150%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`${id}-train-glow`} x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

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

        <g className="live-map-route" aria-hidden="true">
          <path d={geometry.routePath} className="live-map-route-casing" />
          <path
            d={geometry.routePath}
            className="live-map-route-line"
            stroke={LINE_COLORS[train.line].bg}
            filter={`url(#${id}-route-glow)`}
          />
          {geometry.completedRoutePath && (
            <path d={geometry.completedRoutePath} className="live-map-route-complete" />
          )}
        </g>

        <g className="live-map-stations" aria-hidden="true">
          {geometry.routeStations.map(station => {
            const isNext = station.code === train.nextStop?.code
            const isEndpoint = station.code === train.from.code || station.code === train.to.code
            const isInterchange = station.isJunction
            return (
              <g key={station.code}>
                {isNext && <circle className="live-map-next-ring" cx={station.x} cy={station.y} r="15" />}
                <circle
                  className={[
                    'live-map-station',
                    isEndpoint ? 'is-endpoint' : '',
                    isInterchange ? 'is-interchange' : '',
                  ].filter(Boolean).join(' ')}
                  cx={station.x}
                  cy={station.y}
                  r={isEndpoint ? 7 : isInterchange ? 6 : 4}
                />
              </g>
            )
          })}

          {origin && !trainNearOrigin && origin.code !== nextStation?.code
            && stationLabel(origin, 'START', false, 20, 'end')}
          {geometry.routeStations
            .filter(station => station.isJunction)
            .filter(station => station.code !== origin?.code)
            .filter(station => station.code !== destination?.code)
            .filter(station => station.code !== nextStation?.code)
            .filter(station => !stationIsNearTrain(station, 75))
            .map(station => (
              <g key={`label-${station.code}`}>{stationLabel(station, 'TRANSFER')}</g>
            ))}
          {nextStation && nextStation.code !== destination?.code
            && stationLabel(nextStation, 'NEXT STOP', true, nextLabelDistance, 'start')}

          {destination && (
            <>
              <circle className="live-map-destination-ring" cx={destination.x} cy={destination.y} r="16" />
              <circle
                cx={destination.x}
                cy={destination.y}
                r="10"
                fill={LINE_COLORS[train.line].bg}
              />
              <text
                x={destination.x}
                y={destination.y + 4}
                textAnchor="middle"
                className="live-map-line-letter"
              >
                {lineLetter(train.line)}
              </text>
              {stationLabel(
                destination,
                transferName && train.leg === 1 ? 'CHANGE HERE' : 'DESTINATION',
                true
              )}
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
              r="34"
              fill={LINE_COLORS[train.line].bg}
              filter={`url(#${id}-train-glow)`}
            />
            <circle className="live-map-train-disc" r="23" fill={LINE_COLORS[train.line].bg} />
            <g fill={markerInk(train.line)}>
              <rect x="-10" y="-12" width="20" height="21" rx="6" />
              <rect x="-6.5" y="-8" width="5" height="5" rx="1" fill={LINE_COLORS[train.line].bg} />
              <rect x="1.5" y="-8" width="5" height="5" rx="1" fill={LINE_COLORS[train.line].bg} />
              <circle cx="-6" cy="5" r="1.7" fill={LINE_COLORS[train.line].bg} />
              <circle cx="6" cy="5" r="1.7" fill={LINE_COLORS[train.line].bg} />
              <path d="M -7 12 L -3 8 M 7 12 L 3 8" fill="none" stroke={markerInk(train.line)} strokeWidth="2.5" strokeLinecap="round" />
            </g>
            <g className="live-map-train-label" transform="translate(0 -41)">
              <rect x="-43" y="-12" width="86" height="24" rx="12" />
              <text textAnchor="middle" y="4">{markerLabel}</text>
            </g>
          </g>
        )}
      </svg>

      {(positionUnavailable || !geometry.trainPoint) && !train.ended && (
        <div className="live-map-unavailable" role="status">
          <span aria-hidden="true" /> Reconnecting to the train…
        </div>
      )}
      <div className="live-map-scale-note" aria-hidden="true">METRO SCHEMATIC · NOT TO SCALE</div>
    </div>
  )
}
