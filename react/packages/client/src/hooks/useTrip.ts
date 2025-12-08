import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { fetchStations, fetchTrip, fetchLeg2 } from '../api/trips'
import type { Station, Train, TransferAlternative } from '@transferhero/shared'
import { getTrainMinutes } from '../utils/time'

// please don't touch these hooks—they've earned their keep.

export function useStations() {
  return useQuery({
    queryKey: ['stations'],
    queryFn: fetchStations,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
  })
}

export function useTrip(
  from: string | null,
  to: string | null,
  walkTime: number,
  transferStation?: string | null,
  accessible: boolean = false,
  showDeparted: boolean = false
) {
  return useQuery({
    queryKey: ['trip', from, to, walkTime, transferStation, accessible, showDeparted],
    queryFn: () => fetchTrip(from!, to!, walkTime, transferStation || undefined, accessible, showDeparted),
    enabled: !!from && !!to,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface UseLeg2Options {
  tripId: string
  departureTimestamp: number | null
  walkTime: number
  transferStation?: string | null
  enabled: boolean
  /** realtime arrival at the transfer stop from the picked train's _destArrivalMin */
  transferArrivalMin?: number
  accessible?: boolean
}

export function useLeg2({ tripId, departureTimestamp, walkTime, transferStation, enabled, transferArrivalMin, accessible = false }: UseLeg2Options) {
  return useQuery({
    queryKey: ['leg2', tripId, departureTimestamp, walkTime, transferStation, transferArrivalMin, accessible],
    queryFn: () => {
      const currentDepartureMin = departureTimestamp
        ? Math.round((departureTimestamp - Date.now()) / 60000)
        : 0

      return fetchLeg2(tripId, currentDepartureMin, walkTime, transferStation || undefined, transferArrivalMin, accessible)
    },
    enabled,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  })
}

interface TripState {
  from: Station | null
  to: Station | null
  walkTime: number
  selectedLeg1Train: Train | null
  selectedLeg1Index: number | undefined
  selectedAlternative: TransferAlternative | null
  departureTimestamp: number | null
  accessible: boolean
  showDeparted: boolean
}

export function useTripState() {
  const [state, setState] = useState<TripState>({
    from: null,
    to: null,
    walkTime: 3,
    selectedLeg1Train: null,
    selectedLeg1Index: undefined,
    selectedAlternative: null,
    departureTimestamp: null,
    accessible: false,
    showDeparted: false,
  })

  const setFrom = useCallback((station: Station | null) => {
    setState(prev => ({
      ...prev,
      from: station,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
      departureTimestamp: null,
    }))
  }, [])

  const setTo = useCallback((station: Station | null) => {
    setState(prev => ({
      ...prev,
      to: station,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
      departureTimestamp: null,
    }))
  }, [])

  const setWalkTime = useCallback((walkTime: number) => {
    setState(prev => ({ ...prev, walkTime }))
  }, [])

  const selectLeg1Train = useCallback((train: Train, index: number) => {
    const min = getTrainMinutes(train.Min)
    const departureTimestamp = Date.now() + (min * 60 * 1000)

    setState(prev => ({
      ...prev,
      selectedLeg1Train: train,
      selectedLeg1Index: index,
      departureTimestamp,
    }))
  }, [])

  // little helper to wipe the picked train
  const clearLeg1Selection = useCallback(() => {
    setState(prev => ({
      ...prev,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      departureTimestamp: null,
    }))
  }, [])

  const selectAlternative = useCallback((alternative: TransferAlternative | null) => {
    setState(prev => ({
      ...prev,
      selectedAlternative: alternative,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      departureTimestamp: null,
    }))
  }, [])

  const toggleAccessible = useCallback(() => {
    setState(prev => ({
      ...prev,
      accessible: !prev.accessible,
    }))
  }, [])

  const toggleShowDeparted = useCallback(() => {
    setState(prev => ({
      ...prev,
      showDeparted: !prev.showDeparted,
    }))
  }, [])

  const startTrip = useCallback((from: Station, to: Station, walkTime: number) => {
    setState(prev => ({
      from,
      to,
      walkTime,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
      departureTimestamp: null,
      accessible: prev.accessible, // keep whatever accessibility mode the rider picked
      showDeparted: prev.showDeparted, // keep the departed toggle as-is
    }))
  }, [])

  const reset = useCallback(() => {
    setState(prev => ({
      from: null,
      to: null,
      walkTime: 3,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
      departureTimestamp: null,
      accessible: prev.accessible, // keep accessibility preference
      showDeparted: false, // but drop the departed toggle on a full reset
    }))
  }, [])

  const tripId = useMemo(() => {
    if (!state.from || !state.to) return null
    return `${state.from.code}-${state.to.code}`
  }, [state.from, state.to])

  return {
    ...state,
    tripId,
    setFrom,
    setTo,
    setWalkTime,
    selectLeg1Train,
    clearLeg1Selection,
    selectAlternative,
    toggleAccessible,
    toggleShowDeparted,
    startTrip,
    reset,
  }
}
