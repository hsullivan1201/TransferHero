export interface PlanTripInput {
  from: string
  to: string
  walkTime: number
  transferStation?: string
  accessible: boolean
  includeDeparted: boolean
  apiKey: string
  /** epoch ms — leave the actual origin at this time */
  departAt?: number
  /** epoch ms — reach the actual destination by this time */
  arriveBy?: number
  originWalkMinutes?: number
  destinationWalkMinutes?: number
}

export interface PlanLeg2Input {
  tripId: string
  departureMin: number
  walkTime: number
  transferStation?: string
  transferArrivalMin?: number
  accessible: boolean
  includeDeparted: boolean
  apiKey: string
}

export interface TripPlanner {
  planTrip(input: PlanTripInput): Promise<any>
  planLeg2(input: PlanLeg2Input): Promise<any>
}
