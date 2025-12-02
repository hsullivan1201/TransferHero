import type { Station, Train, CatchableTrain, TransferResult, CarPosition } from '@transferhero/shared'

const API_BASE = '/api'

export interface TripResponse {
  trip: {
    origin: Station
    destination: Station
    isDirect: boolean
    transfer: TransferResult | null
    leg1: {
      trains: Train[]
      carPosition: CarPosition | null
    }
    leg2?: {
      trains: CatchableTrain[]
      carPosition: CarPosition | null
    }
  }
  meta: {
    fetchedAt: string
    sources: string[]
  }
}

export interface StationsResponse {
  stations: Station[]
}

export interface Leg2Response {
  trains: CatchableTrain[]
  arrivalAtTransfer: number
  arrivalTime: string
}

export async function fetchStations(): Promise<Station[]> {
  const res = await fetch(`${API_BASE}/stations`)
  if (!res.ok) throw new Error('Failed to fetch stations')
  const data: StationsResponse = await res.json()
  return data.stations
}

export async function fetchTrip(
  from: string,
  to: string,
  walkTime: number = 3,
  transferStation?: string
): Promise<TripResponse> {
  const params = new URLSearchParams({
    from,
    to,
    walkTime: walkTime.toString()
  })
  if (transferStation) {
    params.set('transferStation', transferStation)
  }
  const res = await fetch(`${API_BASE}/trips?${params}`)
  if (!res.ok) throw new Error('Failed to fetch trip')
  return res.json()
}

export async function fetchLeg2(
  tripId: string,
  departureMin: number,
  walkTime: number = 3,
  transferStation?: string
): Promise<Leg2Response> {
  const params = new URLSearchParams({
    departureMin: departureMin.toString(),
    walkTime: walkTime.toString()
  })
  if (transferStation) {
    params.set('transferStation', transferStation)
  }
  const res = await fetch(`${API_BASE}/trips/${tripId}/leg2?${params}`)
  if (!res.ok) throw new Error('Failed to fetch leg 2 trains')
  return res.json()
}
