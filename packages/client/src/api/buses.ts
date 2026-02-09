import type { HybridTrip } from '@transferhero/shared'

const API_BASE = '/api'

export interface BusTripsResponse {
  trips: HybridTrip[]
  busDataAvailable: boolean
}

export interface BusWalkEnrichment {
  board: { walkTimeMinutes: number; walkDistanceMeters: number } | null
  alight: { walkTimeMinutes: number; walkDistanceMeters: number } | null
}

export async function fetchBusTrips(
  originLat: number,
  originLon: number,
  destLat: number,
  destLon: number,
  originStation: string,
  destStation: string
): Promise<BusTripsResponse> {
  const params = new URLSearchParams({
    originLat: originLat.toString(),
    originLon: originLon.toString(),
    destLat: destLat.toString(),
    destLon: destLon.toString(),
    originStation,
    destStation,
  })

  const res = await fetch(`${API_BASE}/buses/trips?${params}`)
  if (!res.ok) return { trips: [], busDataAvailable: false }
  return res.json()
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

  const res = await fetch(`${API_BASE}/buses/walk?${params}`)
  if (!res.ok) return { board: null, alight: null }
  return res.json()
}
