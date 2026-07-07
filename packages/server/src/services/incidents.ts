import type { Line, RailIncident, ElevatorIncident, AlertsResponse } from '@transferhero/shared'
import { ROUTE_TO_LINE } from '@transferhero/shared'
import { fetchWithTimeout } from '../utils/http.js'

const INCIDENTS_TTL = 60_000
const INCIDENTS_TIMEOUT_MS = 8_000

const RAIL_INCIDENTS_URL = 'https://api.wmata.com/Incidents.svc/json/Incidents'
const ELEVATOR_INCIDENTS_URL = 'https://api.wmata.com/Incidents.svc/json/ElevatorIncidents'

type FetchLike = typeof fetchWithTimeout

interface IncidentsCacheEntry {
  data: AlertsResponse
  ts: number
}

let cache: IncidentsCacheEntry | null = null
let pendingRequest: Promise<AlertsResponse> | null = null

const stats = { calls: 0, failures: 0, cacheHits: 0 }

// Raw WMATA payload shapes (fields we consume)
interface RawRailIncident {
  IncidentID?: string
  Description?: string
  IncidentType?: string
  LinesAffected?: string
  DateUpdated?: string
}

interface RawElevatorIncident {
  UnitType?: string
  StationCode?: string
  StationName?: string
  LocationDescription?: string
  SymptomDescription?: string
  DateOutOfServ?: string
}

/** WMATA sends LinesAffected like "RD;" or "BL; OR; SV;" — keep only real line codes. */
export function parseLinesAffected(raw: string | undefined): Line[] {
  if (!raw) return []
  const lines = raw
    .split(/[;,\s]+/)
    .map(s => ROUTE_TO_LINE[s.trim().toUpperCase()])
    .filter((line): line is Line => line !== undefined)
  return [...new Set(lines)]
}

function parseRailIncidents(payload: { Incidents?: RawRailIncident[] }): RailIncident[] {
  return (payload.Incidents ?? []).map(raw => ({
    incidentId: raw.IncidentID ?? '',
    description: raw.Description ?? '',
    incidentType: raw.IncidentType ?? 'Alert',
    linesAffected: parseLinesAffected(raw.LinesAffected),
    dateUpdated: raw.DateUpdated ?? '',
  }))
}

function parseElevatorIncidents(payload: { ElevatorIncidents?: RawElevatorIncident[] }): ElevatorIncident[] {
  return (payload.ElevatorIncidents ?? []).map(raw => ({
    unitType: raw.UnitType === 'ESCALATOR' ? 'ESCALATOR' as const : 'ELEVATOR' as const,
    stationCode: raw.StationCode ?? '',
    stationName: raw.StationName ?? '',
    locationDescription: raw.LocationDescription ?? '',
    symptomDescription: raw.SymptomDescription ?? '',
    dateOutOfServ: raw.DateOutOfServ ?? '',
  }))
}

async function fetchJson<T>(url: string, apiKey: string, fetchFn: FetchLike): Promise<T> {
  const response = await fetchFn(url, {
    timeoutMs: INCIDENTS_TIMEOUT_MS,
    headers: { 'api_key': apiKey },
  })
  if (!response.ok) {
    throw new Error(`WMATA incidents API error: ${response.status}`)
  }
  return response.json() as Promise<T>
}

/**
 * Fetch rail + elevator/escalator incidents from WMATA, cached for 60s with
 * in-flight coalescing and stale-on-failure fallback (same pattern as the
 * prediction caches in wmata.ts). The two upstream calls are independent —
 * one failing doesn't blank the other.
 */
export async function getIncidents(apiKey: string, fetchFn: FetchLike = fetchWithTimeout): Promise<AlertsResponse> {
  const now = Date.now()

  if (cache && (now - cache.ts) < INCIDENTS_TTL) {
    stats.cacheHits++
    return cache.data
  }

  if (pendingRequest) {
    return pendingRequest
  }

  const request = (async () => {
    try {
      stats.calls++
      const [railResult, elevatorResult] = await Promise.allSettled([
        fetchJson<{ Incidents?: RawRailIncident[] }>(RAIL_INCIDENTS_URL, apiKey, fetchFn),
        fetchJson<{ ElevatorIncidents?: RawElevatorIncident[] }>(ELEVATOR_INCIDENTS_URL, apiKey, fetchFn),
      ])

      if (railResult.status === 'rejected' && elevatorResult.status === 'rejected') {
        throw railResult.reason
      }

      const data: AlertsResponse = {
        railIncidents: railResult.status === 'fulfilled'
          ? parseRailIncidents(railResult.value)
          : cache?.data.railIncidents ?? [],
        elevatorIncidents: elevatorResult.status === 'fulfilled'
          ? parseElevatorIncidents(elevatorResult.value)
          : cache?.data.elevatorIncidents ?? [],
        meta: { fetchedAt: new Date().toISOString() },
      }

      cache = { data, ts: Date.now() }
      return data
    } catch (error) {
      stats.failures++
      if (cache) {
        console.warn('[Incidents] fetch failed, serving stale cache', error)
        return cache.data
      }
      throw error
    } finally {
      pendingRequest = null
    }
  })()

  pendingRequest = request
  return request
}

export function getIncidentsStats() {
  return { ...stats }
}

export function resetIncidentsCache(): void {
  cache = null
  pendingRequest = null
  stats.calls = 0
  stats.failures = 0
  stats.cacheHits = 0
}

/** Test hook: age the cache past its TTL without waiting. */
export function expireIncidentsCache(): void {
  if (cache) cache.ts = 0
}
