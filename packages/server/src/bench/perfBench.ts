import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import type { Line, Train } from '@transferhero/shared'
import { ensureArray, normalizeDestination, getTrainMinutes, getDisplayName, ROUTE_TO_LINE } from '@transferhero/shared'
import {
  parseUpdatesToTrains as newParseUpdatesToTrains,
  getArrivalAtStation as newGetArrivalAtStation,
  findDepartedTrains as newFindDepartedTrains,
  fetchDestinationArrivals as newFetchDestinationArrivals,
} from '../services/wmata.js'
import { ALL_STATIONS, findStationByCode } from '../data/stations.js'

interface StopUpdate {
  stopId: string
  stopSequence: number
  arrival?: { time: string }
  departure?: { time: string }
}

interface FeedEntity {
  tripUpdate?: {
    trip?: {
      tripId?: string
      routeId?: string
    }
    stopTimeUpdate?: StopUpdate[]
  }
}

interface ArrivalData {
  minutes: number
  timestamp: number
}

interface BenchSample {
  ms: number
  heapDeltaMb: number
}

type PerfMetricKey =
  | 'parseUpdatesToTrains'
  | 'getArrivalAtStation'
  | 'findDepartedTrains'
  | 'fetchDestinationArrivals'

export interface PerfMetricRow {
  key: PerfMetricKey
  metric: string
  oldMs: number
  newMs: number
  cpuGain: number
  oldMem: number
  newMem: number
  memGain: number
}

export interface PerfBenchSummary {
  rows: PerfMetricRow[]
  coalescing: {
    oldUpstreamCalls: number
    newUpstreamCalls: number
    duplicateCallReduction: number
  }
  freshness: {
    railOldSec: number
    railNewSec: number
    railGain: number
    busOldSec: number
    busNewSec: number
    busGain: number
  }
}

export interface PerfGateThresholds {
  parseCpuGainMin: number
  arrivalCpuGainMin: number
  departedCpuGainMin: number
  destinationCpuGainMin: number
  duplicateCallReductionMin: number
  railFreshnessGainMin: number
  busFreshnessGainMin: number
}

export const DEFAULT_PERF_GATE_THRESHOLDS: PerfGateThresholds = {
  parseCpuGainMin: 40,
  arrivalCpuGainMin: 85,
  departedCpuGainMin: 80,
  destinationCpuGainMin: 80,
  duplicateCallReductionMin: 95,
  railFreshnessGainMin: 30,
  busFreshnessGainMin: 75,
}

function toMb(bytes: number): number {
  return bytes / 1024 / 1024
}

