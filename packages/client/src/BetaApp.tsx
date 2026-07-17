import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { Accessibility, Bus, Moon, Sun, TrainFront } from 'lucide-react'
import type { Line, PlaceContext, SharedTripPayload, Station } from '@transferhero/shared'
import { resolveTripShareToken } from './api/shares'
import {
  Footer,
  SavedTripsList,
  TripSelector,
} from './components'
import { AlertsBanner } from './components/AlertsBanner'
import { BetaBusTripList } from './components/BetaBusTripView'
import { BetaTripView } from './components/BetaTripView'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OfflineBanner } from './components/OfflineBanner'
import { parseTripShareUrl } from './components/TripShare'
import { useAlerts } from './hooks/useAlerts'
import { useBusTrips } from './hooks/useBusTrips'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { useSavedTrips, type SavedTrip } from './hooks/useSavedTrips'
import { useTheme } from './hooks/useTheme'
import { useLeg2, useStations, useTrip, useTripState } from './hooks/useTrip'
import { queryClient } from './queryClient'
import './beta.css'

function BetaHeader({ accessible, onToggleAccessible }: {
  accessible: boolean
  onToggleAccessible: () => void
}) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <header className="beta-header">
      <div className="beta-brand">
        <span className="beta-brand-mark" aria-hidden="true">T</span>
        <div>
          <h1>TransferHero</h1>
          <p>DC Metro wayfinding</p>
        </div>
      </div>
      <div className="beta-header-actions">
        <button
          type="button"
          className={accessible ? 'is-active' : ''}
          onClick={onToggleAccessible}
          aria-label="Toggle accessibility mode (elevator exits)"
          aria-pressed={accessible}
          title={accessible ? 'Showing elevator-aware routes' : 'Prefer elevator-aware routes'}
        >
          <Accessibility />
        </button>
        <button type="button" onClick={toggleTheme} aria-label="Toggle theme">
          {isDark ? <Sun /> : <Moon />}
        </button>
      </div>
    </header>
  )
}

function BetaEmptyState() {
  return (
    <div className="beta-empty-state">
      <div className="beta-empty-sign">
        <span className="beta-exit-tag"><b>Start</b></span>
        <div>
          <strong>Where are you headed?</strong>
          <small>Choose a station, address, or landmark above.</small>
        </div>
        <span className="beta-empty-arrow" aria-hidden="true">↑</span>
      </div>
      <p>Live arrivals, transfer timing, best-car guidance, walking exits, and bus connections will appear here.</p>
    </div>
  )
}

function BetaModeToggle({
  mode,
  onModeChange,
  busCount,
  busOnlyLock,
}: {
  mode: 'metro' | 'metro-bus'
  onModeChange: (mode: 'metro' | 'metro-bus') => void
  busCount?: number
  busOnlyLock: boolean
}) {
  return (
    <div className="beta-plan-mode">
      <span className="beta-plan-mode-label">Plan with</span>
      <div className="beta-plan-mode-options" role="group" aria-label="Trip type">
        <button
          type="button"
          className={mode === 'metro' ? 'is-active' : ''}
          onClick={() => onModeChange('metro')}
          disabled={busOnlyLock}
          aria-pressed={mode === 'metro'}
        >
          <TrainFront aria-hidden="true" />
          Metro only
        </button>
        <button
          type="button"
          className={mode === 'metro-bus' ? 'is-active is-bus' : 'is-bus'}
          onClick={() => onModeChange('metro-bus')}
          aria-pressed={mode === 'metro-bus'}
        >
          <span className="beta-plan-bus-tile"><Bus aria-hidden="true" /></span>
          Metro + bus
          {busCount != null && busCount > 0 && (
            <span className="beta-plan-count" aria-label={`${busCount} bus ${busCount === 1 ? 'option' : 'options'} available`}>
              {busCount}
            </span>
          )}
        </button>
      </div>
      {busOnlyLock && <small>Bus required for this address</small>}
    </div>
  )
}

function BetaLoading() {
  return (
    <div className="beta-loading" role="status" aria-label="Loading trip">
      <div className="beta-loading-summary" />
      {[1, 2, 3].map((item) => (
        <div key={item} className="beta-loading-step">
          <span />
          <div />
        </div>
      ))}
    </div>
  )
}

