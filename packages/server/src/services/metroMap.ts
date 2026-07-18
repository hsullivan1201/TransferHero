import type { Line, MetroMapData, MetroMapPoint, MetroMapStation, StationExit } from '@transferhero/shared'
import { LINE_PATHS } from '../data/lineConfig.js'
import { ALL_STATIONS } from '../data/stations.js'
import { getAllExits, loadStationExits } from './stationService.js'

interface MetroMapBuildOptions {
  exits?: ReadonlyMap<string, readonly StationExit[]>
  now?: () => number
}

let cachedMap: MetroMapData | null = null

function centroid(exits: readonly StationExit[]): { lat: number; lon: number } | null {
  const valid = exits.filter(exit => Number.isFinite(exit.lat) && Number.isFinite(exit.lon))
  if (valid.length === 0) return null
  return {
    lat: valid.reduce((sum, exit) => sum + exit.lat, 0) / valid.length,
    lon: valid.reduce((sum, exit) => sum + exit.lon, 0) / valid.length,
  }
}

/**
 * Index physical-station entrance centroids by each of their platform codes.
 * The codes remain separate map nodes; only their physical coordinates are shared.
 */
function indexCentroids(exitsByPhysicalStation: ReadonlyMap<string, readonly StationExit[]>): Map<string, {
  lat: number
  lon: number
}> {
  const result = new Map<string, { lat: number; lon: number }>()
  for (const [physicalCode, exits] of exitsByPhysicalStation) {
    const point = centroid(exits)
    if (!point) continue
    result.set(physicalCode, point)
    for (const platformCode of physicalCode.split('_')) {
      if (/^[A-Z]\d{2}$/u.test(platformCode)) result.set(platformCode, point)
    }
  }
  return result
}

export function buildMetroMapData(options: MetroMapBuildOptions = {}): MetroMapData {
  const exits = options.exits ?? getAllExits()
  const now = options.now ?? Date.now
  const centroids = indexCentroids(exits)
  const pathCodes = new Set(Object.values(LINE_PATHS).flat(2))

  const stations: MetroMapStation[] = ALL_STATIONS
    .filter(station => pathCodes.has(station.code))
    .flatMap(station => {
      const point = centroids.get(station.code)
      return point ? [{ ...station, ...point }] : []
    })
  const stationPointByCode = new Map(stations.map(station => [station.code, station]))

  const paths = (Object.entries(LINE_PATHS) as [Line, string[][]][]).flatMap(([line, linePaths]) =>
    linePaths.map((stationCodes, index) => {
      const points: MetroMapPoint[] = stationCodes.flatMap(stationCode => {
        const point = stationPointByCode.get(stationCode)
        return point ? [{ stationCode, lat: point.lat, lon: point.lon }] : []
      })
      return {
        id: `${line}-${index + 1}`,
        line,
        stationCodes: [...stationCodes],
        points,
      }
    })
  )

  return { generatedAtMs: now(), stations, paths }
}

export async function getMetroMapData(): Promise<MetroMapData> {
  if (cachedMap) return cachedMap
  await loadStationExits()
  cachedMap = buildMetroMapData()
  return cachedMap
}

export function resetMetroMapCache(): void {
  cachedMap = null
}
