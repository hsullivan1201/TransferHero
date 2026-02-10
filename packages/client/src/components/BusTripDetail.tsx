import { useMemo, useCallback, useState, useEffect } from 'react'
import { Bus, Footprints, RefreshCw, ExternalLink, Rss, Loader2, Clock3, Train as TrainIcon, Check } from 'lucide-react'
import type { HybridTrip, Train, CatchableTrain, PlaceContext, BusStop, BusPrediction } from '@transferhero/shared'
import { LegPanel } from './LegPanel'
import { WalkingCard } from './WalkingCard'
import { buildMapsUrl, formatDistance } from '../utils/geo'
import { resolveExitLabel } from '../data/exitMapping'
import { useTrip, useLeg2 } from '../hooks/useTrip'
import { useBusPredictions } from '../hooks/useBusPredictions'
import { deriveWaitMinutes, computeTotalMinutes, getTrainMinutes, minutesToClockTime } from '../utils/time'

interface BusTripDetailProps {
  trip: HybridTrip
  stationNames: Map<string, string>
  originPlaceContext: PlaceContext | null
  destPlaceContext: PlaceContext | null
  onBack: () => void
  walkTime: number
  accessible: boolean
}

export function BusTripDetail({
  trip,
  stationNames,
  originPlaceContext,
  destPlaceContext,
  onBack,
  walkTime,
  accessible,
}: BusTripDetailProps) {
  const isMetroBus = trip.pattern === 'metro-bus'
  const { busLeg } = trip

  const fromName = stationNames.get(trip.metroFrom) || trip.metroFrom
  const toName = stationNames.get(trip.metroTo) || trip.metroTo

  // Fetch real-time bus predictions (lazy — only when this detail view is open)
  const {
    data: busPredictions,
    isLoading: predictionsLoading,
    refetch: refetchPredictions,
  } = useBusPredictions(busLeg.boardStop.stopCode, busLeg.routeId, true, busLeg.boardStop.stopId, busLeg.alightStop.stopId)

  // "Already on a train?" state for both metro legs
  const [showDeparted, setShowDeparted] = useState(false)

  // Bus departure selection state (bus-metro only)
  const [selectedBusDeparture, setSelectedBusDeparture] = useState<{
    minutesFromNow: number
    isRealTime: boolean
    vehicleId?: string
  } | null>(null)

  const handleBusSelect = useCallback((dep: { minutesFromNow: number; isRealTime: boolean; vehicleId?: string }) => {
    setSelectedBusDeparture(dep)
    // New bus selection = new arrival at metro = different catchable trains
    setSelectedTrain(null)
    setDepartureTimestamp(null)
    setSelectedLeg2Train(null)
  }, [])

  const handleBusClear = useCallback(() => {
    setSelectedBusDeparture(null)
    setSelectedTrain(null)
    setDepartureTimestamp(null)
    setSelectedLeg2Train(null)
  }, [])

  // Fetch real Metro trip data for the metro portion
  const {
    data: metroTripData,
    isLoading: metroLoading,
    refetch: refetchMetro,
  } = useTrip(trip.metroFrom, trip.metroTo, walkTime, null, accessible, showDeparted)

  // Track selected train for the metro leg
  const [selectedTrain, setSelectedTrain] = useState<Train | null>(null)
  const [departureTimestamp, setDepartureTimestamp] = useState<number | null>(null)

  const handleTrainSelect = useCallback((train: Train, _index: number) => {
    const min = getTrainMinutes(train.Min)
    setSelectedTrain(train)
    setDepartureTimestamp(Date.now() + (min * 60 * 1000))
    setSelectedLeg2Train(null) // new leg 1 pick → leg 2 refetches
  }, [])

  const handleClearSelection = useCallback(() => {
    setSelectedTrain(null)
    setDepartureTimestamp(null)
    setSelectedLeg2Train(null)
  }, [])

  // Track selected leg 2 train (for metro-bus transfer trips)
  const [selectedLeg2Train, setSelectedLeg2Train] = useState<Train | null>(null)

  const handleLeg2Select = useCallback((train: Train, _index: number) => {
    setSelectedLeg2Train(train)
  }, [])

  const handleLeg2Clear = useCallback(() => {
    setSelectedLeg2Train(null)
  }, [])

  // Get live copy of selected train
  const displayTrain = useMemo(() => {
    if (!selectedTrain || !metroTripData?.trip?.leg1?.trains) return null
    if (selectedTrain._tripId) {
      return metroTripData.trip.leg1.trains.find(t => t._tripId === selectedTrain._tripId) || selectedTrain
    }
    return selectedTrain
  }, [selectedTrain, metroTripData])

  const isDirect = metroTripData?.trip?.isDirect ?? false
  const transfer = metroTripData?.trip?.transfer ?? null
  const transferName = transfer?.name ?? ''

  // Destination exit info for bus→metro (metro destination is the final stop)
  const destExitName = !isMetroBus && destPlaceContext?.exit.name
    ? destPlaceContext.exit.name : undefined
  const destExitLabel = !isMetroBus && destPlaceContext?.exit.name && destPlaceContext?.station.code
    ? resolveExitLabel(destPlaceContext.station.code, destPlaceContext.exit.name)
    : undefined

  // Leg 2: fetch when train is selected and trip has a transfer
  const tripId = `${trip.metroFrom}-${trip.metroTo}`
  const transferArrivalMin = displayTrain?._transferArrivalTimestamp
    ? Math.round((displayTrain._transferArrivalTimestamp - Date.now()) / 60000)
    : undefined

  const {
    data: leg2Data,
    isLoading: leg2Loading,
    refetch: refetchLeg2,
  } = useLeg2({
    tripId,
    departureTimestamp,
    walkTime,
    enabled: !!selectedTrain && !isDirect,
    transferArrivalMin,
    accessible,
    showDeparted,
  })

  const rawMetroTrains = metroTripData?.trip?.leg1?.trains ?? []
  const leg1CarPosition = metroTripData?.trip?.leg1?.carPosition ?? null
  const leg2Trains = leg2Data?.trains ?? metroTripData?.trip?.leg2?.trains ?? []
  const leg2CarPosition = metroTripData?.trip?.leg2?.carPosition ?? null

  // Bus→Metro: compute when user arrives at metro station after selecting a bus
  const arrivalAtMetroMin = useMemo((): number | null => {
    if (isMetroBus || !selectedBusDeparture) return null
    const rideMin = busLeg.scheduledRideMinutes ?? busLeg.estimatedRideMinutes
    return selectedBusDeparture.minutesFromNow + rideMin + busLeg.alightWalkMinutes
  }, [isMetroBus, selectedBusDeparture, busLeg.scheduledRideMinutes, busLeg.estimatedRideMinutes, busLeg.alightWalkMinutes])

  // Bus→Metro: annotate metro trains with catchability, filter to catchable, sort
  // Mirrors server leg2 logic: filter out missed trains, sort live-first
  const metroTrains: (Train | CatchableTrain)[] = useMemo(() => {
    if (arrivalAtMetroMin == null) return rawMetroTrains
    const CATCH_THRESHOLD = -5 // wider than metro transfers (-3) since bus timing is less precise

    const annotated: CatchableTrain[] = rawMetroTrains.map(train => {
      const trainMin = getTrainMinutes(train.Min)
      const waitTime = Math.round(trainMin - arrivalAtMetroMin)
      // prefer realtime destination arrival, otherwise fall back to train departure + ride estimate
      const totalJourneyTime = train._destArrivalMin != null
        ? train._destArrivalMin
        : trainMin + (trip.metroTimeMinutes || 10)
      const arrivalClock = train._destArrivalTime || minutesToClockTime(totalJourneyTime)
      return {
        ...train,
        _waitTime: waitTime,
        _canCatch: waitTime >= CATCH_THRESHOLD,
        _totalTime: totalJourneyTime,
        _arrivalClock: arrivalClock,
      }
    })

    // filter to only catchable trains, sort live first then by departure
    return annotated
      .filter(t => t._canCatch)
      .sort((a, b) => {
        const aIsLive = !a._scheduled
        const bIsLive = !b._scheduled
        if (aIsLive !== bIsLive) return aIsLive ? -1 : 1
        return getTrainMinutes(a.Min) - getTrainMinutes(b.Min)
      })
  }, [rawMetroTrains, arrivalAtMetroMin, trip.metroTimeMinutes])

  // Enrich displayTrain with CatchableTrain annotation so TrainCard shows departure time
  const annotatedDisplayTrain = useMemo(() => {
    if (!displayTrain || arrivalAtMetroMin == null) return displayTrain
    const match = metroTrains.find(t => t._tripId === displayTrain._tripId)
    return match ?? displayTrain
  }, [displayTrain, metroTrains, arrivalAtMetroMin])

  // Get live copy of selected leg 2 train
  const displayLeg2Train = useMemo(() => {
    if (!selectedLeg2Train || leg2Trains.length === 0) return null
    if (selectedLeg2Train._tripId) {
      return leg2Trains.find(t => t._tripId === selectedLeg2Train._tripId) || selectedLeg2Train
    }
    return selectedLeg2Train
  }, [selectedLeg2Train, leg2Trains])

  // Compute when user arrives at the bus boarding stop (minutes from now)
  // Only relevant for metro-bus pattern after selecting a Metro train
  const arrivalAtBusStopMin = useMemo((): number | null => {
    if (!isMetroBus || !displayTrain) return null

    const boardWalkMinutes = busLeg.boardWalkMinutes

    if (isDirect) {
      // Direct trip: use destination arrival timestamp
      if (displayTrain._destArrivalTimestamp) {
        return (displayTrain._destArrivalTimestamp - Date.now()) / 60000 + boardWalkMinutes
      }
      // Fallback: departure minutes + rough metro time
      return getTrainMinutes(displayTrain.Min) + 10 + boardWalkMinutes
    }

    // Transfer trip: use selected leg 2 train, or first catchable
    const leg2Train = displayLeg2Train
      || leg2Trains.find(t => '_canCatch' in t && (t as any)._canCatch === true)
    if (!leg2Train) return null

    if (leg2Train._destArrivalTimestamp) {
      return (leg2Train._destArrivalTimestamp - Date.now()) / 60000 + boardWalkMinutes
    }
    if ('_totalTime' in leg2Train && typeof (leg2Train as any)._totalTime === 'number') {
      return (leg2Train as any)._totalTime + boardWalkMinutes
    }
    if (leg2Train._destArrivalMin != null) {
      return leg2Train._destArrivalMin + boardWalkMinutes
    }
    // Last resort: train departure + rough metro estimate
    return getTrainMinutes(leg2Train.Min) + 10 + boardWalkMinutes
  }, [isMetroBus, displayTrain, isDirect, busLeg.boardWalkMinutes, leg2Trains, displayLeg2Train])

  // Compute journey time breakdown for the summary card
  // Use selected train if available, otherwise fall back to first listed train
  // For bus-metro with bus selected: use first catchable train's wait time relative to metro arrival
  const metroWait = useMemo((): number | null => {
    // Bus→Metro with annotated trains: use _waitTime (relative to metro arrival, not now)
    if (!isMetroBus && arrivalAtMetroMin != null) {
      // Find the annotated version of selected train, or first catchable
      const annotated = displayTrain?._tripId
        ? metroTrains.find(t => t._tripId === displayTrain._tripId)
        : null
      const train = annotated ?? metroTrains.find(t => '_canCatch' in t && (t as CatchableTrain)._canCatch)
      if (train && '_waitTime' in train) {
        return Math.max(0, (train as CatchableTrain)._waitTime)
      }
    }
    if (displayTrain) {
      return deriveWaitMinutes(displayTrain, departureTimestamp)
    }
    return metroTrains.length > 0 ? Math.max(0, getTrainMinutes(metroTrains[0].Min)) : null
  }, [displayTrain, departureTimestamp, isMetroBus, arrivalAtMetroMin, metroTrains])

  // Real metro ride times from pathfinding API (not the rough bus-route estimate)
  const transferData = metroTripData?.trip?.transfer
  const leg1Ride = transferData?.leg1Time ?? null
  const leg2Ride = transferData?.leg2Time ?? null
  const transferWalk = !isDirect ? walkTime : null

  // Leg 2 wait: use selected leg 2 train, or first catchable
  const leg2Wait = useMemo((): number | null => {
    if (isDirect) return null
    if (displayLeg2Train) {
      return '_waitTime' in displayLeg2Train ? (displayLeg2Train as any)._waitTime : null
    }
    const catchable = leg2Trains.find(t => '_canCatch' in t && (t as any)._canCatch === true)
    return catchable && '_waitTime' in catchable ? (catchable as any)._waitTime : null
  }, [isDirect, displayLeg2Train, leg2Trains])

  // For direct trips: derive ride time from train's destination arrival minus departure
  const directRide = useMemo((): number | null => {
    if (!isDirect) return null
    const train = displayTrain ?? metroTrains[0]
    if (!train) return null
    if (train._destArrivalMin != null) {
      // Both _destArrivalMin and Min are minutes-from-now, so difference = pure ride time
      const trainMin = getTrainMinutes(train.Min)
      return Math.max(0, Math.round(train._destArrivalMin - trainMin))
    }
    return trip.metroTimeMinutes // fallback to estimate
  }, [isDirect, displayTrain, metroTrains, trip.metroTimeMinutes])

  // Total metro time (for estimating bus stop arrival)
  const totalMetroRide = isDirect
    ? (directRide ?? trip.metroTimeMinutes)
    : computeTotalMinutes([leg1Ride, transferWalk, leg2Wait, leg2Ride])

  // Estimate when user arrives at bus stop, even without a selected train
  const estimatedArrivalAtBusStop = useMemo((): number | null => {
    if (arrivalAtBusStopMin != null) return arrivalAtBusStopMin
    if (!isMetroBus) return null
    if (metroTrains.length === 0) return null
    const firstTrainMin = Math.max(0, getTrainMinutes(metroTrains[0].Min))
    return firstTrainMin + totalMetroRide + busLeg.boardWalkMinutes
  }, [arrivalAtBusStopMin, isMetroBus, metroTrains, totalMetroRide, busLeg.boardWalkMinutes])

  const busWait = useMemo((): number | null => {
    if (isMetroBus) {
      // Metro→Bus: estimate from arrival at bus stop
      if (!busPredictions || busPredictions.length === 0) return null
      if (estimatedArrivalAtBusStop == null) return null
      const catchable = busPredictions.find(p => p.minutes >= estimatedArrivalAtBusStop - 1)
      return catchable ? Math.max(0, Math.round(catchable.minutes - estimatedArrivalAtBusStop)) : null
    }
    // Bus→Metro: deterministic when bus is selected
    if (selectedBusDeparture) {
      return Math.max(0, selectedBusDeparture.minutesFromNow - busLeg.boardWalkMinutes)
    }
    // Fallback: use first prediction
    if (!busPredictions || busPredictions.length === 0) return null
    return Math.max(0, Math.round(busPredictions[0].minutes - busLeg.boardWalkMinutes))
  }, [busPredictions, isMetroBus, estimatedArrivalAtBusStop, busLeg.boardWalkMinutes, selectedBusDeparture])

  const originWalk = isMetroBus ? (originPlaceContext?.walkTimeMinutes ?? null) : null
  const destWalk = !isMetroBus ? (destPlaceContext?.walkTimeMinutes ?? null) : null

  // Build metro segments for total time (leg1 + transfer walk + leg2 wait + leg2 ride, or direct ride)
  const metroSegments = isDirect
    ? [directRide]
    : [leg1Ride, transferWalk, leg2Wait, leg2Ride]

  const effectiveBusRide = busLeg.scheduledRideMinutes ?? busLeg.estimatedRideMinutes

  const totalMinutes = computeTotalMinutes([
    originWalk,
    isMetroBus ? metroWait : null,
    ...(isMetroBus ? metroSegments : []),
    busLeg.boardWalkMinutes,
    busWait,
    effectiveBusRide,
    busLeg.alightWalkMinutes,
    ...(!isMetroBus ? [metroWait, ...metroSegments] : []),
    destWalk,
  ])

  const arrivalClock = minutesToClockTime(totalMinutes)

  return (
    <div className="animate-fade-in space-y-4">
      {/* Back button + trip summary header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="px-3 py-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          {isMetroBus ? (
            <>
              <MetroIcon />
              <span>{fromName} → {toName}</span>
              <span className="text-[var(--text-secondary)]">then</span>
              <BusIcon />
              <span className="text-[#0f9b8e]">{busLeg.routeName}</span>
            </>
          ) : (
            <>
              <BusIcon />
              <span className="text-[#0f9b8e]">{busLeg.routeName}</span>
              <span className="text-[var(--text-secondary)]">then</span>
              <MetroIcon />
              <span>{fromName} → {toName}</span>
            </>
          )}
        </div>
      </div>

      {/* Walking card: origin place → first station (metro-bus only) */}
      {isMetroBus && originPlaceContext && (
        <WalkingCard context={originPlaceContext} />
      )}

      {/* For bus-metro: walk to bus stop, bus leg, walk to Metro, then Metro */}
      {!isMetroBus && (
        <>
          <BusWalkCard
            fromLat={originPlaceContext?.place.lat}
            fromLon={originPlaceContext?.place.lon}
            toLat={busLeg.boardStop.lat}
            toLon={busLeg.boardStop.lon}
            walkMinutes={busLeg.boardWalkMinutes}
            walkMeters={busLeg.boardWalkMeters}
            label="Walk to Bus Stop"
            sublabel={`${originPlaceContext?.place.name || 'Your location'} → ${busLeg.boardStop.name}`}
          />
          <BusLegPanel
            busLeg={busLeg}
            isFirst={true}
            predictions={busPredictions ?? []}
            predictionsLoading={predictionsLoading}
            selectedDeparture={selectedBusDeparture}
            onSelectDeparture={handleBusSelect}
            onClearDeparture={handleBusClear}
          />
          <BusWalkCard
            fromLat={busLeg.alightStop.lat}
            fromLon={busLeg.alightStop.lon}
            toLat={busLeg.nearestExitLat}
            toLon={busLeg.nearestExitLon}
            walkMinutes={busLeg.alightWalkMinutes}
            walkMeters={busLeg.alightWalkMeters}
            label="Walk to Metro"
            sublabel={`${busLeg.alightStop.name} → ${busLeg.nearestExitName || fromName} entrance`}
            searchQuery={fromName + ' Metro Station'}
          />
        </>
      )}

      {/* Refresh button */}
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={() => { refetchMetro(); refetchPredictions(); if (!isDirect) refetchLeg2() }}
          disabled={metroLoading || leg2Loading || predictionsLoading}
          className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${metroLoading || leg2Loading ? 'animate-spin' : ''}`} />
          {metroLoading || leg2Loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Metro Leg 1 */}
      <LegPanel
        leg={1}
        title={isDirect ? `Metro: ${fromName}` : `Leg 1: ${fromName}`}
        subtitle={isDirect ? `To ${toName}` : `To ${transferName}`}
        trains={metroTrains}
        carPosition={leg1CarPosition}
        selectedTrain={annotatedDisplayTrain}
        onTrainSelect={handleTrainSelect}
        onClearSelection={handleClearSelection}
        isDirect={isDirect}
        destinationExitName={isDirect ? (isMetroBus ? busLeg.nearestExitName : destExitName) : undefined}
        destinationExitLabel={isDirect && !isMetroBus ? destExitLabel : undefined}
        showDeparted={showDeparted}
        onToggleShowDeparted={() => setShowDeparted(d => !d)}
      />

      {/* Metro Leg 2 (only for transfer trips) */}
      {!isDirect && (
        <LegPanel
          leg={2}
          title={`Leg 2: ${transferName}`}
          subtitle={`To ${toName}`}
          trains={leg2Trains}
          carPosition={leg2CarPosition}
          isLoading={leg2Loading}
          destinationExitName={isMetroBus ? busLeg.nearestExitName : destExitName}
          destinationExitLabel={!isMetroBus ? destExitLabel : undefined}
          selectedTrain={isMetroBus ? displayLeg2Train : undefined}
          onTrainSelect={isMetroBus ? handleLeg2Select : undefined}
          onClearSelection={isMetroBus ? handleLeg2Clear : undefined}
          showDeparted={showDeparted}
          onToggleShowDeparted={() => setShowDeparted(d => !d)}
        />
      )}

      {/* For metro-bus: walk from Metro exit to bus stop, then bus leg */}
      {isMetroBus && (
        <>
          <BusWalkCard
            fromLat={busLeg.nearestExitLat}
            fromLon={busLeg.nearestExitLon}
            toLat={busLeg.boardStop.lat}
            toLon={busLeg.boardStop.lon}
            walkMinutes={busLeg.boardWalkMinutes}
            walkMeters={busLeg.boardWalkMeters}
            label="Walk to Bus Stop"
            sublabel={`${busLeg.nearestExitName || toName} exit → ${busLeg.boardStop.name}`}
          />
          <BusLegPanel busLeg={busLeg} isFirst={false} arrivalAtBusStopMin={arrivalAtBusStopMin} predictions={busPredictions ?? []} predictionsLoading={predictionsLoading} />
          <BusWalkCard
            fromLat={busLeg.alightStop.lat}
            fromLon={busLeg.alightStop.lon}
            toLat={destPlaceContext?.place.lat}
            toLon={destPlaceContext?.place.lon}
            walkMinutes={busLeg.alightWalkMinutes}
            walkMeters={busLeg.alightWalkMeters}
            label="Walk to Destination"
            sublabel={`${busLeg.alightStop.name} → ${destPlaceContext?.place.name || 'Your destination'}`}
          />
        </>
      )}

      {/* Walking card: last station → destination place (bus-metro only) */}
      {!isMetroBus && destPlaceContext && (
        <WalkingCard context={destPlaceContext} />
      )}

      {/* Journey time breakdown */}
      <BusJourneyInfo
        isMetroBus={isMetroBus}
        isDirect={isDirect}
        originWalk={originWalk}
        metroWait={metroWait}
        directRide={directRide}
        leg1Ride={leg1Ride}
        transferWalk={transferWalk}
        leg2Wait={leg2Wait}
        leg2Ride={leg2Ride}
        walkToBus={isMetroBus ? busLeg.boardWalkMinutes : null}
        walkFromBus={!isMetroBus ? busLeg.alightWalkMinutes : null}
        busWait={busWait}
        busRide={busLeg.scheduledRideMinutes ?? busLeg.estimatedRideMinutes}
        walkToDest={isMetroBus ? busLeg.alightWalkMinutes : null}
        walkToMetro={!isMetroBus ? busLeg.boardWalkMinutes : null}
        destWalk={destWalk}
        totalMinutes={totalMinutes}
        arrivalClock={arrivalClock}
      />
    </div>
  )
}

/** Walking card between Metro station and bus stop */
function BusWalkCard({ fromLat, fromLon, toLat, toLon, walkMinutes, walkMeters, label, sublabel, searchQuery }: {
  fromLat?: number
  fromLon?: number
  toLat?: number
  toLon?: number
  walkMinutes: number
  walkMeters: number
  label: string
  sublabel: string
  searchQuery?: string
}) {
  const hasFrom = fromLat != null && fromLon != null
  const hasTo = toLat != null && toLon != null

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)

  let mapsUrl: string
  if (hasFrom && hasTo) {
    mapsUrl = buildMapsUrl(fromLat, fromLon, toLat, toLon)
  } else if (hasTo && searchQuery) {
    // Has destination coords but no origin coords — use search query as origin (e.g. metro station name)
    mapsUrl = isIOS
      ? `maps://maps.apple.com/?saddr=${encodeURIComponent(searchQuery)}&daddr=${toLat},${toLon}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(searchQuery)}&destination=${toLat},${toLon}&travelmode=walking`
  } else if (hasTo) {
    mapsUrl = isIOS
      ? `maps://maps.apple.com/?daddr=${toLat},${toLon}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${toLat},${toLon}&travelmode=walking`
  } else if (hasFrom && searchQuery) {
    // Has origin coords but no destination coords — use search query as destination
    mapsUrl = isIOS
      ? `maps://maps.apple.com/?saddr=${fromLat},${fromLon}&daddr=${encodeURIComponent(searchQuery)}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLon}&destination=${encodeURIComponent(searchQuery)}&travelmode=walking`
  } else {
    const dest = searchQuery ? encodeURIComponent(searchQuery) : ''
    mapsUrl = isIOS
      ? `maps://maps.apple.com/?daddr=${dest}&dirflg=w`
      : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`
  }

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Footprints className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
            <span className="font-semibold text-[var(--text-primary)] text-sm">{label}</span>
            <span className="text-sm text-[var(--text-secondary)]">
              · {walkMinutes} min · {formatDistance(walkMeters)}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 ml-6">
            {sublabel}
          </p>
        </div>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-3 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-1.5"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Maps
        </a>
      </div>
    </div>
  )
}

/** The bus portion of a hybrid trip — shows route, stops, predictions */
function BusLegPanel({ busLeg, isFirst, arrivalAtBusStopMin, predictions, predictionsLoading, selectedDeparture, onSelectDeparture, onClearDeparture }: {
  busLeg: HybridTrip['busLeg']
  isFirst: boolean
  arrivalAtBusStopMin?: number | null
  predictions: BusPrediction[]
  predictionsLoading: boolean
  selectedDeparture?: { minutesFromNow: number; isRealTime: boolean; vehicleId?: string } | null
  onSelectDeparture?: (dep: { minutesFromNow: number; isRealTime: boolean; vehicleId?: string }) => void
  onClearDeparture?: () => void
}) {
  const isSelectable = !!onSelectDeparture
  const [collapsed, setCollapsed] = useState(false)

  // auto-collapse other departures when one is selected
  useEffect(() => {
    if (!isSelectable) return
    setCollapsed(!!selectedDeparture)
  }, [selectedDeparture, isSelectable])

  const rideMin = busLeg.scheduledRideMinutes ?? busLeg.estimatedRideMinutes

  // Filter & annotate predictions when we know the user's arrival time
  const filteredPredictions = useMemo(() => {
    const annotate = (p: BusPrediction, waitTime: number | null) => ({
      ...p,
      waitTime,
      clockTime: minutesToClockTime(p.minutes),
      arrivalClock: minutesToClockTime(p.minutes + rideMin),
    })
    if (arrivalAtBusStopMin == null) {
      return predictions.map(p => annotate(p, null))
    }
    return predictions
      .filter(p => p.minutes >= arrivalAtBusStopMin - 1) // 1-min grace period
      .map(p => annotate(p, Math.round(p.minutes - arrivalAtBusStopMin)))
  }, [predictions, arrivalAtBusStopMin, rideMin])

  // Scheduled departures not already covered by RT predictions.
  // Dedup by proximity: a scheduled departure within 2 min of an RT prediction
  // is likely the same bus, so skip it. Others are variant routes or buses
  // that haven't started their trip yet (no RT tracking).
  const scheduledAfterRT = useMemo(() => {
    const scheduled = busLeg.scheduledDepartures
    if (!scheduled || scheduled.length === 0) return []
    const rtMinutes = predictions.map(p => p.minutes)
    return scheduled
      .filter(s => {
        // Skip if a RT prediction is within 2 min (likely same bus)
        return !rtMinutes.some(rt => Math.abs(rt - s.minutesFromNow) <= 2)
      })
      .slice(0, 3)
      .map(s => ({
        ...s,
        waitTime: arrivalAtBusStopMin != null
          ? Math.round(s.minutesFromNow - arrivalAtBusStopMin)
          : null,
        arrivalClock: minutesToClockTime(s.minutesFromNow + rideMin),
      }))
  }, [busLeg.scheduledDepartures, predictions, arrivalAtBusStopMin, rideMin])

  // Match helper for identifying the selected departure in the list
  const isSelectedPrediction = (p: { minutes: number; vehicleId?: string }) => {
    if (!selectedDeparture) return false
    if (selectedDeparture.vehicleId && p.vehicleId) return p.vehicleId === selectedDeparture.vehicleId
    return Math.abs(p.minutes - selectedDeparture.minutesFromNow) < 1
  }

  const isSelectedScheduled = (s: { minutesFromNow: number }) => {
    if (!selectedDeparture || selectedDeparture.isRealTime) return false
    return Math.abs(s.minutesFromNow - selectedDeparture.minutesFromNow) < 1
  }

  // Build the selected departure card data (find it in the current list for live updates)
  const selectedCardData = useMemo(() => {
    if (!selectedDeparture) return null
    const fallbackArrival = minutesToClockTime(selectedDeparture.minutesFromNow + rideMin)
    if (selectedDeparture.isRealTime) {
      const match = filteredPredictions.find(p => isSelectedPrediction(p))
      if (match) return { type: 'rt' as const, ...match }
      // prediction gone from the list — keep showing what was selected
      return { type: 'rt' as const, minutes: selectedDeparture.minutesFromNow, directionText: busLeg.headsign || busLeg.routeName, vehicleId: selectedDeparture.vehicleId, waitTime: null, clockTime: minutesToClockTime(selectedDeparture.minutesFromNow), arrivalClock: fallbackArrival }
    }
    const match = scheduledAfterRT.find(s => isSelectedScheduled(s))
    if (match) return { type: 'sched' as const, ...match }
    return { type: 'sched' as const, minutesFromNow: selectedDeparture.minutesFromNow, departureTime: minutesToClockTime(selectedDeparture.minutesFromNow), waitTime: null, arrivalClock: fallbackArrival }
  }, [selectedDeparture, filteredPredictions, scheduledAfterRT, busLeg.headsign, busLeg.routeName, rideMin])

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-md">
      <div className="px-5 py-4" style={{ backgroundColor: '#0f7b72' }}>
        <h3 className="text-white font-semibold text-lg flex items-center gap-2">
          <Bus className="w-5 h-5" />
          Bus {busLeg.routeName}
          {busLeg.headsign && (
            <span className="text-white/70 font-normal text-base">→ {busLeg.headsign}</span>
          )}
        </h3>
        <p className="text-white/80 text-base mt-0.5">
          {isFirst ? 'Board' : 'Transfer to'} at {busLeg.boardStop.name}
        </p>
      </div>

      <div className="p-5 space-y-4">
        {/* Stop info */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-[#0f9b8e] shrink-0" />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">
                Board: {busLeg.boardStop.name}
              </div>
            </div>
          </div>

          <div className="ml-1.5 border-l-2 border-dashed border-[#0f9b8e]/40 h-6" />

          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full border-2 border-[#0f9b8e] shrink-0" />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">
                Exit: {busLeg.alightStop.name}
              </div>
            </div>
          </div>
        </div>

        <div className="text-xs text-[var(--text-secondary)]">
          {busLeg.scheduledRideMinutes ?? busLeg.estimatedRideMinutes} min ride
        </div>

        {/* Pinned selected departure */}
        {selectedDeparture && selectedCardData && isSelectable && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                Your Bus
              </div>
              <button
                onClick={onClearDeparture}
                className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                Change
              </button>
            </div>
            {selectedCardData.type === 'rt' ? (
              <div className="relative flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border-2 border-[#0f9b8e] scale-[1.02] shadow-lg pr-12">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#0f9b8e] flex items-center justify-center">
                    <span className="text-white text-xs font-bold">{busLeg.routeName}</span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                      {selectedCardData.directionText}
                      <Rss className="w-3.5 h-3.5 text-[#0f9b8e]" aria-label="Live prediction" />
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">
                      {selectedCardData.vehicleId ? `Vehicle ${selectedCardData.vehicleId} · ` : ''}Arr {selectedCardData.arrivalClock}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-[#0f9b8e]">
                    {selectedCardData.minutes === 0 ? 'ARR' : `${selectedCardData.minutes} min`}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {selectedCardData.minutes === 0 ? 'now' : selectedCardData.clockTime}
                  </div>
                </div>
                <div className="absolute top-1/2 right-3 -translate-y-1/2 w-7 h-7 bg-[#0f9b8e] rounded-full flex items-center justify-center shadow">
                  <Check className="w-4 h-4 text-white" />
                </div>
              </div>
            ) : (
              <div className="relative flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border-2 border-[#0f9b8e] scale-[1.02] shadow-lg pr-12">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#0f9b8e]/60 flex items-center justify-center">
                    <span className="text-white text-xs font-bold">{busLeg.routeName}</span>
                  </div>
                  <div>
                    <div className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                      {busLeg.headsign || busLeg.routeName}
                      <Clock3 className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-label="Scheduled" />
                    </div>
                    <div className="text-xs text-[var(--text-secondary)]">Arr {selectedCardData.arrivalClock} · Scheduled</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-bold text-[var(--text-primary)]">
                    {selectedCardData.minutesFromNow} min
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    {selectedCardData.departureTime}
                  </div>
                </div>
                <div className="absolute top-1/2 right-3 -translate-y-1/2 w-7 h-7 bg-[#0f9b8e] rounded-full flex items-center justify-center shadow">
                  <Check className="w-4 h-4 text-white" />
                </div>
              </div>
            )}

            {/* Divider */}
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--border-color)]"></div>
              </div>
            </div>
          </div>
        )}

        {/* Other departures header (when something is selected) */}
        {isSelectable && selectedDeparture && (
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
              Other Departures
            </div>
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              {collapsed ? 'Show' : 'Hide'}
            </button>
          </div>
        )}

        {/* Bus departures: RT predictions + scheduled */}
        {!collapsed && (
          <>
            {predictionsLoading ? (
              <div className="flex items-center justify-center py-4 gap-2 text-sm text-[var(--text-secondary)]">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading predictions...
              </div>
            ) : (filteredPredictions.length > 0 || scheduledAfterRT.length > 0) ? (
              <div>
                {!selectedDeparture && (
                  <div className="mb-2">
                    <div className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                      Next Buses
                    </div>
                    {isSelectable && (
                      <p className="text-xs text-[var(--text-secondary)] italic mt-1">
                        Tap a bus to see connections
                      </p>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  {/* Merged RT + scheduled departures, sorted by time */}
                  {[
                    ...filteredPredictions
                      .filter(p => !isSelectedPrediction(p))
                      .map(p => ({ type: 'rt' as const, min: p.minutes, data: p })),
                    ...scheduledAfterRT
                      .filter(s => !isSelectedScheduled(s))
                      .map(s => ({ type: 'sched' as const, min: s.minutesFromNow, data: s })),
                  ]
                    .sort((a, b) => a.min - b.min)
                    .map((item, i) => item.type === 'rt' ? (
                    <div
                      key={`rt-${i}`}
                      className={`flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] transition-all ${
                        isSelectable ? 'cursor-pointer hover:border-[#0f9b8e] hover:translate-x-1 hover:shadow-lg' : ''
                      }`}
                      onClick={isSelectable ? () => onSelectDeparture!({ minutesFromNow: item.data.minutes, isRealTime: true, vehicleId: item.data.vehicleId }) : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#0f9b8e] flex items-center justify-center">
                          <span className="text-white text-xs font-bold">{busLeg.routeName}</span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                            {item.data.directionText}
                            <Rss className="w-3.5 h-3.5 text-[#0f9b8e]" aria-label="Live prediction" />
                          </div>
                          <div className="text-xs text-[var(--text-secondary)]">
                            {item.data.waitTime != null ? (
                              <span className="text-[#0f9b8e]">{item.data.waitTime} min wait · </span>
                            ) : item.data.vehicleId ? (
                              <span>Vehicle {item.data.vehicleId} · </span>
                            ) : null}
                            Arr {item.data.arrivalClock}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold text-[#0f9b8e]">
                          {item.data.minutes === 0 ? 'ARR' : `${item.data.minutes} min`}
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {item.data.minutes === 0 ? 'now' : item.data.clockTime}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={`sched-${i}`}
                      className={`flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] opacity-75 transition-all ${
                        isSelectable ? 'cursor-pointer hover:border-[#0f9b8e] hover:translate-x-1 hover:shadow-lg hover:opacity-100' : ''
                      }`}
                      onClick={isSelectable ? () => onSelectDeparture!({ minutesFromNow: item.data.minutesFromNow, isRealTime: false }) : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#0f9b8e]/60 flex items-center justify-center">
                          <span className="text-white text-xs font-bold">{busLeg.routeName}</span>
                        </div>
                        <div>
                          <div className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                            {busLeg.headsign || busLeg.routeName}
                            <Clock3 className="w-3.5 h-3.5 text-[var(--text-secondary)]" aria-label="Scheduled" />
                          </div>
                          <div className="text-xs text-[var(--text-secondary)]">
                            {item.data.waitTime != null ? `${item.data.waitTime} min wait · ` : ''}Arr {item.data.arrivalClock} · Scheduled
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold text-[var(--text-primary)]">
                          {item.data.minutesFromNow} min
                        </div>
                        <div className="text-xs text-[var(--text-secondary)]">
                          {item.data.departureTime}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {filteredPredictions.length === 0 && predictions.length > 0 && (
                  <div className="text-center py-2 mt-2 text-sm text-[var(--text-secondary)]">
                    No live buses after your arrival
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-[var(--text-secondary)]">
                No departures found
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MetroIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-[#666] flex items-center justify-center shrink-0">
      <span className="text-[10px] font-bold text-white">M</span>
    </div>
  )
}

function BusIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-[#0f9b8e] flex items-center justify-center shrink-0">
      <Bus className="w-3 h-3 text-white" />
    </div>
  )
}

/** Journey time breakdown card for hybrid trips */
function BusJourneyInfo({ isMetroBus, isDirect, originWalk, metroWait, directRide, leg1Ride, transferWalk, leg2Wait, leg2Ride, walkToBus, walkFromBus, busWait, busRide, walkToDest, walkToMetro, destWalk, totalMinutes, arrivalClock }: {
  isMetroBus: boolean
  isDirect: boolean
  originWalk: number | null
  metroWait: number | null
  directRide: number | null
  leg1Ride: number | null
  transferWalk: number | null
  leg2Wait: number | null
  leg2Ride: number | null
  walkToBus: number | null
  walkFromBus: number | null
  busWait: number | null
  busRide: number
  walkToDest: number | null
  walkToMetro: number | null
  destWalk: number | null
  totalMinutes: number
  arrivalClock: string
}) {
  const fmt = (v: number | null) => v != null ? `${Math.round(v)} min` : '—'

  // Metro segments: single ride for direct, split for transfer
  const metroSegments: { label: string; value: string; icon: React.ReactNode }[] = isDirect
    ? [
        { label: 'metro ride', value: fmt(directRide), icon: <TrainIcon className="w-4 h-4" /> },
      ]
    : [
        { label: 'leg 1 ride', value: fmt(leg1Ride), icon: <TrainIcon className="w-4 h-4" /> },
        { label: 'transfer walk', value: fmt(transferWalk), icon: <Footprints className="w-4 h-4" /> },
        { label: 'leg 2 wait', value: fmt(leg2Wait), icon: <Clock3 className="w-4 h-4" /> },
        { label: 'leg 2 ride', value: fmt(leg2Ride), icon: <TrainIcon className="w-4 h-4" /> },
      ]

  const busSegments: { label: string; value: string; icon: React.ReactNode }[] = [
    { label: 'bus wait', value: fmt(busWait), icon: <Clock3 className="w-4 h-4" /> },
    { label: 'bus ride', value: `${busRide} min`, icon: <Bus className="w-4 h-4" /> },
  ]

  // Build full segment list in trip order
  const segments: { label: string; value: string; icon: React.ReactNode }[] = isMetroBus
    ? [
        ...(originWalk ? [{ label: 'walk to stn', value: fmt(originWalk), icon: <Footprints className="w-4 h-4" /> }] : []),
        { label: 'metro wait', value: fmt(metroWait), icon: <Clock3 className="w-4 h-4" /> },
        ...metroSegments,
        { label: 'walk to bus', value: fmt(walkToBus), icon: <Footprints className="w-4 h-4" /> },
        ...busSegments,
        { label: 'walk to dest', value: fmt(walkToDest), icon: <Footprints className="w-4 h-4" /> },
      ]
    : [
        { label: 'walk to bus', value: fmt(walkToMetro), icon: <Footprints className="w-4 h-4" /> },
        ...busSegments,
        { label: 'walk to metro', value: fmt(walkFromBus), icon: <Footprints className="w-4 h-4" /> },
        { label: 'metro wait', value: fmt(metroWait), icon: <Clock3 className="w-4 h-4" /> },
        ...metroSegments,
        ...(destWalk ? [{ label: 'exit walk', value: fmt(destWalk), icon: <Footprints className="w-4 h-4" /> }] : []),
      ]

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-5 shadow-md space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] mb-1">
            total trip time
          </div>
          <div className="text-3xl font-bold text-[var(--text-primary)] leading-tight">
            {totalMinutes} min
          </div>
        </div>
        <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#1f2a3d] text-white border border-[var(--border-color)]">
          Arr {arrivalClock}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-color)]">
            <span className="text-[var(--text-secondary)]">{s.icon}</span>
            <div className="flex-1">
              <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)] mb-0.5">
                {s.label}
              </div>
              <div className="text-lg font-semibold text-[var(--text-primary)]">{s.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
