export interface GtfsTripProgressStop {
  stopCode: string
  timeMs: number
  sequence: number
}

export interface GtfsTripProgress {
  tripId: string
  routeId: string
  stops: GtfsTripProgressStop[]
  previousStop?: GtfsTripProgressStop
  nextStop?: GtfsTripProgressStop
}

function extractStationCode(stopId: string): string {
  const parts = stopId.split('_')
  return (parts[0] === 'PF' ? parts[1] : parts[0]).trim().toUpperCase()
}

/** Return ordered, normalized stop progress for one decoded GTFS trip update. */
export function getGTFSTripProgress(
  entities: any[],
  tripId: string,
  nowMs: number = Date.now()
): GtfsTripProgress | undefined {
  if (!tripId || !Number.isFinite(nowMs)) return undefined
  // Match the indexer's last-write-wins behavior if an upstream feed repeats a trip ID.
  let tripUpdate: any
  for (const entity of entities) {
    if (entity?.tripUpdate?.trip?.tripId === tripId) tripUpdate = entity.tripUpdate
  }
  if (!tripUpdate) return undefined

  const updates = Array.isArray(tripUpdate.stopTimeUpdate) ? tripUpdate.stopTimeUpdate : []
  const stops: GtfsTripProgressStop[] = []
  for (const update of updates) {
    if (!update?.stopId) continue
    const event = update.departure ?? update.arrival
    const timeSec = Number.parseInt(String(event?.time ?? ''), 10)
    if (!Number.isFinite(timeSec)) continue
    const sequenceValue = Number.parseInt(String(update.stopSequence ?? ''), 10)
    stops.push({
      stopCode: extractStationCode(String(update.stopId)),
      timeMs: timeSec * 1000,
      sequence: Number.isFinite(sequenceValue) ? sequenceValue : stops.length,
    })
  }
  if (stops.length === 0) return undefined
  stops.sort((left, right) => left.sequence - right.sequence || left.timeMs - right.timeMs)

  let previousStop: GtfsTripProgressStop | undefined
  let nextStop: GtfsTripProgressStop | undefined
  for (const stop of stops) {
    if (stop.timeMs <= nowMs) previousStop = stop
    else {
      nextStop = stop
      break
    }
  }

  return {
    tripId,
    routeId: String(tripUpdate.trip?.routeId ?? ''),
    stops,
    previousStop,
    nextStop,
  }
}
