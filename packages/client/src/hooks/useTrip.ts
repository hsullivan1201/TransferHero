import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useState, useCallback, useMemo } from 'react'
import { fetchStations, fetchTrip, fetchLeg2 } from '../api/trips'
import type { Station, Train, TransferAlternative, PlaceContext } from '@transferhero/shared'
import { getTrainMinutes } from '../utils/time'
import { readPersisted, writePersisted } from './usePersistedState'

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
  showDeparted: boolean = false,
  departAt: number | null = null
) {
  return useQuery({
    queryKey: ['trip', from, to, walkTime, transferStation, accessible, showDeparted, departAt],
    queryFn: () => fetchTrip(from!, to!, walkTime, transferStation || undefined, accessible, showDeparted, departAt),
    enabled: !!from && !!to,
    // scheduled (future) trips don't change every 15s — skip the realtime polling
    staleTime: departAt ? Infinity : 10 * 1000,
    refetchInterval: departAt ? false : 15 * 1000,
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
  showDeparted?: boolean
}

export function useLeg2({ tripId, departureTimestamp, walkTime, transferStation, enabled, transferArrivalMin, accessible = false, showDeparted = false }: UseLeg2Options) {
  return useQuery({
    // transferArrivalMin excluded from key — it's a realtime value that changes
    // as minutes tick over. departureTimestamp already captures timing, and the
    // 30s refetchInterval ensures fresh data. transferArrivalMin is still sent
    // to the server in the queryFn.
    queryKey: ['leg2', tripId, departureTimestamp, walkTime, transferStation, accessible, showDeparted],
    queryFn: () => {
      const rawMin = departureTimestamp
        ? Math.round((departureTimestamp - Date.now()) / 60000)
        : 0
      const currentDepartureMin = Math.max(-120, rawMin)

      if (rawMin < -120) {
        console.warn(`[useLeg2] departureMin clamped: raw=${rawMin} clamped=${currentDepartureMin} | departureTimestamp=${departureTimestamp} now=${Date.now()} drift=${Date.now() - (departureTimestamp || 0)}ms`)
      }

      return fetchLeg2(tripId, currentDepartureMin, walkTime, transferStation || undefined, transferArrivalMin, accessible, showDeparted)
    },
    enabled,
    staleTime: 10 * 1000,
    refetchInterval: 15 * 1000,
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
  originPlaceContext: PlaceContext | null
  destPlaceContext: PlaceContext | null
  /** epoch ms for "leave at" trips; null = leave now */
  departAt: number | null
}

export function useTripState() {
  const [state, setState] = useState<TripState>(() => ({
    from: null,
    to: null,
    walkTime: 2,
    selectedLeg1Train: null,
    selectedLeg1Index: undefined,
    selectedAlternative: null,
    departureTimestamp: null,
    accessible: readPersisted('transferhero-accessible', false),
    showDeparted: false,
    originPlaceContext: null,
    destPlaceContext: null,
    departAt: null,
  }))

  const setFrom = useCallback((station: Station | null) => {
    setState(prev => ({
      ...prev,
      from: station,
      selectedLeg1Train: null,
      selectedLeg1Index: undefined,
      selectedAlternative: null,
      departureTimestamp: null,
      departAt: null,
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
      departAt: null,
    }))
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
    setState(prev => {
      writePersisted('transferhero-accessible', !prev.accessible)
      return {
        ...prev,
        accessible: !prev.accessible,
      }
    })
  }, [])

  const toggleShowDeparted = useCallback(() => {
    setState(prev => ({
      ...prev,
      showDeparted: !prev.showDeparted,
    }))
  }, [])

  const startTrip = useCallback((from: Station, to: Station, walkTime: number, departAt: number | null = null) => {
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
      originPlaceContext: prev.originPlaceContext, // keep place contexts through trip start
      destPlaceContext: prev.destPlaceContext,
      departAt,
    }))
  }, [])

  const setOriginPlaceContext = useCallback((ctx: PlaceContext | null) => {
    setState(prev => ({ ...prev, originPlaceContext: ctx }))
  }, [])

  const setDestPlaceContext = useCallback((ctx: PlaceContext | null) => {
    setState(prev => ({ ...prev, destPlaceContext: ctx }))
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
    selectLeg1Train,
    clearLeg1Selection,
    selectAlternative,
    toggleAccessible,
    toggleShowDeparted,
    startTrip,
    setOriginPlaceContext,
    setDestPlaceContext,
  }
}
