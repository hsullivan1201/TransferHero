import type { Station, Train, CatchableTrain, TransferResult, CarPosition, Line } from '@transferhero/shared'

const API_BASE = '/api'
const FETCH_INIT: RequestInit = { cache: 'no-store' }

export interface TripResponse {
  trip: {
    origin: Station
    destination: Station
    isDirect: boolean
    transfer: TransferResult | null
    leg1: {
      trains: Train[]
      carPosition: CarPosition | null
      lineCarPositions?: Partial<Record<Line, CarPosition>>
      stops?: Station[]
      stopsBeyond?: Station[]
      lineStops?: Partial<Record<Line, Station[]>>
      lineStopsBeyond?: Partial<Record<Line, Station[]>>
      /** canonical per-line terminus names for signage (not short-turn headsigns) */
      directionLabels?: Partial<Record<Line, string>>
    }
    leg2?: {
      trains: CatchableTrain[]
      carPosition: CarPosition | null
      stops?: Station[]
      stopsBeyond?: Station[]
      /** canonical per-line terminus names for signage (not short-turn headsigns) */
      directionLabels?: Partial<Record<Line, string>>
    }
  }
  meta: {
    fetchedAt: string
    sources: string[]
    scheduleOnly?: boolean
    plannedFor?: string
    planningMode?: 'departAt' | 'arriveBy'
  }
}

export interface StationsResponse {
  stations: Station[]
}

export interface Leg2Response {
  trains: CatchableTrain[]
  arrivalAtTransfer: number
  arrivalTime: string
  carPosition?: CarPosition
  exitCarPosition?: CarPosition
  meta?: {
    fetchedAt: string
    sources?: string[]
  }
}

export async function fetchStations(): Promise<Station[]> {
  const res = await fetch(`${API_BASE}/stations`, FETCH_INIT)
  if (!res.ok) throw new Error('Failed to fetch stations')
  const data: StationsResponse = await res.json()
  return data.stations
}

export async function fetchTrip(
  from: string,
  to: string,
  walkTime: number = 2,
  transferStation?: string,
  accessible: boolean = false,
  includeDeparted: boolean = false,
  departAt?: number | null,
  arriveBy?: number | null,
  originWalkMinutes: number = 0,
  destinationWalkMinutes: number = 0
): Promise<TripResponse> {
  const params = new URLSearchParams({
    from,
    to,
    walkTime: walkTime.toString(),
    accessible: accessible.toString(),
    includeDeparted: includeDeparted.toString(),
    originWalkMinutes: originWalkMinutes.toString(),
    destinationWalkMinutes: destinationWalkMinutes.toString(),
  })
  if (transferStation) {
    params.set('transferStation', transferStation)
  }
  if (departAt) {
    params.set('departAt', departAt.toString())
  }
  if (arriveBy) {
    params.set('arriveBy', arriveBy.toString())
  }
  const res = await fetch(`${API_BASE}/trips?${params}`, FETCH_INIT)
  if (!res.ok) throw new Error('Failed to fetch trip')
  return res.json()
}

export async function fetchLeg2(
  tripId: string,
  departureMin: number,
  walkTime: number = 2,
  transferStation?: string,
  transferArrivalMin?: number,
  accessible: boolean = false,
  includeDeparted: boolean = false
): Promise<Leg2Response> {
  const params = new URLSearchParams({
    departureMin: departureMin.toString(),
    walkTime: walkTime.toString(),
    accessible: accessible.toString(),
    includeDeparted: includeDeparted.toString()
  })
  if (transferStation) {
    params.set('transferStation', transferStation)
  }
  // toss in realtime transfer arrival if we have it
  if (transferArrivalMin !== undefined) {
    params.set('transferArrivalMin', transferArrivalMin.toString())
  }
  const res = await fetch(`${API_BASE}/trips/${tripId}/leg2?${params}`, FETCH_INIT)
  if (!res.ok) throw new Error('Failed to fetch leg 2 trains')
  return res.json()
}
