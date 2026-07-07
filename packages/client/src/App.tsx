import { useEffect, useState, useMemo, useCallback } from 'react'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import { Header, Footer, EmptyState, TripSelector, TripView, ModeToggle, BusTripList, SavedTripsList } from './components'
import { ErrorBoundary } from './components/ErrorBoundary'
import { TripSkeleton } from './components/TripSkeleton'
import { useStations, useTrip, useLeg2, useTripState } from './hooks/useTrip'
import { usePersistedState } from './hooks/usePersistedState'
import { useAlerts } from './hooks/useAlerts'
import { AlertsBanner } from './components/AlertsBanner'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { OfflineBanner } from './components/OfflineBanner'
import type { Line } from '@transferhero/shared'
import { useBusTrips } from './hooks/useBusTrips'
import { useSavedTrips, type SavedTrip } from './hooks/useSavedTrips'
import type { Station, PlaceContext } from '@transferhero/shared'

// Override TanStack Query's focus detection to use Page Visibility API
// instead of window focus/blur events (more reliable, especially on mobile).
// Combined with refetchIntervalInBackground: false (the default), this pauses
// polling when the tab is hidden and fires an immediate refetch on return.
focusManager.setEventListener((handleFocus) => {
  const onVisibilityChange = () => {
    handleFocus(document.visibilityState === 'visible')
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})

function AppContent() {
  const { data: stations = [], isLoading: stationsLoading, error: stationsError, refetch: refetchStations } = useStations()
  const isOnline = useOnlineStatus()
  const tripState = useTripState()
  const { savedTrips, saveTrip, deleteTrip, isSaved } = useSavedTrips()
  const [loadTrip, setLoadTrip] = useState<SavedTrip | null>(null)
  const handleTripLoaded = useCallback(() => setLoadTrip(null), [])

  const {
    data: tripData,
    isLoading: tripLoading,
    isFetching: tripFetching,
    error: tripError,
    refetch: refetchTrip,
  } = useTrip(
    tripState.from?.code ?? null,
    tripState.to?.code ?? null,
    tripState.walkTime,
    tripState.selectedAlternative?.station ?? null,
    tripState.accessible,
    tripState.showDeparted,
    tripState.departAt
  )

  const isScheduledTrip = !!tripState.departAt && tripData?.meta?.scheduleOnly === true

  // grab a fresh copy of the selected train for timing math
  // only trust exact tripId; line+destination matching was chaos
  const liveLeg1Train = tripState.selectedLeg1Train && tripData?.trip?.leg1?.trains
    ? (tripState.selectedLeg1Train._tripId
        ? tripData.trip.leg1.trains.find(t => t._tripId === tripState.selectedLeg1Train!._tripId)
        : undefined
      ) || tripState.selectedLeg1Train
    : tripState.selectedLeg1Train

  const {
    data: leg2Data,
    isLoading: leg2Loading,
    isFetching: leg2Fetching,
    refetch: refetchLeg2,
  } = useLeg2({
    tripId: tripState.tripId ?? '',
    departureTimestamp: tripState.departureTimestamp,
    walkTime: tripState.walkTime,
    transferStation: tripState.selectedAlternative?.station,
    // scheduled trips carry leg2 inline — no realtime leg2 endpoint to poll
    enabled: !!tripState.tripId && tripState.selectedLeg1Train !== null && tripData?.trip?.isDirect !== true && !isScheduledTrip,
    // pass along realtime transfer arrival, recalculated so it's not stale
    transferArrivalMin: liveLeg1Train?._transferArrivalTimestamp
      ? Math.round((liveLeg1Train._transferArrivalTimestamp - Date.now()) / 60000)
      : undefined,
    accessible: tripState.accessible,
    showDeparted: tripState.showDeparted,
  })

  const leg1CarPosition = tripData?.trip?.isDirect
    ? (liveLeg1Train?.Line
        ? tripData.trip.leg1.lineCarPositions?.[liveLeg1Train.Line] ?? tripData.trip.leg1.carPosition
        : tripData.trip.leg1.carPosition)
    : tripData?.trip?.leg1?.carPosition ?? null

  // Mode toggle state (sticky across sessions)
  const [tripMode, setTripMode] = usePersistedState<'metro' | 'metro-bus'>('transferhero-trip-mode', 'metro')

  // Auto-lock to Metro+Bus when either endpoint is bus-only
  const busOnlyLock = !!(tripState.originPlaceContext?.busOnly || tripState.destPlaceContext?.busOnly)
  useEffect(() => {
    if (busOnlyLock) setTripMode('metro-bus')
  }, [busOnlyLock])

  // Bus trips hook — only fetches when Metro+Bus tab is active and we have coordinates
  const {
    data: busTripsData,
    isLoading: busTripsLoading,
  } = useBusTrips(
    tripState.originPlaceContext?.place.lat ?? null,
    tripState.originPlaceContext?.place.lon ?? null,
    tripState.destPlaceContext?.place.lat ?? null,
    tripState.destPlaceContext?.place.lon ?? null,
    tripState.from?.code ?? null,
    tripState.to?.code ?? null,
    tripMode === 'metro-bus' && !!tripState.from && !!tripState.to
  )

  // Build station name lookup for bus trip cards
  const stationNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of stations) {
      map.set(s.code, s.name)
    }
    return map
  }, [stations])

  const handleGo = (from: Station, to: Station, walkTime: number, departAt: number | null) => {
    tripState.startTrip(from, to, walkTime, departAt)
  }

  // Handle walking station alt selection from WalkingCard (after trip is loaded)
  type WalkingAlt = NonNullable<PlaceContext['alternatives']>[number]

  const handleWalkingAlt = (
    currentCtx: PlaceContext | null,
    alt: WalkingAlt,
    setCtx: (ctx: PlaceContext | null) => void,
    setStation: (s: Station | null) => void
  ) => {
    if (!currentCtx) return
    // Swap: alt becomes main, old main goes into alternatives
    const newAlts = [
      { station: currentCtx.station, exit: currentCtx.exit, walkTimeMinutes: currentCtx.walkTimeMinutes, walkDistanceMeters: currentCtx.walkDistanceMeters },
      ...(currentCtx.alternatives ?? []).filter(a => a.station.code !== alt.station.code),
    ]
    setCtx({
      ...currentCtx,
      station: alt.station,
      exit: alt.exit,
      walkTimeMinutes: alt.walkTimeMinutes,
      walkDistanceMeters: alt.walkDistanceMeters,
      alternatives: newAlts,
    })
    setStation(alt.station)
  }

  // Sync trip stations when walking alt changes in the banner (after trip is active)
  useEffect(() => {
    if (tripState.from && tripState.originPlaceContext &&
        tripState.originPlaceContext.station.code !== tripState.from.code) {
      tripState.setFrom(tripState.originPlaceContext.station)
    }
  }, [tripState.originPlaceContext?.station.code])

  useEffect(() => {
    if (tripState.to && tripState.destPlaceContext &&
        tripState.destPlaceContext.station.code !== tripState.to.code) {
      tripState.setTo(tripState.destPlaceContext.station)
    }
  }, [tripState.destPlaceContext?.station.code])

  const hasTrip = tripState.from && tripState.to && tripData

  // Service alerts — only polled while a trip is active
  const { data: alertsData } = useAlerts(!!(tripState.from && tripState.to))

  const activeTransfer = tripData?.trip?.isDirect
    ? null
    : tripState.selectedAlternative
      ? { ...tripState.selectedAlternative, alternatives: tripData?.trip?.transfer?.alternatives }
      : tripData?.trip?.transfer

  const leg2Trains = leg2Data?.trains ?? tripData?.trip?.leg2?.trains ?? []

  // Lines + station codes involved in the current trip, for alert relevance
  const tripLines = useMemo(() => {
    const lines = new Set<Line>()
    for (const t of tripData?.trip?.leg1?.trains ?? []) {
      if (t.Line) lines.add(t.Line as Line)
    }
    for (const t of leg2Trains) {
      if (t.Line) lines.add(t.Line as Line)
    }
    if (activeTransfer?.fromLine) lines.add(activeTransfer.fromLine)
    if (activeTransfer?.toLine) lines.add(activeTransfer.toLine)
    return [...lines]
  }, [tripData, leg2Trains, activeTransfer])

  const tripStationCodes = useMemo(() => {
    const codes = new Set<string>()
    if (tripState.from?.code) codes.add(tripState.from.code)
    if (tripState.to?.code) codes.add(tripState.to.code)
    // transfer stations can have multiple platform codes — elevator incidents may carry either
    if (activeTransfer?.station) codes.add(activeTransfer.station)
    if (activeTransfer?.fromPlatform) codes.add(activeTransfer.fromPlatform)
    if (activeTransfer?.toPlatform) codes.add(activeTransfer.toPlatform)
    return [...codes]
  }, [tripState.from?.code, tripState.to?.code, activeTransfer])

  return (
    <div className="min-h-screen flex flex-col">
      <Header 
        accessible={tripState.accessible} 
        onToggleAccessible={tripState.toggleAccessible} 
      />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {!isOnline && <OfflineBanner />}

        {stationsLoading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E31837] mx-auto" />
            <p className="mt-2 text-[var(--text-secondary)]">Loading stations...</p>
          </div>
        )}

        {stationsError && isOnline && (
          <div className="text-center py-8">
            <p className="text-red-500">Failed to load stations.</p>
            <button
              type="button"
              onClick={() => refetchStations()}
              className="mt-3 px-5 py-2 bg-[#E31837] text-white font-semibold rounded hover:bg-[#c41430] transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!stationsLoading && !stationsError && (
          <TripSelector
            stations={stations}
            onGo={handleGo}
            isLoading={tripLoading}
            transfer={tripData?.trip?.isDirect ? null : tripData?.trip?.transfer}
            onSelectAlternative={tripState.selectAlternative}
            selectedAlternativeIndex={
              tripState.selectedAlternative
                ? tripData?.trip?.transfer?.alternatives?.findIndex(
                    a => a.station === tripState.selectedAlternative?.station
                  ) ?? -1
                : -1
            }
            onOriginPlaceContext={tripState.setOriginPlaceContext}
            onDestPlaceContext={tripState.setDestPlaceContext}
            activeOriginPlaceContext={tripState.originPlaceContext}
            activeDestPlaceContext={tripState.destPlaceContext}
            onSaveTrip={saveTrip}
            checkTripSaved={isSaved}
            loadTrip={loadTrip}
            onTripLoaded={handleTripLoaded}
          />
        )}

        {tripError && (
          <div className="mt-6 text-center py-8">
            <p className="text-red-500">Failed to load trip data.</p>
            <button
              type="button"
              onClick={() => refetchTrip()}
              className="mt-3 px-5 py-2 bg-[#E31837] text-white font-semibold rounded hover:bg-[#c41430] transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {hasTrip && (
          <AlertsBanner
            alerts={alertsData}
            tripLines={tripLines}
            stationCodes={tripStationCodes}
            accessible={tripState.accessible}
          />
        )}

        {hasTrip && (
          <div className="mt-4 flex justify-center">
            <ModeToggle
              mode={tripMode}
              onModeChange={setTripMode}
              busCount={busTripsData?.trips.length}
              busOnlyLock={busOnlyLock}
            />
          </div>
        )}

        <div className="mt-6">
          {hasTrip && tripData.trip && tripMode === 'metro-bus' ? (
            <BusTripList
              trips={busTripsData?.trips ?? []}
              isLoading={busTripsLoading}
              stationNames={stationNameMap}
              originPlaceContext={tripState.originPlaceContext}
              destPlaceContext={tripState.destPlaceContext}
              walkTime={tripState.walkTime}
              accessible={tripState.accessible}
            />
          ) : hasTrip && tripData.trip ? (
            <TripView
              leg1Trains={tripData.trip.leg1.trains}
              leg2Trains={leg2Trains}
              leg1CarPosition={leg1CarPosition}
              leg2CarPosition={tripData.trip.leg2?.carPosition ?? null}
              leg1Time={activeTransfer?.leg1Time ?? tripData.trip.transfer?.leg1Time ?? 0}
              leg2Time={activeTransfer?.leg2Time ?? tripData.trip.transfer?.leg2Time ?? 0}
              walkTime={tripState.walkTime}
              originName={tripData.trip.origin.name}
              destinationName={tripData.trip.destination.name}
              transferName={activeTransfer?.name ?? tripData.trip.transfer?.name ?? ''}
              onSelectLeg1Train={tripState.selectLeg1Train}
              onClearLeg1Selection={tripState.clearLeg1Selection}
              isLoadingLeg2={leg2Loading}
              selectedLeg1Train={tripState.selectedLeg1Train}
              departureTimestamp={tripState.departureTimestamp}
              onRefresh={() => {
                refetchTrip()
                refetchLeg2()
              }}
              isRefreshing={tripFetching || leg2Fetching}
              fetchedAt={tripData?.meta?.fetchedAt}
              scheduledLabel={
                isScheduledTrip && tripData?.meta?.plannedFor
                  ? `Planned for ${new Date(tripData.meta.plannedFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                  : undefined
              }
              isDirect={tripData.trip.isDirect}
              showDeparted={tripState.showDeparted}
              onToggleShowDeparted={tripState.toggleShowDeparted}
              originPlaceContext={tripState.originPlaceContext}
              destPlaceContext={tripState.destPlaceContext}
              onSelectOriginWalkingAlt={(alt) =>
                handleWalkingAlt(tripState.originPlaceContext, alt, tripState.setOriginPlaceContext, tripState.setFrom)
              }
              onSelectDestWalkingAlt={(alt) =>
                handleWalkingAlt(tripState.destPlaceContext, alt, tripState.setDestPlaceContext, tripState.setTo)
              }
          />
          ) : tripLoading && !tripError ? (
            <TripSkeleton />
          ) : !tripLoading && !tripError && (
            savedTrips.length > 0
              ? <SavedTripsList trips={savedTrips} onLoad={setLoadTrip} onDelete={deleteTrip} />
              : <EmptyState />
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