function BetaContent() {
  const { data: stations = [], isLoading: stationsLoading, error: stationsError, refetch: refetchStations } = useStations()
  const isOnline = useOnlineStatus()
  const tripState = useTripState()
  const { savedTrips, saveTrip, deleteTrip, isSaved } = useSavedTrips()
  const [loadTrip, setLoadTrip] = useState<SavedTrip | null>(null)
  const [sharedTrip, setSharedTrip] = useState<SharedTripPayload | null>(() => parseTripShareUrl())
  const [sharedTripError, setSharedTripError] = useState(false)
  const shareResolveStartedRef = useRef(false)
  const sharedTripLoadedRef = useRef(false)
  const handleTripLoaded = useCallback(() => setLoadTrip(null), [])

  useEffect(() => {
    if (sharedTrip || shareResolveStartedRef.current) return
    const match = /^\/t\/([^/]+)$/u.exec(window.location.pathname)
    if (!match) return
    shareResolveStartedRef.current = true
    resolveTripShareToken(match[1])
      .then(setSharedTrip)
      .catch(() => setSharedTripError(true))
  }, [sharedTrip])

  useEffect(() => {
    if (!sharedTrip || stations.length === 0 || sharedTripLoadedRef.current) return
    sharedTripLoadedRef.current = true

    const originLabel = sharedTrip.originPlaceContext?.place.name ?? sharedTrip.origin.name
    const destinationLabel = sharedTrip.destPlaceContext?.place.name ?? sharedTrip.destination.name
    setLoadTrip({
      id: `shared-${sharedTrip.origin.code}-${sharedTrip.destination.code}-${sharedTrip.departAt ?? 'now'}`,
      label: `${originLabel} → ${destinationLabel}`,
      from: sharedTrip.originPlaceContext
        ? { type: 'place', place: sharedTrip.originPlaceContext.place }
        : { type: 'station', station: sharedTrip.origin },
      to: sharedTrip.destPlaceContext
        ? { type: 'place', place: sharedTrip.destPlaceContext.place }
        : { type: 'station', station: sharedTrip.destination },
      walkTime: Math.max(1, Math.min(5, Math.round(sharedTrip.walkTime))),
      departAt: sharedTrip.departAt,
      fromPlaceContext: sharedTrip.originPlaceContext,
      toPlaceContext: sharedTrip.destPlaceContext,
      savedAt: Date.now(),
    })

    if (sharedTrip.accessible !== tripState.accessible) {
      tripState.toggleAccessible()
    }
  }, [sharedTrip, stations, tripState.accessible, tripState.toggleAccessible])

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

  const liveLeg1Train = tripState.selectedLeg1Train && tripData?.trip?.leg1?.trains
    ? (tripState.selectedLeg1Train._tripId
        ? tripData.trip.leg1.trains.find((train) => train._tripId === tripState.selectedLeg1Train!._tripId)
        : undefined
      ) ?? tripState.selectedLeg1Train
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
    enabled: !!tripState.tripId
      && tripState.selectedLeg1Train !== null
      && tripData?.trip?.isDirect !== true
      && !isScheduledTrip,
    transferArrivalMin: liveLeg1Train?._transferArrivalTimestamp
      ? Math.round((liveLeg1Train._transferArrivalTimestamp - Date.now()) / 60_000)
      : undefined,
    accessible: tripState.accessible,
    showDeparted: tripState.showDeparted,
  })

  const leg1CarPosition = tripData?.trip?.isDirect
    ? (liveLeg1Train?.Line
        ? tripData.trip.leg1.lineCarPositions?.[liveLeg1Train.Line] ?? tripData.trip.leg1.carPosition
        : tripData.trip.leg1.carPosition)
    : tripData?.trip?.leg1?.carPosition ?? null

  // Not persisted on purpose: every trip starts on Metro only. The single
  // auto-switch to Metro + bus is when an endpoint has no station in walking
  // distance (busOnly) — never because of a previous trip's mode.
  const [tripMode, setTripMode] = useState<'metro' | 'metro-bus'>('metro')
  const busOnlyLock = !!(tripState.originPlaceContext?.busOnly || tripState.destPlaceContext?.busOnly)

  useEffect(() => {
    if (busOnlyLock) setTripMode('metro-bus')
  }, [busOnlyLock])

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

  const stationNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const station of stations) map.set(station.code, station.name)
    return map
  }, [stations])

  const handleGo = (from: Station, to: Station, walkTime: number, departAt: number | null) => {
    // each plan starts fresh on Metro unless an endpoint truly needs the bus
    setTripMode(busOnlyLock ? 'metro-bus' : 'metro')
    tripState.startTrip(from, to, walkTime, departAt)
  }

  type WalkingAlt = NonNullable<PlaceContext['alternatives']>[number]

  const handleWalkingAlt = (
    currentContext: PlaceContext | null,
    alternative: WalkingAlt,
    setContext: (context: PlaceContext | null) => void,
    setStation: (station: Station | null) => void
  ) => {
    if (!currentContext) return
    const alternatives = [
      {
        station: currentContext.station,
        exit: currentContext.exit,
        walkTimeMinutes: currentContext.walkTimeMinutes,
        walkDistanceMeters: currentContext.walkDistanceMeters,
      },
      ...(currentContext.alternatives ?? []).filter((item) => item.station.code !== alternative.station.code),
    ]
    setContext({
      ...currentContext,
      station: alternative.station,
      exit: alternative.exit,
      walkTimeMinutes: alternative.walkTimeMinutes,
      walkDistanceMeters: alternative.walkDistanceMeters,
      alternatives,
    })
    setStation(alternative.station)
  }

  useEffect(() => {
    if (
      tripState.from
      && tripState.originPlaceContext
      && tripState.originPlaceContext.station.code !== tripState.from.code
    ) {
      tripState.setFrom(tripState.originPlaceContext.station)
    }
  }, [tripState.originPlaceContext?.station.code])

  useEffect(() => {
    if (
      tripState.to
      && tripState.destPlaceContext
      && tripState.destPlaceContext.station.code !== tripState.to.code
    ) {
      tripState.setTo(tripState.destPlaceContext.station)
    }
  }, [tripState.destPlaceContext?.station.code])

  const hasTrip = !!(tripState.from && tripState.to && tripData?.trip)
  const { data: alertsData } = useAlerts(!!(tripState.from && tripState.to))
  const activeTransfer = tripData?.trip?.isDirect
    ? null
    : tripState.selectedAlternative
      ? {
          ...tripData?.trip?.transfer,
          ...tripState.selectedAlternative,
          alternatives: tripData?.trip?.transfer?.alternatives,
        }
      : tripData?.trip?.transfer ?? null
  const needsSelectedLiveConnection = !!tripState.selectedLeg1Train
    && !isScheduledTrip
    && tripData?.trip?.isDirect !== true
  // Once a realtime first train is selected, the inline leg-two list belongs
  // to the initial planner estimate. Do not show it as the selected train's
  // connection while the dedicated catchability query is still loading.
  const leg2Trains = leg2Data?.trains
    ?? (needsSelectedLiveConnection ? [] : tripData?.trip?.leg2?.trains)
    ?? []

  const tripLines = useMemo(() => {
    const lines = new Set<Line>()
    for (const train of tripData?.trip?.leg1?.trains ?? []) if (train.Line) lines.add(train.Line)
    for (const train of leg2Trains) if (train.Line) lines.add(train.Line)
    if (activeTransfer?.fromLine) lines.add(activeTransfer.fromLine)
    if (activeTransfer?.toLine) lines.add(activeTransfer.toLine)
    return [...lines]
  }, [tripData, leg2Trains, activeTransfer])

  const tripStationCodes = useMemo(() => {
    const codes = new Set<string>()
    if (tripState.from?.code) codes.add(tripState.from.code)
    if (tripState.to?.code) codes.add(tripState.to.code)
    if (activeTransfer?.station) codes.add(activeTransfer.station)
    if (activeTransfer?.fromPlatform) codes.add(activeTransfer.fromPlatform)
    if (activeTransfer?.toPlatform) codes.add(activeTransfer.toPlatform)
    return [...codes]
  }, [tripState.from?.code, tripState.to?.code, activeTransfer])

  return (
    <div className="beta-page min-h-screen flex flex-col">
      <div className="beta-wrap">
        <BetaHeader accessible={tripState.accessible} onToggleAccessible={tripState.toggleAccessible} />

        <main>
          {!isOnline && <OfflineBanner />}

          {stationsLoading && (
            <div className="beta-station-loading" role="status">
              <span />
              Loading live station data…
            </div>
          )}

          {stationsError && isOnline && (
            <div className="beta-error" role="alert">
              <strong>Station data did not arrive.</strong>
              <button type="button" onClick={() => refetchStations()}>Try again</button>
            </div>
          )}

          {!stationsLoading && !stationsError && (
            <TripSelector
              variant="wayfinding"
              stations={stations}
              onGo={handleGo}
              isLoading={tripLoading}
              transfer={tripData?.trip?.isDirect ? null : tripData?.trip?.transfer}
              onSelectAlternative={tripState.selectAlternative}
              selectedAlternativeIndex={
                tripState.selectedAlternative
                  ? tripData?.trip?.transfer?.alternatives?.findIndex(
                      (alternative) => alternative.station === tripState.selectedAlternative?.station
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

          {sharedTrip && (
            <div className="beta-shared-trip-banner" role="status">
              <span aria-hidden="true">↗</span>
              <div>
                <strong>A friend shared this trip</strong>
                <small>We replanned it with the latest available trip data.</small>
              </div>
            </div>
          )}

          {sharedTripError && (
            <div className="beta-error" role="alert">
              <strong>That shared trip link could not be opened.</strong>
              <span>Ask your friend to create a fresh link.</span>
            </div>
          )}

          {tripError && (
            <div className="beta-error" role="alert">
              <strong>That trip could not be loaded.</strong>
              <span>Live service may be briefly unavailable.</span>
              <button type="button" onClick={() => refetchTrip()}>Retry trip</button>
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
            <div className="beta-mode-row">
              <BetaModeToggle
                mode={tripMode}
                onModeChange={setTripMode}
                busCount={busTripsData?.trips.length}
                busOnlyLock={busOnlyLock}
              />
            </div>
          )}

          <div className="beta-results">
            {hasTrip && tripData?.trip && tripMode === 'metro-bus' ? (
              <div className="beta-bus-results">
                <BetaBusTripList
                  trips={busTripsData?.trips ?? []}
                  isLoading={busTripsLoading}
                  stationNames={stationNameMap}
                  originPlaceContext={tripState.originPlaceContext}
                  destPlaceContext={tripState.destPlaceContext}
                  walkTime={tripState.walkTime}
                  accessible={tripState.accessible}
                />
              </div>
            ) : hasTrip && tripData?.trip && tripState.from && tripState.to ? (
              <BetaTripView
                origin={tripData.trip.origin}
                destination={tripData.trip.destination}
                transfer={activeTransfer}
                leg1Trains={tripData.trip.leg1.trains}
                leg2Trains={leg2Trains}
                leg1CarPosition={leg1CarPosition}
                leg1LineCarPositions={tripData.trip.leg1.lineCarPositions}
                leg2CarPosition={leg2Data?.exitCarPosition ?? tripData.trip.leg2?.carPosition ?? null}
                leg1Stops={tripData.trip.leg1.stops ?? []}
                leg1StopsBeyond={tripData.trip.leg1.stopsBeyond ?? []}
                leg1LineStops={tripData.trip.leg1.lineStops}
                leg1LineStopsBeyond={tripData.trip.leg1.lineStopsBeyond}
                leg2Stops={tripData.trip.leg2?.stops ?? []}
                leg2StopsBeyond={tripData.trip.leg2?.stopsBeyond ?? []}
                leg1DirectionLabels={tripData.trip.leg1.directionLabels}
                leg2DirectionLabels={tripData.trip.leg2?.directionLabels}
                leg1Time={activeTransfer?.leg1Time ?? tripData.trip.transfer?.leg1Time ?? 0}
                leg2Time={activeTransfer?.leg2Time ?? tripData.trip.transfer?.leg2Time ?? 0}
                walkTime={tripState.walkTime}
                onSelectLeg1Train={tripState.selectLeg1Train}
                onClearLeg1Selection={tripState.clearLeg1Selection}
                selectedLeg1Train={tripState.selectedLeg1Train}
                departureTimestamp={tripState.departureTimestamp}
                onRefresh={() => {
                  refetchTrip()
                  refetchLeg2()
                }}
                isRefreshing={tripFetching || leg2Fetching || leg2Loading}
                fetchedAt={tripData.meta.fetchedAt}
                scheduledLabel={
                  isScheduledTrip && tripData.meta.plannedFor
                    ? `Planned for ${new Date(tripData.meta.plannedFor).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                    : undefined
                }
                plannedForMs={
                  isScheduledTrip && tripData.meta.plannedFor
                    ? new Date(tripData.meta.plannedFor).getTime()
                    : null
                }
                isLoadingLeg2={needsSelectedLiveConnection && leg2Loading}
                isDirect={tripData.trip.isDirect}
                showDeparted={tripState.showDeparted}
                onToggleShowDeparted={tripState.toggleShowDeparted}
                accessible={tripState.accessible}
                originPlaceContext={tripState.originPlaceContext}
                destPlaceContext={tripState.destPlaceContext}
                onSelectOriginWalkingAlt={(alternative) =>
                  handleWalkingAlt(
                    tripState.originPlaceContext,
                    alternative,
                    tripState.setOriginPlaceContext,
                    tripState.setFrom
                  )
                }
                onSelectDestWalkingAlt={(alternative) =>
                  handleWalkingAlt(
                    tripState.destPlaceContext,
                    alternative,
                    tripState.setDestPlaceContext,
                    tripState.setTo
                  )
                }
              />
            ) : tripLoading && !tripError ? (
              <BetaLoading />
            ) : !tripLoading && !tripError && (
              savedTrips.length > 0
                ? <div className="beta-saved-trips"><SavedTripsList trips={savedTrips} onLoad={setLoadTrip} onDelete={deleteTrip} /></div>
                : <BetaEmptyState />
            )}
          </div>
        </main>
      </div>

      <div className="beta-footer"><Footer /></div>
    </div>
  )
}

export default function BetaApp() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BetaContent />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
