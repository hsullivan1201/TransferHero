import type {
  Line,
  LiveTrackedTrainStatus,
  LiveTrackerConnection,
  MetroMapData,
  MetroMapStation,
  SharedTrackedTrain,
} from '@transferhero/shared'
import type { LiveMapStation, LiveMapTrain } from './LiveTrainMap'

export const LINE_NAMES: Record<Line, string> = {
  RD: 'Red',
  OR: 'Orange',
  SV: 'Silver',
  BL: 'Blue',
  YL: 'Yellow',
  GR: 'Green',
}

function stationWithPosition(code: string, mapData: MetroMapData): MetroMapStation | null {
  const station = mapData.stations.find(item => item.code === code)
  if (station) return station

  for (const path of mapData.paths) {
    const point = path.points.find(item => item.stationCode === code)
    if (point) {
      return {
        code,
        name: code,
        lines: [path.line],
        lat: point.lat,
        lon: point.lon,
      }
    }
  }
  return null
}

function mapStation(
  station: SharedTrackedTrain['from'] | LiveTrackedTrainStatus['from'],
  mapData: MetroMapData
): LiveMapStation | null {
  const positioned = stationWithPosition(station.code, mapData)
  return positioned ? {
    code: station.code,
    name: station.name,
    lat: positioned.lat,
    lon: positioned.lon,
  } : null
}

export function liveMapTrain(
  selected: SharedTrackedTrain,
  status: LiveTrackedTrainStatus | null,
  mapData: MetroMapData,
  options: { projected?: boolean } = {}
): LiveMapTrain | null {
  const from = mapStation(status?.from ?? selected.from, mapData)
  const to = mapStation(status?.to ?? selected.to, mapData)
  if (!from || !to) return null

  return {
    id: selected.id,
    leg: selected.leg,
    line: status?.line ?? selected.line,
    toward: status?.toward ?? selected.toward,
    from,
    to,
    routeStationCodes: status?.routeStationCodes ?? selected.stops.map(stop => stop.code),
    position: status?.position ?? null,
    previousStop: status?.previousStop
      ? { code: status.previousStop.code, name: status.previousStop.name }
      : null,
    nextStop: status?.nextStop
      ? {
          code: status.nextStop.code,
          name: status.nextStop.name,
          expectedAtMs: status.nextStop.expectedAtMs,
        }
      : null,
    progress: status?.progress ?? 0,
    phase: status?.phase ?? 'unknown',
    approach: status?.approach ?? null,
    eta: status?.eta ?? null,
    stopTimes: status?.stopExpectedAtMs ?? null,
    otherTrains: status?.otherTrains ?? null,
    ended: status?.ended ?? false,
    ...(options.projected ? { projected: true } : {}),
  }
}

export function clockTime(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

export function freshnessLabel(updatedAtMs: number | null, now: number): string {
  if (updatedAtMs == null) return 'Waiting for an update'
  const seconds = Math.max(0, Math.floor((now - updatedAtMs) / 1_000))
  if (seconds < 8) return 'Updated just now'
  if (seconds < 60) return `Updated ${seconds} sec ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes === 1) return 'Updated 1 min ago'
  return `Updated ${minutes} min ago`
}

export function phaseLabel(train: LiveTrackedTrainStatus | null): string {
  if (!train) return 'Finding the train'
  switch (train.phase) {
    case 'not_started': {
      const inboundNext = train.approach?.nextStop
      if (inboundNext) return `Inbound · next stop ${inboundNext.name}`
      return train.nextStop
        ? `Departs ${train.nextStop.name}${clockTime(train.nextStop.expectedAtMs) ? ` around ${clockTime(train.nextStop.expectedAtMs)}` : ' soon'}`
        : 'Waiting to depart'
    }
    case 'at_station':
      return `At ${train.previousStop?.name ?? train.nextStop?.name ?? train.from.name}`
    case 'in_transit':
      return 'Moving between stations'
    case 'arriving':
      return train.nextStop ? `Approaching ${train.nextStop.name}` : 'Approaching the next stop'
    case 'arrived':
    case 'ended':
      return `Arrived at ${train.to.name}`
    default:
      return 'Updating location'
  }
}

export interface ConnectionOutlook {
  state: 'ok' | 'tight' | 'risk'
  headline: string
  detail: string | null
}

/**
 * Turns the server's transfer outlook into rider-facing copy: comfortable,
 * tight, or at risk, including the transfer walk in the margin. Returns null
 * once there is no upcoming connection to worry about.
 */
export function connectionOutlook(
  connection: LiveTrackerConnection | null | undefined,
  walkMinutes: number | null,
  now: number
): ConnectionOutlook | null {
  if (!connection || connection.boardsAtMs == null) return null
  const boardsClock = clockTime(connection.boardsAtMs) ?? 'soon'
  const lineName = LINE_NAMES[connection.line]
  const walk = walkMinutes != null && walkMinutes > 0 ? Math.round(walkMinutes) : 0

  // Leg 1 already ended: the rider is at (or walking through) the transfer,
  // so the outlook is simply the boarding countdown.
  if (connection.arrivalAtMs == null) {
    const boardsInMinutes = Math.max(0, Math.ceil((connection.boardsAtMs - now) / 60_000))
    return {
      state: 'ok',
      headline: `${lineName} toward ${connection.toward} boards ${boardsClock}`,
      detail: boardsInMinutes <= 0
        ? `Boarding now at ${connection.atName}`
        : `In ${boardsInMinutes} min at ${connection.atName}`,
    }
  }

  const readyAtMs = connection.arrivalAtMs + walk * 60_000
  const marginMinutes = Math.floor((connection.boardsAtMs - readyAtMs) / 60_000)
  if (marginMinutes >= 3) {
    return {
      state: 'ok',
      headline: `You’ll make the ${boardsClock} ${lineName}`,
      detail: `${marginMinutes} min to spare at ${connection.atName}`,
    }
  }
  if (marginMinutes >= 1) {
    return {
      state: 'tight',
      headline: `Tight connection at ${connection.atName}`,
      detail: walk > 0
        ? `${marginMinutes} min to board after the ${walk} min walk`
        : `${marginMinutes} min to board the ${boardsClock} ${lineName}`,
    }
  }
  const nextAfter = connection.alternatives.find(alternative => (
    now + alternative.minutes * 60_000 > (connection.boardsAtMs ?? 0) + 90_000
  ))
  return {
    state: 'risk',
    headline: `You may miss the ${boardsClock} ${lineName}`,
    detail: nextAfter
      ? `Next ${lineName} toward ${nextAfter.destinationName} in ${nextAfter.minutes} min`
      : null,
  }
}

export function arrivalHeadline(arrivalAtMs: number | null, now: number, arrived: boolean): string {
  if (arrived) return 'They’ve arrived'
  if (arrivalAtMs == null) return 'Arrival is updating'
  const minutes = Math.max(0, Math.ceil((arrivalAtMs - now) / 60_000))
  if (minutes === 0) return 'Arriving now'
  if (minutes === 1) return 'Arrives in 1 min'
  return `Arrives in ${minutes} min`
}
