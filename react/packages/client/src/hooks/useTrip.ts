import { useQuery, useMutation } from '@tanstack/react-query'
import { fetchStations, fetchTrip, fetchLeg2 } from '../api/trips'
import type { Station, Train, TransferAlternative } from '@transferhero/shared'
import { getTrainMinutes } from '../utils/time'

export function useStations() {
  return useQuery({
    queryKey: ['stations'],
    queryFn: fetchStations,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    gcTime: 24 * 60 * 60 * 1000,
  })
}

export function useTrip(
  from: string | null,
  to: string | null,
  walkTime: number,
  transferStation?: string | null
) {
  return useQuery({
    queryKey: ['trip', from, to, walkTime, transferStation],
    queryFn: () => fetchTrip(from!, to!, walkTime, transferStation || undefined),
    enabled: !!from && !!to,
    staleTime: 30 * 1000, // 30 seconds for real-time data
    refetchInterval: 30 * 1000, // Auto-refresh every 30 seconds
  })
}

interface UseLeg2Options {
  tripId: string
  departureMin: number
  walkTime: number
  transferStation?: string | null
  enabled: boolean
}

export function useLeg2({ tripId, departureMin, walkTime, transferStation, enabled }: UseLeg2Options) {
  return useQuery({
    queryKey: ['leg2', tripId, departureMin, walkTime, transferStation],
    queryFn: () => fetchLeg2(tripId, departureMin, walkTime, transferStation || undefined),
    enabled,
    staleTime: 30 * 1000,
  })
}

// Hook to manage trip state
import { useState, useCallback, useMemo } from 'react'

interface TripState {
  from: Station | null
  to: Station | null
  walkTime: number
  selectedLeg1Train: Train | null
  selectedLeg1Index: number | undefined
  selectedAlternative: TransferAlternative | null
}

export function useTripState() {
  const [state, setState] = useState<TripState>({
    from: null,
    to: null,
    walkTime: 3,
    selectedLeg1Train: null,
    selectedLeg1Index: undefined,
    selectedAlternative: null,
  })

  const setFrom = useCallback((station: Station | null) => {
    setState(prev => ({
      ...prev,
      from: station,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
    }))
  }, [])

  const setTo = useCallback((station: Station | null) => {
    setState(prev => ({
      ...prev,
      to: station,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
    }))
  }, [])

  const setWalkTime = useCallback((walkTime: number) => {
    setState(prev => ({ ...prev, walkTime }))
  }, [])

  const selectLeg1Train = useCallback((train: Train, index: number) => {
    setState(prev => ({
      ...prev,
      selectedLeg1Train: train,
      selectedLeg1Index: index,
    }))
  }, [])

  const selectAlternative = useCallback((alternative: TransferAlternative | null) => {
    setState(prev => ({
      ...prev,
      selectedAlternative: alternative,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
    }))
  }, [])

  const startTrip = useCallback((from: Station, to: Station, walkTime: number) => {
    setState({
      from,
      to,
      walkTime,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
    })
  }, [])

  const reset = useCallback(() => {
    setState({
      from: null,
      to: null,
      walkTime: 3,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
    })
  }, [])

  const tripId = useMemo(() => {
    if (!state.from || !state.to) return null
    return `${state.from.code}-${state.to.code}`
  }, [state.from, state.to])

  const departureMin = useMemo(() => {
    if (!state.selectedLeg1Train) return 0
    return getTrainMinutes(state.selectedLeg1Train.Min)
  }, [state.selectedLeg1Train])

  return {
    ...state,
    tripId,
    departureMin,
    setFrom,
    setTo,
    setWalkTime,
    selectLeg1Train,
    selectAlternative,
    startTrip,
    reset,
  }
}