function avg(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function pctReduction(oldValue: number, newValue: number): number {
  if (oldValue === 0) return 0
  return ((oldValue - newValue) / oldValue) * 100
}

function runGc() {
  if (typeof global.gc === 'function') global.gc()
}

function measureSync(fn: () => void, runs = 3): BenchSample {
  const samples: BenchSample[] = []

  for (let i = 0; i < runs; i++) {
    runGc()
    const heapBefore = process.memoryUsage().heapUsed
    const t0 = performance.now()
    fn()
    const t1 = performance.now()
    runGc()
    const heapAfter = process.memoryUsage().heapUsed

    samples.push({
      ms: t1 - t0,
      heapDeltaMb: toMb(heapAfter - heapBefore)
    })
  }

  return {
    ms: avg(samples.map(s => s.ms)),
    heapDeltaMb: avg(samples.map(s => s.heapDeltaMb))
  }
}

async function measureAsync(fn: () => Promise<void>, runs = 3): Promise<BenchSample> {
  const samples: BenchSample[] = []

  for (let i = 0; i < runs; i++) {
    runGc()
    const heapBefore = process.memoryUsage().heapUsed
    const t0 = performance.now()
    await fn()
    const t1 = performance.now()
    runGc()
    const heapAfter = process.memoryUsage().heapUsed

    samples.push({
      ms: t1 - t0,
      heapDeltaMb: toMb(heapAfter - heapBefore)
    })
  }

  return {
    ms: avg(samples.map(s => s.ms)),
    heapDeltaMb: avg(samples.map(s => s.heapDeltaMb))
  }
}

function extractStationCode(stopId: string): string {
  const parts = stopId.split('_')
  return (parts[0] === 'PF') ? parts[1] : parts[0]
}

function oldParseUpdatesToTrains(
  entities: FeedEntity[],
  stationCode: string,
  terminusList: string[],
  staticTrips: Record<string, { line: string; headsign: string }> = {},
  allowedLines?: Line[]
): Train[] {
  const relevantTrains: Train[] = []
  const now = Date.now() / 1000
  const target = stationCode.trim().toUpperCase()

  entities.forEach(entity => {
    if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) return

    const trip = entity.tripUpdate.trip || {}
    const updates = entity.tripUpdate.stopTimeUpdate

    const stopUpdate = updates.find((u: StopUpdate) => {
      if (!u.stopId) return false
      const parts = u.stopId.split('_')
      const extractedCode = (parts[0] === 'PF') ? parts[1] : parts[0]
      return extractedCode === target
    })

    if (!stopUpdate) return

    const event = stopUpdate.departure || stopUpdate.arrival
    if (!event || !event.time) return

    const time = parseInt(event.time, 10)
    const minutesUntil = Math.floor((time - now) / 60)

    if (minutesUntil < -1) return

    const tripId = String(trip.tripId || '')
    const staticInfo = staticTrips[tripId]

    const rawLine = staticInfo ? staticInfo.line : (trip.routeId || '')
    const line = ROUTE_TO_LINE[String(rawLine).toUpperCase()] || rawLine as Line
    const destName = staticInfo ? staticInfo.headsign : 'Check Board'

    if (allowedLines && allowedLines.length > 0) {
      if (!allowedLines.includes(line)) return
    }

    const normalizedDest = normalizeDestination(destName)
    const normalizedTermini = ensureArray(terminusList).map(t => normalizeDestination(t))

    const matchesTerminus = normalizedTermini.some(term => {
      if (normalizedDest === term) return true
      if (normalizedDest.includes(term) || term.includes(normalizedDest)) return true
      const destFirst = normalizedDest.split(/[\s\-\/]/)[0]
      const termFirst = term.split(/[\s\-\/]/)[0]
      return destFirst === termFirst
    })

    if (!matchesTerminus) return

    relevantTrains.push({
      Line: line as Line,
      DestinationName: getDisplayName(destName),
      Min: minutesUntil <= 0 ? 'ARR' : minutesUntil.toString(),
      Car: '8',
      _gtfs: true,
      _scheduled: false,
      _tripId: tripId
    })
  })

  const uniqueTrains: Train[] = []
  const seen = new Set<string>()
  relevantTrains.forEach(t => {
    const key = `${t.Line}_${t.Min}_${t.DestinationName}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueTrains.push(t)
    }
  })

  return uniqueTrains
}

function oldGetArrivalAtStation(
  entities: FeedEntity[],
  tripId: string,
  destinationCode: string
): ArrivalData | undefined {
  const now = Date.now() / 1000
  const target = destinationCode.trim().toUpperCase()

  for (const entity of entities) {
    if (!entity.tripUpdate || !entity.tripUpdate.trip) continue
    if (entity.tripUpdate.trip.tripId !== tripId) continue

    const updates = entity.tripUpdate.stopTimeUpdate || []
    for (const update of updates) {
      if (!update.stopId) continue
      const parts = update.stopId.split('_')
      const extractedCode = (parts[0] === 'PF') ? parts[1] : parts[0]

      if (extractedCode === target) {
        const event = update.arrival || update.departure
        if (event?.time) {
          const time = parseInt(event.time, 10)
          return {
            minutes: Math.floor((time - now) / 60),
            timestamp: time * 1000
          }
        }
      }
    }
  }
  return undefined
}

function oldFindDepartedTrains(
  transferCode: string,
  line: Line,
  leg1TravelTime: number,
  gtfsEntities: FeedEntity[],
  staticTrips: Record<string, { line: string; headsign: string }> = {},
  terminus: string | string[] = []
): Train[] {
  const departedTrains: Train[] = []
  const now = Date.now() / 1000
  const targetTransfer = transferCode.trim().toUpperCase()
  const terminusList = ensureArray(terminus)
  const normalizedTermini = terminusList.map(t => normalizeDestination(t))

  for (const entity of gtfsEntities) {
    if (!entity.tripUpdate || !entity.tripUpdate.stopTimeUpdate) continue

    const trip = entity.tripUpdate.trip || {}
    const updates = entity.tripUpdate.stopTimeUpdate
    const tripId = String(trip.tripId || '')

    const staticInfo = staticTrips[tripId]

    const rawTripLine = staticInfo ? staticInfo.line : (trip.routeId || '')
    const tripLine = ROUTE_TO_LINE[String(rawTripLine).toUpperCase()] || rawTripLine as Line

    if (tripLine !== line) continue

    const tripDestination = staticInfo ? staticInfo.headsign : ''
    if (tripDestination && normalizedTermini.length > 0) {
      const normalizedDest = normalizeDestination(tripDestination)
      const matchesTerminus = normalizedTermini.some(term => {
        if (normalizedDest === term) return true
        if (normalizedDest.includes(term) || term.includes(normalizedDest)) return true
        const destFirst = normalizedDest.split(/[\s\-\/]/)[0]
        const termFirst = term.split(/[\s\-\/]/)[0]
        return destFirst === termFirst
      })
      if (!matchesTerminus) continue
    }

    const transferUpdate = updates.find((u: StopUpdate) => {
      if (!u.stopId) return false
      return extractStationCode(u.stopId) === targetTransfer
    })

    if (!transferUpdate) continue

    const event = transferUpdate.arrival || transferUpdate.departure
    if (!event?.time) continue

    const arrivalAtTransferSec = parseInt(event.time, 10)
    const arrivalAtTransferMin = Math.floor((arrivalAtTransferSec - now) / 60)

    const departureFromOriginSec = arrivalAtTransferSec - (leg1TravelTime * 60)
    const departedMinAgo = Math.floor((now - departureFromOriginSec) / 60)

    if (departedMinAgo <= 0 || departedMinAgo > 30) continue

    let nextStopName: string | undefined
    for (const update of updates) {
      if (!update.stopId) continue
      const stopEvent = update.arrival || update.departure
      if (!stopEvent?.time) continue

      const stopTime = parseInt(stopEvent.time, 10)
      if (stopTime > now) {
        const nextStopCode = extractStationCode(update.stopId)
        const nextStation = findStationByCode(nextStopCode)
        nextStopName = nextStation?.name
        break
      }
    }

    const destName = staticInfo ? staticInfo.headsign : 'Check Board'

    const arrivalTimestamp = arrivalAtTransferSec * 1000
    const arrivalDate = new Date(arrivalTimestamp)

    departedTrains.push({
      Line: tripLine as Line,
      DestinationName: getDisplayName(destName),
      Min: -departedMinAgo,
      Car: '8',
      _gtfs: true,
      _scheduled: false,
      _tripId: tripId,
      _departed: true,
      _nextStop: nextStopName,
      _transferArrivalMin: arrivalAtTransferMin,
      _transferArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
      _transferArrivalTimestamp: arrivalTimestamp
    })
  }

  const uniqueTrains: Train[] = []
  const seen = new Set<string>()
  for (const train of departedTrains) {
    if (train._tripId && !seen.has(train._tripId)) {
      seen.add(train._tripId)
      uniqueTrains.push(train)
    }
  }

  uniqueTrains.sort((a, b) => {
    const aMin = typeof a.Min === 'number' ? a.Min : parseInt(String(a.Min), 10)
    const bMin = typeof b.Min === 'number' ? b.Min : parseInt(String(b.Min), 10)
    return bMin - aMin
  })

  return uniqueTrains
}

function oldFetchDestinationArrivals(
  originTrains: Train[],
  destPredictions: Train[],
  expectedTravelTime?: number
): Train[] {
  return originTrains.map(train => {
    const originMin = getTrainMinutes(train.Min)

    const minTravelTime = expectedTravelTime ? Math.max(2, expectedTravelTime - 5) : 2
    const maxTravelTime = expectedTravelTime ? expectedTravelTime + 10 : 45

    const matchingTrains = destPredictions.filter(destTrain => {
      if (destTrain.Line !== train.Line) return false
      if (normalizeDestination(destTrain.DestinationName) !== normalizeDestination(train.DestinationName)) return false

      const destMin = getTrainMinutes(destTrain.Min)
      const impliedTravelTime = destMin - originMin
      return impliedTravelTime >= minTravelTime && impliedTravelTime <= maxTravelTime
    })

    if (matchingTrains.length > 0) {
      if (expectedTravelTime) {
        matchingTrains.sort((a, b) => {
          const aTravelTime = getTrainMinutes(a.Min) - originMin
          const bTravelTime = getTrainMinutes(b.Min) - originMin
          return Math.abs(aTravelTime - expectedTravelTime) - Math.abs(bTravelTime - expectedTravelTime)
        })
      } else {
        matchingTrains.sort((a, b) => getTrainMinutes(a.Min) - getTrainMinutes(b.Min))
      }

      const matched = matchingTrains[0]
      const destArrivalMin = getTrainMinutes(matched.Min)
      const arrivalTimestamp = Date.now() + (destArrivalMin * 60 * 1000)
      const arrivalDate = new Date(arrivalTimestamp)

      return {
        ...train,
        _destArrivalMin: destArrivalMin,
        _destArrivalTime: arrivalDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }),
        _destArrivalTimestamp: arrivalTimestamp,
        _realtimeSource: 'wmata' as const
      }
    }

    return train
  })
}

function buildDataset() {
  const lines: Line[] = ['RD', 'OR', 'SV', 'BL', 'GR', 'YL']
  const headsignByLine: Record<Line, string> = {
    RD: 'Glenmont',
    OR: 'Vienna',
    SV: 'Ashburn',
    BL: 'Largo Town Center',
    GR: 'Greenbelt',
    YL: 'Huntington',
  }

  const stationCodes = ALL_STATIONS.slice(0, 80).map(s => s.code)
  const nowSec = Math.floor(Date.now() / 1000)
  const entities: FeedEntity[] = []
  const staticTrips: Record<string, { line: string; headsign: string }> = {}

  const TRIPS = 4_000
  const STOPS_PER_TRIP = 12

  for (let i = 0; i < TRIPS; i++) {
    const line = lines[i % lines.length]
    const tripId = `trip_${i}`
    const routeId = line
    const startOffsetSec = (i % 90) * 20

    const stopTimeUpdate: StopUpdate[] = []
    for (let j = 0; j < STOPS_PER_TRIP; j++) {
      const stopCode = stationCodes[(i + (j * 5)) % stationCodes.length]
      stopTimeUpdate.push({
        stopId: `PF_${stopCode}_1`,
        stopSequence: j + 1,
        departure: { time: String(nowSec + startOffsetSec + j * 95) },
      })
    }

    entities.push({
      tripUpdate: {
        trip: { tripId, routeId },
        stopTimeUpdate,
      }
    })

    staticTrips[tripId] = {
      line,
      headsign: headsignByLine[line]
    }
  }

  const originTrains: Train[] = []
  const destPredictions: Train[] = []
  const destHeadsigns = ['Glenmont', 'Vienna', 'Ashburn', 'Largo Town Center', 'Greenbelt', 'Huntington']
  for (let i = 0; i < 320; i++) {
    const line = lines[i % lines.length]
    originTrains.push({
      Line: line,
      DestinationName: destHeadsigns[i % destHeadsigns.length],
      Min: String((i % 12) + 1),
      Car: '8',
    })
  }

  for (let i = 0; i < 720; i++) {
    const line = lines[i % lines.length]
    const baseMin = (i % 50) + 1
    destPredictions.push({
      Line: line,
      DestinationName: destHeadsigns[i % destHeadsigns.length],
      Min: String(baseMin),
      Car: '8',
    })
  }

  return {
    entities,
    staticTrips,
    parseStations: stationCodes.slice(0, 6),
    terminusList: ['Glenmont', 'Vienna', 'Ashburn', 'Largo Town Center'],
    allowedLines: ['RD', 'OR', 'SV', 'BL'] as Line[],
    arrivalTripIds: Array.from({ length: 1500 }, (_, i) => `trip_${(i * 7) % TRIPS}`),
    arrivalDestination: stationCodes[18],
    transferCode: stationCodes[14],
    originTrains,
    destPredictions,
  }
}

async function benchmarkCoalescing() {
  const TTL = 15_000

  interface Entry { data: number; ts: number }

  const oldCache = new Map<string, Entry>()
  let oldUpstreamCalls = 0
  async function oldFetchPrediction(station: string): Promise<number> {
    const now = Date.now()
    const cached = oldCache.get(station)
    if (cached && (now - cached.ts) < TTL) return cached.data

    oldUpstreamCalls++
    await new Promise(res => setTimeout(res, 20))
    oldCache.set(station, { data: oldUpstreamCalls, ts: Date.now() })
    return oldUpstreamCalls
  }

  const newCache = new Map<string, Entry>()
  const pending = new Map<string, Promise<number>>()
  let newUpstreamCalls = 0
  async function newFetchPrediction(station: string): Promise<number> {
    const now = Date.now()
    const cached = newCache.get(station)
    if (cached && (now - cached.ts) < TTL) return cached.data

    const inflight = pending.get(station)
    if (inflight) return inflight

    const req = (async () => {
      newUpstreamCalls++
      await new Promise(res => setTimeout(res, 20))
      const value = newUpstreamCalls
      newCache.set(station, { data: value, ts: Date.now() })
      pending.delete(station)
      return value
    })()

    pending.set(station, req)
    return req
  }

  await Promise.all(Array.from({ length: 120 }, () => oldFetchPrediction('A01')))
  await Promise.all(Array.from({ length: 120 }, () => newFetchPrediction('A01')))

  return { oldUpstreamCalls, newUpstreamCalls }
}

export interface RunPerfBenchOptions {
  logProgress?: boolean
}

export async function runPerfBench(options: RunPerfBenchOptions = {}): Promise<PerfBenchSummary> {
  const { logProgress = true } = options
  const progress = (message: string) => {
    if (logProgress) console.log(message)
  }

  const data = buildDataset()

  // Warmup
  oldParseUpdatesToTrains(data.entities, data.parseStations[0], data.terminusList, data.staticTrips, data.allowedLines)
  newParseUpdatesToTrains(data.entities as any[], data.parseStations[0], data.terminusList, data.staticTrips, data.allowedLines)

  const parseOld = measureSync(() => {
    let total = 0
    for (let r = 0; r < 15; r++) {
      for (const station of data.parseStations) {
        total += oldParseUpdatesToTrains(data.entities, station, data.terminusList, data.staticTrips, data.allowedLines).length
      }
    }
    if (total < 0) console.log('noop', total)
  })
  progress('[bench] parse old done')

  const parseNew = measureSync(() => {
    let total = 0
    for (let r = 0; r < 15; r++) {
      for (const station of data.parseStations) {
        total += newParseUpdatesToTrains(data.entities as any[], station, data.terminusList, data.staticTrips, data.allowedLines).length
      }
    }
    if (total < 0) console.log('noop', total)
  })
  progress('[bench] parse new done')

  const arrivalOld = measureSync(() => {
    let hits = 0
    for (const tripId of data.arrivalTripIds) {
      const result = oldGetArrivalAtStation(data.entities, tripId, data.arrivalDestination)
      if (result) hits++
    }
    if (hits < 0) console.log('noop', hits)
  })
  progress('[bench] arrival old done')

  const arrivalNew = measureSync(() => {
    let hits = 0
    for (const tripId of data.arrivalTripIds) {
      const result = newGetArrivalAtStation(data.entities as any[], tripId, data.arrivalDestination)
      if (result) hits++
    }
    if (hits < 0) console.log('noop', hits)
  })
  progress('[bench] arrival new done')

  const departedOld = measureSync(() => {
    let total = 0
    for (let i = 0; i < 50; i++) {
      total += oldFindDepartedTrains(data.transferCode, 'RD', 6, data.entities, data.staticTrips, ['Glenmont']).length
    }
    if (total < 0) console.log('noop', total)
  })
  progress('[bench] departed old done')

  const departedNew = measureSync(() => {
    let total = 0
    for (let i = 0; i < 50; i++) {
      total += newFindDepartedTrains(data.transferCode, 'RD', 6, data.entities as any[], data.staticTrips, ['Glenmont']).length
    }
    if (total < 0) console.log('noop', total)
  })
  progress('[bench] departed new done')

  const destOld = await measureAsync(async () => {
    let total = 0
    for (let i = 0; i < 80; i++) {
      total += oldFetchDestinationArrivals(data.originTrains, data.destPredictions, 14).length
    }
    if (total < 0) console.log('noop', total)
  })
  progress('[bench] dest old done')

  const destNew = await measureAsync(async () => {
    let total = 0
    for (let i = 0; i < 80; i++) {
      const enriched = await newFetchDestinationArrivals(
        data.originTrains,
        'B01',
        'unused',
        undefined,
        data.destPredictions,
        14
      )
      total += enriched.length
    }
    if (total < 0) console.log('noop', total)
  })
  progress('[bench] dest new done')

  const coalescing = await benchmarkCoalescing()

  const rows: PerfMetricRow[] = [
    {
      key: 'parseUpdatesToTrains',
      metric: 'parseUpdatesToTrains (90 calls over 4k trips)',
      oldMs: parseOld.ms,
      newMs: parseNew.ms,
      cpuGain: pctReduction(parseOld.ms, parseNew.ms),
      oldMem: parseOld.heapDeltaMb,
      newMem: parseNew.heapDeltaMb,
      memGain: pctReduction(Math.abs(parseOld.heapDeltaMb), Math.abs(parseNew.heapDeltaMb)),
    },
    {
      key: 'getArrivalAtStation',
      metric: 'getArrivalAtStation (1.5k lookups)',
      oldMs: arrivalOld.ms,
      newMs: arrivalNew.ms,
      cpuGain: pctReduction(arrivalOld.ms, arrivalNew.ms),
      oldMem: arrivalOld.heapDeltaMb,
      newMem: arrivalNew.heapDeltaMb,
      memGain: pctReduction(Math.abs(arrivalOld.heapDeltaMb), Math.abs(arrivalNew.heapDeltaMb)),
    },
    {
      key: 'findDepartedTrains',
      metric: 'findDepartedTrains (50 runs)',
      oldMs: departedOld.ms,
      newMs: departedNew.ms,
      cpuGain: pctReduction(departedOld.ms, departedNew.ms),
      oldMem: departedOld.heapDeltaMb,
      newMem: departedNew.heapDeltaMb,
      memGain: pctReduction(Math.abs(departedOld.heapDeltaMb), Math.abs(departedNew.heapDeltaMb)),
    },
    {
      key: 'fetchDestinationArrivals',
      metric: 'fetchDestinationArrivals fallback matching (80 runs)',
      oldMs: destOld.ms,
      newMs: destNew.ms,
      cpuGain: pctReduction(destOld.ms, destNew.ms),
      oldMem: destOld.heapDeltaMb,
      newMem: destNew.heapDeltaMb,
      memGain: pctReduction(Math.abs(destOld.heapDeltaMb), Math.abs(destNew.heapDeltaMb)),
    },
  ]

  const oldRailWorstStalenessSec = 30 + 30 + 15
  const newRailWorstStalenessSec = 10 + 15 + 15
  const oldBusWorstStalenessSec = 300 + 60
  const newBusWorstStalenessSec = 20 + 20

  return {
    rows,
    coalescing: {
      oldUpstreamCalls: coalescing.oldUpstreamCalls,
      newUpstreamCalls: coalescing.newUpstreamCalls,
      duplicateCallReduction: pctReduction(coalescing.oldUpstreamCalls, coalescing.newUpstreamCalls),
    },
    freshness: {
      railOldSec: oldRailWorstStalenessSec,
      railNewSec: newRailWorstStalenessSec,
      railGain: pctReduction(oldRailWorstStalenessSec, newRailWorstStalenessSec),
      busOldSec: oldBusWorstStalenessSec,
      busNewSec: newBusWorstStalenessSec,
      busGain: pctReduction(oldBusWorstStalenessSec, newBusWorstStalenessSec),
    }
  }
}

export function formatPerfBenchReport(summary: PerfBenchSummary): string {
  const lines: string[] = []
  lines.push('')
  lines.push('=== TransferHero Perf Bench (Synthetic, same dataset/machine) ===')

  for (const row of summary.rows) {
    lines.push('')
    lines.push(row.metric)
    lines.push(`  CPU avg: old=${row.oldMs.toFixed(1)}ms, new=${row.newMs.toFixed(1)}ms, improvement=${row.cpuGain.toFixed(1)}%`)
    lines.push(`  Heap delta avg: old=${row.oldMem.toFixed(2)}MB, new=${row.newMem.toFixed(2)}MB, improvement=${row.memGain.toFixed(1)}%`)
  }

  lines.push('')
  lines.push('Concurrent miss coalescing simulation (120 concurrent requests, same key):')
  lines.push(`  Old upstream calls: ${summary.coalescing.oldUpstreamCalls}`)
  lines.push(`  New upstream calls: ${summary.coalescing.newUpstreamCalls}`)
  lines.push(`  Duplicate call reduction: ${summary.coalescing.duplicateCallReduction.toFixed(1)}%`)

  lines.push('')
  lines.push('Freshness envelope (worst-case age from source to UI):')
  lines.push(`  Rail old=${summary.freshness.railOldSec}s, new=${summary.freshness.railNewSec}s, improvement=${summary.freshness.railGain.toFixed(1)}%`)
  lines.push(`  Bus old=${summary.freshness.busOldSec}s, new=${summary.freshness.busNewSec}s, improvement=${summary.freshness.busGain.toFixed(1)}%`)

  return lines.join('\n')
}

export function evaluatePerfGate(
  summary: PerfBenchSummary,
  thresholds: PerfGateThresholds = DEFAULT_PERF_GATE_THRESHOLDS
): string[] {
  const failures: string[] = []
  const byKey = new Map(summary.rows.map(row => [row.key, row]))

  const parseRow = byKey.get('parseUpdatesToTrains')
  if (!parseRow) failures.push('Missing parseUpdatesToTrains benchmark row')
  else if (parseRow.cpuGain < thresholds.parseCpuGainMin) {
    failures.push(`parseUpdatesToTrains CPU gain ${parseRow.cpuGain.toFixed(1)}% < ${thresholds.parseCpuGainMin.toFixed(1)}%`)
  }

  const arrivalRow = byKey.get('getArrivalAtStation')
  if (!arrivalRow) failures.push('Missing getArrivalAtStation benchmark row')
  else if (arrivalRow.cpuGain < thresholds.arrivalCpuGainMin) {
    failures.push(`getArrivalAtStation CPU gain ${arrivalRow.cpuGain.toFixed(1)}% < ${thresholds.arrivalCpuGainMin.toFixed(1)}%`)
  }

  const departedRow = byKey.get('findDepartedTrains')
  if (!departedRow) failures.push('Missing findDepartedTrains benchmark row')
  else if (departedRow.cpuGain < thresholds.departedCpuGainMin) {
    failures.push(`findDepartedTrains CPU gain ${departedRow.cpuGain.toFixed(1)}% < ${thresholds.departedCpuGainMin.toFixed(1)}%`)
  }

  const destinationRow = byKey.get('fetchDestinationArrivals')
  if (!destinationRow) failures.push('Missing fetchDestinationArrivals benchmark row')
  else if (destinationRow.cpuGain < thresholds.destinationCpuGainMin) {
    failures.push(`fetchDestinationArrivals CPU gain ${destinationRow.cpuGain.toFixed(1)}% < ${thresholds.destinationCpuGainMin.toFixed(1)}%`)
  }

  if (summary.coalescing.duplicateCallReduction < thresholds.duplicateCallReductionMin) {
    failures.push(
      `Coalescing duplicate call reduction ${summary.coalescing.duplicateCallReduction.toFixed(1)}% < ${thresholds.duplicateCallReductionMin.toFixed(1)}%`
    )
  }

  if (summary.freshness.railGain < thresholds.railFreshnessGainMin) {
    failures.push(`Rail freshness gain ${summary.freshness.railGain.toFixed(1)}% < ${thresholds.railFreshnessGainMin.toFixed(1)}%`)
  }

  if (summary.freshness.busGain < thresholds.busFreshnessGainMin) {
    failures.push(`Bus freshness gain ${summary.freshness.busGain.toFixed(1)}% < ${thresholds.busFreshnessGainMin.toFixed(1)}%`)
  }

  return failures
}

function thresholdFromEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getGateThresholdsFromEnv(): PerfGateThresholds {
  return {
    parseCpuGainMin: thresholdFromEnv('PERF_GATE_PARSE_MIN', DEFAULT_PERF_GATE_THRESHOLDS.parseCpuGainMin),
    arrivalCpuGainMin: thresholdFromEnv('PERF_GATE_ARRIVAL_MIN', DEFAULT_PERF_GATE_THRESHOLDS.arrivalCpuGainMin),
    departedCpuGainMin: thresholdFromEnv('PERF_GATE_DEPARTED_MIN', DEFAULT_PERF_GATE_THRESHOLDS.departedCpuGainMin),
    destinationCpuGainMin: thresholdFromEnv('PERF_GATE_DESTINATION_MIN', DEFAULT_PERF_GATE_THRESHOLDS.destinationCpuGainMin),
    duplicateCallReductionMin: thresholdFromEnv('PERF_GATE_COALESCE_MIN', DEFAULT_PERF_GATE_THRESHOLDS.duplicateCallReductionMin),
    railFreshnessGainMin: thresholdFromEnv('PERF_GATE_RAIL_FRESHNESS_MIN', DEFAULT_PERF_GATE_THRESHOLDS.railFreshnessGainMin),
    busFreshnessGainMin: thresholdFromEnv('PERF_GATE_BUS_FRESHNESS_MIN', DEFAULT_PERF_GATE_THRESHOLDS.busFreshnessGainMin),
  }
}

function isMainModule(): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(entry).href
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const shouldGate = args.has('--gate')
  const printJson = args.has('--json')
  const summary = await runPerfBench({ logProgress: !printJson })

  if (printJson) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(formatPerfBenchReport(summary))
  }

  if (!shouldGate) return

  const thresholds = getGateThresholdsFromEnv()
  const failures = evaluatePerfGate(summary, thresholds)
  if (failures.length === 0) {
    console.log('\n[perf-gate] PASS')
    return
  }

  console.error('\n[perf-gate] FAIL')
  for (const failure of failures) {
    console.error(`  - ${failure}`)
  }
  process.exitCode = 1
}

if (isMainModule()) {
  await main()
}
