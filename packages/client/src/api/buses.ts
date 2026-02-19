import type { HybridTrip, BusPrediction, BusAgencyId } from '@transferhero/shared'

const API_BASE = '/api'
const FETCH_INIT: RequestInit = { cache: 'no-store' }

export interface BusTripsResponse {
  trips: HybridTrip[]
  busDataAvailable: boolean
}

export interface BusWalkEnrichment {
  board: { walkTimeMinutes: number; walkDistanceMeters: number } | null
  alight: { walkTimeMinutes: number; walkDistanceMeters: number } | null
}

export async function fetchBusTrips(
  originLat: number | undefined,
  originLon: number | undefined,
  destLat: number | undefined,
  destLon: number | undefined,
  originStation: string,
  destStation: string
): Promise<BusTripsResponse> {
  const params = new URLSearchParams({ originStation, destStation })
  if (originLat != null) params.set('originLat', originLat.toString())
  if (originLon != null) params.set('originLon', originLon.toString())
  if (destLat != null) params.set('destLat', destLat.toString())
  if (destLon != null) params.set('destLon', destLon.toString())

  const res = await fetch(`${API_BASE}/buses/trips?${params}`, FETCH_INIT)
  if (!res.ok) return { trips: [], busDataAvailable: false }
  return res.json()
}

export async function fetchBusPredictions(
  stopCode: string,
  routeId: string,
  boardStopId?: string,
  alightStopId?: string,
  agencyId?: BusAgencyId,
): Promise<BusPrediction[]> {
  const params = new URLSearchParams({ stopCode, routeId })
  if (boardStopId) params.set('boardStopId', boardStopId)
  if (alightStopId) params.set('alightStopId', alightStopId)
  if (agencyId) params.set('agencyId', agencyId)
  const res = await fetch(`${API_BASE}/buses/predictions?${params}`, FETCH_INIT)
  if (!res.ok) return []
  const data = await res.json()
  return data.predictions ?? []
}

export async function fetchBusWalkDirections(
  boardStop: { lat: number; lon: number },
  alightStop: { lat: number; lon: number },
  boardFrom: { lat: number; lon: number },
  alightTo: { lat: number; lon: number }
): Promise<BusWalkEnrichment> {
  const params = new URLSearchParams({
    boardStopLat: boardStop.lat.toString(),
    boardStopLon: boardStop.lon.toString(),
    alightStopLat: alightStop.lat.toString(),
    alightStopLon: alightStop.lon.toString(),
    boardFromLat: boardFrom.lat.toString(),
    boardFromLon: boardFrom.lon.toString(),
    alightToLat: alightTo.lat.toString(),
    alightToLon: alightTo.lon.toString(),
  })

  const res = await fetch(`${API_BASE}/buses/walk?${params}`, FETCH_INIT)
  if (!res.ok) return { board: null, alight: null }
  return res.json()
}
