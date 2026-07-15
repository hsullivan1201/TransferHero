import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bus,
  Check,
  Clock3,
  ExternalLink,
  Footprints,
  Loader2,
  Radio,
  RefreshCw,
  TrainFront,
} from 'lucide-react'
import type {
  BusAgencyId,
  BusPrediction,
  CatchableTrain,
  HybridTrip,
  PlaceContext,
  Train,
} from '@transferhero/shared'
import { useBusPredictions } from '../hooks/useBusPredictions'
import { useLeg2, useTrip } from '../hooks/useTrip'
import { formatDistance } from '../utils/geo'
import {
  computeTotalMinutes,
  getTrainMinutes,
  minutesToClockTime,
} from '../utils/time'
import { BetaStep, BetaTripView } from './BetaTripView'
import { UpdatedAgo } from './UpdatedAgo'

interface BetaBusTripListProps {
  trips: HybridTrip[]
  isLoading: boolean
  stationNames: Map<string, string>
  originPlaceContext: PlaceContext | null
  destPlaceContext: PlaceContext | null
  walkTime: number
  accessible: boolean
}

interface SelectedBusDeparture {
  minutesFromNow: number
  isRealTime: boolean
  vehicleId?: string
  clockTime?: string
}

interface DisplayBusDeparture {
  key: string
  source: 'live' | 'scheduled'
  minutes: number
  direction: string
  vehicleId?: string
  waitTime: number | null
  clockTime: string
  arrivalClock: string
}

const INITIAL_VISIBLE = 3

function agencyLabel(id: BusAgencyId): string {
  switch (id) {
    case 'art': return 'ART'
    case 'wmata': return 'Metrobus'
    case 'fairfax': return 'Ffx Connector'
    default: return id
  }
}

function hybridTripKey(trip: HybridTrip): string {
  return [
    trip.pattern,
    trip.busLeg.agencyId,
    trip.busLeg.routeId,
    trip.busLeg.boardStop.stopId,
    trip.busLeg.alightStop.stopId,
    trip.metroFrom,
    trip.metroTo,
  ].join(':')
}

function sameTrain(a: Train | null | undefined, b: Train | null | undefined): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a._tripId && b._tripId) return a._tripId === b._tripId
  if (a.TrainId != null && b.TrainId != null) return String(a.TrainId) === String(b.TrainId)
  if (a.TrainNumber != null && b.TrainNumber != null) return String(a.TrainNumber) === String(b.TrainNumber)
  return a.Line === b.Line && a.DestinationName === b.DestinationName && a.Min === b.Min
}

function mergeBusDepartures(
  trip: HybridTrip,
  predictions: BusPrediction[],
  arrivalAtStopMin: number | null
): DisplayBusDeparture[] {
  const rideMinutes = trip.busLeg.scheduledRideMinutes ?? trip.busLeg.estimatedRideMinutes
  const live = predictions
    .filter((prediction) => arrivalAtStopMin == null || prediction.minutes >= arrivalAtStopMin - 1)
    .map((prediction) => ({
      key: `live-${prediction.vehicleId ?? prediction.minutes}-${prediction.directionText}`,
      source: 'live' as const,
      minutes: prediction.minutes,
      direction: prediction.directionText || trip.busLeg.headsign || trip.busLeg.routeName,
      vehicleId: prediction.vehicleId,
      waitTime: arrivalAtStopMin == null ? null : Math.round(prediction.minutes - arrivalAtStopMin),
      clockTime: minutesToClockTime(prediction.minutes),
      arrivalClock: minutesToClockTime(prediction.minutes + rideMinutes),
    }))

  const scheduled = (trip.busLeg.scheduledDepartures ?? [])
    .filter((departure) => arrivalAtStopMin == null || departure.minutesFromNow >= arrivalAtStopMin - 1)
    .filter((departure) => !live.some((prediction) => Math.abs(prediction.minutes - departure.minutesFromNow) <= 2))
    .map((departure) => ({
      key: `scheduled-${departure.minutesFromNow}-${departure.departureTime}`,
      source: 'scheduled' as const,
      minutes: departure.minutesFromNow,
      direction: trip.busLeg.headsign || trip.busLeg.routeName,
      waitTime: arrivalAtStopMin == null ? null : Math.round(departure.minutesFromNow - arrivalAtStopMin),
      clockTime: departure.departureTime,
      arrivalClock: minutesToClockTime(departure.minutesFromNow + rideMinutes),
    }))

  return [...live, ...scheduled].sort((a, b) => a.minutes - b.minutes)
}

function selectedBusMatches(
  selected: SelectedBusDeparture | null,
  departure: DisplayBusDeparture
): boolean {
  if (!selected) return false
  if (selected.isRealTime !== (departure.source === 'live')) return false
  if (selected.vehicleId && departure.vehicleId) return selected.vehicleId === departure.vehicleId
  if (!selected.isRealTime && selected.clockTime) return selected.clockTime === departure.clockTime
  return Math.abs(selected.minutesFromNow - departure.minutes) < 1
}

export function BetaBusTripList({
  trips,
  isLoading,
  stationNames,
  originPlaceContext,
  destPlaceContext,
  walkTime,
  accessible,
}: BetaBusTripListProps) {
  const [selection, setSelection] = useState<{ key: string } | null>(null)
  const [expanded, setExpanded] = useState(false)

  if (isLoading) {
    return (
      <div className="beta-hybrid-loading" role="status" aria-label="Loading Metro and bus options">
        {[1, 2, 3].map((item) => <span key={item} />)}
      </div>
    )
  }

  if (trips.length === 0) {
    return (
      <div className="beta-sign beta-hybrid-empty">
        <span className="beta-hybrid-empty-icon"><Bus aria-hidden="true" /></span>
        <strong>No Metro + bus options found</strong>
        <small>Try a different origin or destination.</small>
      </div>
    )
  }

  const selectedTrip = selection
    ? trips.find((trip) => hybridTripKey(trip) === selection.key) ?? null
    : null

  if (selectedTrip) {
    return (
      <BetaBusTripDetail
        trip={selectedTrip}
        stationNames={stationNames}
        originPlaceContext={originPlaceContext}
        destPlaceContext={destPlaceContext}
        walkTime={walkTime}
        accessible={accessible}
        onBack={() => setSelection(null)}
      />
    )
  }

  const visibleTrips = expanded ? trips : trips.slice(0, INITIAL_VISIBLE)
  const hiddenCount = trips.length - INITIAL_VISIBLE

  return (
    <div className="beta-hybrid-list">
      <div className="beta-hybrid-list-intro">
        <strong>Metro + bus options</strong>
        <span>Ranked using current service and scheduled travel times</span>
      </div>
      {visibleTrips.map((trip) => (
        <BetaBusTripOption
          key={hybridTripKey(trip)}
          trip={trip}
          stationNames={stationNames}
          onSelect={() => setSelection({ key: hybridTripKey(trip) })}
        />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button type="button" className="beta-show-more beta-hybrid-show-more" onClick={() => setExpanded(true)}>
          Show {hiddenCount} more option{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
    </div>
  )
}

function BetaBusTripOption({
  trip,
  stationNames,
  onSelect,
}: {
  trip: HybridTrip
  stationNames: Map<string, string>
  onSelect: () => void
}) {
  const metroFirst = trip.pattern === 'metro-bus'
  const fromName = stationNames.get(trip.metroFrom) ?? trip.metroFrom
  const toName = stationNames.get(trip.metroTo) ?? trip.metroTo
  const busRide = trip.busLeg.scheduledRideMinutes ?? trip.busLeg.estimatedRideMinutes

  const metroMode = <span className="beta-hybrid-mode"><TrainFront aria-hidden="true" /> Metro</span>
  const busMode = (
    <span className="beta-hybrid-route-tile">
      <Bus aria-hidden="true" />
      <b>{trip.busLeg.routeName}</b>
    </span>
  )
  const metroDetail = (
    <span>
      <small>Metro</small>
      <strong>{fromName} → {toName}</strong>
      <em>{trip.metroTimeMinutes} min</em>
    </span>
  )
  const busDetail = (
    <span>
      <small>{agencyLabel(trip.busLeg.agencyId)} {trip.busLeg.routeName}</small>
      <strong>Toward {trip.busLeg.headsign || trip.busLeg.alightStop.name}</strong>
      <em>{busRide} min · get off at {trip.busLeg.alightStop.name}</em>
    </span>
  )

  return (
    <button
      type="button"
      className="beta-sign beta-hybrid-option"
      data-testid="bus-trip-card"
      data-pattern={trip.pattern}
      data-route-id={trip.busLeg.routeId}
      onClick={onSelect}
    >
      <span className="beta-hybrid-option-top">
        <span className="beta-hybrid-chain">
          {metroFirst ? metroMode : busMode}
          <ArrowRight aria-hidden="true" />
          {metroFirst ? busMode : metroMode}
        </span>
        <span className="beta-hybrid-time"><b>{trip.totalTimeMinutes}</b><small>min</small></span>
      </span>
      <span className="beta-hybrid-option-body">
        {metroFirst ? <>{metroDetail}{busDetail}</> : <>{busDetail}{metroDetail}</>}
      </span>
      <span className="beta-hybrid-option-footer">
        <span><Footprints aria-hidden="true" /> {trip.busLeg.boardWalkMinutes} min to bus · {trip.busLeg.alightWalkMinutes} min after bus</span>
        <strong>View full wayfinding <ArrowRight aria-hidden="true" /></strong>
      </span>
    </button>
  )
}

function BetaBusTripDetail({
  trip,
  stationNames,
  originPlaceContext,
  destPlaceContext,
  onBack,
  walkTime,
  accessible,
}: {
  trip: HybridTrip
  stationNames: Map<string, string>
  originPlaceContext: PlaceContext | null
  destPlaceContext: PlaceContext | null
  onBack: () => void
  walkTime: number
  accessible: boolean
}) {
  const metroFirst = trip.pattern === 'metro-bus'
  const busRide = trip.busLeg.scheduledRideMinutes ?? trip.busLeg.estimatedRideMinutes
  const [selectedBusDeparture, setSelectedBusDeparture] = useState<SelectedBusDeparture | null>(null)
  const [selectedTrain, setSelectedTrain] = useState<Train | null>(null)
  const [departureTimestamp, setDepartureTimestamp] = useState<number | null>(null)
  const [selectedLeg2Train, setSelectedLeg2Train] = useState<Train | null>(null)
  const [showDeparted, setShowDeparted] = useState(false)

  const {
    data: busPredictions = [],
    isLoading: predictionsLoading,
    isFetching: predictionsFetching,
    refetch: refetchPredictions,
  } = useBusPredictions(
    trip.busLeg.boardStop.stopCode,
    trip.busLeg.routeId,
    true,
    trip.busLeg.boardStop.stopId,
    trip.busLeg.alightStop.stopId,
    trip.busLeg.agencyId
  )

  const {
    data: metroTripData,
    isLoading: metroLoading,
    isFetching: metroFetching,
    isError: metroError,
    error: metroErrorDetails,
    refetch: refetchMetro,
  } = useTrip(trip.metroFrom, trip.metroTo, walkTime, null, accessible, showDeparted)

  const displayTrain = useMemo(() => {
    if (!selectedTrain) return null
    return metroTripData?.trip?.leg1?.trains.find((train) => sameTrain(train, selectedTrain)) ?? selectedTrain
  }, [selectedTrain, metroTripData])

  const isDirect = metroTripData?.trip?.isDirect ?? false
  const transfer = metroTripData?.trip?.transfer ?? null
  const transferArrivalMin = displayTrain?._transferArrivalTimestamp
    ? Math.round((displayTrain._transferArrivalTimestamp - Date.now()) / 60_000)
    : undefined

  const {
    data: leg2Data,
    isLoading: leg2Loading,
    isFetching: leg2Fetching,
    refetch: refetchLeg2,
  } = useLeg2({
    tripId: `${trip.metroFrom}-${trip.metroTo}`,
    departureTimestamp,
    walkTime,
    enabled: !!selectedTrain && !isDirect,
    transferArrivalMin,
    accessible,
    showDeparted,
  })

  const handleBusSelect = useCallback((departure: SelectedBusDeparture) => {
    setSelectedBusDeparture(departure)
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

  const handleTrainSelect = useCallback((train: Train) => {
    const minutes = getTrainMinutes(train.Min)
    setSelectedTrain(train)
    setDepartureTimestamp(Date.now() + minutes * 60_000)
    setSelectedLeg2Train(null)
  }, [])

  const rawMetroTrains = metroTripData?.trip?.leg1?.trains ?? []
  const originWalk = metroFirst && !originPlaceContext?.busOnly
    ? originPlaceContext?.walkTimeMinutes ?? 0
    : 0
  const busFirstDepartures = useMemo(
    () => metroFirst
      ? []
      : mergeBusDepartures(trip, busPredictions, trip.busLeg.boardWalkMinutes),
    [metroFirst, trip, busPredictions]
  )
  const currentSelectedBusMinutes = useMemo(() => {
    if (!selectedBusDeparture) return null
    if (selectedBusDeparture.isRealTime) {
      const match = busPredictions.find((prediction) => {
        if (selectedBusDeparture.vehicleId && prediction.vehicleId) {
          return selectedBusDeparture.vehicleId === prediction.vehicleId
        }
        return Math.abs(prediction.minutes - selectedBusDeparture.minutesFromNow) < 1
      })
      return match?.minutes ?? selectedBusDeparture.minutesFromNow
    }
    const match = trip.busLeg.scheduledDepartures?.find((departure) => (
      selectedBusDeparture.clockTime
        ? departure.departureTime === selectedBusDeparture.clockTime
        : Math.abs(departure.minutesFromNow - selectedBusDeparture.minutesFromNow) < 1
    ))
    return match?.minutesFromNow ?? selectedBusDeparture.minutesFromNow
  }, [selectedBusDeparture, busPredictions, trip.busLeg.scheduledDepartures])
  const provisionalBusDepartureMin = !metroFirst
    ? currentSelectedBusMinutes
      ?? busFirstDepartures[0]?.minutes
      ?? (trip.busLeg.scheduledWaitMinutes != null
        ? trip.busLeg.boardWalkMinutes + trip.busLeg.scheduledWaitMinutes
        : null)
    : null
  const arrivalAtMetroMin = provisionalBusDepartureMin != null
    ? provisionalBusDepartureMin + busRide + trip.busLeg.alightWalkMinutes
    : null

  const metroTrains: (Train | CatchableTrain)[] = useMemo(() => {
    if (arrivalAtMetroMin == null) return rawMetroTrains
    return rawMetroTrains
      .map((train) => {
        const wait = Math.round(getTrainMinutes(train.Min) - arrivalAtMetroMin)
        const total = train._destArrivalMin ?? getTrainMinutes(train.Min) + trip.metroTimeMinutes
        return {
          ...train,
          _waitTime: wait,
          _canCatch: wait >= -5,
          _totalTime: total,
          _arrivalClock: train._destArrivalTime ?? minutesToClockTime(total),
        } satisfies CatchableTrain
      })
      .filter((train) => train._canCatch)
      .sort((a, b) => {
        if (!!a._scheduled !== !!b._scheduled) return a._scheduled ? 1 : -1
        return getTrainMinutes(a.Min) - getTrainMinutes(b.Min)
      })
  }, [arrivalAtMetroMin, rawMetroTrains, trip.metroTimeMinutes])

  const selectedDisplayTrain = displayTrain
    ? metroTrains.find((train) => sameTrain(train, displayTrain)) ?? displayTrain
    : null
  const reachableMetroTrain = metroFirst
    ? metroTrains.find((train) => {
        const departure = getTrainMinutes(train.Min)
        return !Number.isFinite(departure) || departure >= originWalk
      }) ?? null
    : metroTrains.find((train) => (
        '_waitTime' in train
        && typeof train._waitTime === 'number'
        && train._waitTime >= 0
      )) ?? metroTrains[0] ?? null
  const activeMetroTrain = selectedDisplayTrain ?? reachableMetroTrain
  const primaryLine = activeMetroTrain?.Line ?? transfer?.fromLine ?? metroTripData?.trip?.origin.lines[0]
  const leg1CarPosition = primaryLine
    ? metroTripData?.trip?.leg1.lineCarPositions?.[primaryLine] ?? metroTripData?.trip?.leg1.carPosition ?? null
    : metroTripData?.trip?.leg1.carPosition ?? null
  const needsLiveLeg2 = !!selectedTrain && !isDirect
  const leg2Trains = leg2Data?.trains
    ?? metroTripData?.trip?.leg2?.trains
    ?? []
  const leg2CarPosition = leg2Data?.exitCarPosition ?? metroTripData?.trip?.leg2?.carPosition ?? null
  const displayLeg2Train = selectedLeg2Train
    ? leg2Trains.find((train) => sameTrain(train, selectedLeg2Train)) ?? selectedLeg2Train
    : null

  const activeDepartureMin = activeMetroTrain
    ? selectedTrain && departureTimestamp != null
      ? (departureTimestamp - Date.now()) / 60_000
      : getTrainMinutes(activeMetroTrain.Min)
    : null
  const isSelectedDeparted = !!selectedTrain && !!activeMetroTrain
    && (activeMetroTrain._departed === true || (activeDepartureMin != null && activeDepartureMin < 0))
  const directRide = useMemo(() => {
    if (!isDirect || !activeMetroTrain) return null
    if (isSelectedDeparted) {
      if (activeMetroTrain._destArrivalTimestamp) {
        return Math.max(0, Math.round((activeMetroTrain._destArrivalTimestamp - Date.now()) / 60_000))
      }
      if (activeMetroTrain._destArrivalMin != null) {
        return Math.max(0, Math.round(activeMetroTrain._destArrivalMin))
      }
      return Math.max(0, Math.round(trip.metroTimeMinutes + (activeDepartureMin ?? 0)))
    }
    if (activeMetroTrain._destArrivalMin == null) return trip.metroTimeMinutes
    return Math.max(0, Math.round(activeMetroTrain._destArrivalMin - getTrainMinutes(activeMetroTrain.Min)))
  }, [activeDepartureMin, activeMetroTrain, isDirect, isSelectedDeparted, trip.metroTimeMinutes])
  const leg1Ride = transfer?.leg1Time ?? null
  const leg2Ride = transfer?.leg2Time ?? null
  const remainingLeg1Ride = leg1Ride != null && isSelectedDeparted && activeMetroTrain
    ? activeMetroTrain._transferArrivalTimestamp
      ? Math.max(0, Math.round((activeMetroTrain._transferArrivalTimestamp - Date.now()) / 60_000))
      : activeMetroTrain._transferArrivalMin != null
        ? Math.max(0, Math.round(activeMetroTrain._transferArrivalMin))
        : Math.max(0, leg1Ride + Math.min(0, activeDepartureMin ?? 0))
    : leg1Ride
  const arrivalAtConnectingPlatform = activeDepartureMin != null && remainingLeg1Ride != null
    ? Math.max(0, activeDepartureMin) + remainingLeg1Ride + walkTime
    : null
  const leg2ConnectionRows = !isDirect && arrivalAtConnectingPlatform != null
    ? leg2Trains.flatMap((train) => {
        const wait = Math.round(getTrainMinutes(train.Min) - arrivalAtConnectingPlatform)
        return Number.isFinite(wait) && wait >= -3 ? [{ train, wait }] : []
      })
    : []
  const selectedLeg2Connection = displayLeg2Train
    ? leg2ConnectionRows.find(({ train }) => sameTrain(train, displayLeg2Train)) ?? null
    : null
  const leg2ConnectionRow = selectedLeg2Connection
    ?? leg2ConnectionRows.find(({ wait }) => wait >= 0)
    ?? leg2ConnectionRows[0]
    ?? null
  const leg2Connection = leg2ConnectionRow?.train ?? null
  const leg2Wait = leg2ConnectionRow ? Math.max(0, leg2ConnectionRow.wait) : null
  const metroRideSegments = isDirect
    ? [directRide]
    : [remainingLeg1Ride, walkTime, leg2Wait, leg2Ride]
  const totalMetroRide = computeTotalMinutes(metroRideSegments)
  const destWalk = !metroFirst ? destPlaceContext?.walkTimeMinutes ?? 0 : 0

  const metroWait = useMemo(() => {
    if (!metroFirst && arrivalAtMetroMin != null) {
      if (
        activeMetroTrain
        && '_waitTime' in activeMetroTrain
        && typeof activeMetroTrain._waitTime === 'number'
      ) return Math.max(0, activeMetroTrain._waitTime)
      return null
    }
    if (!activeMetroTrain) return null
    return Math.max(0, getTrainMinutes(activeMetroTrain.Min) - originWalk)
  }, [activeMetroTrain, arrivalAtMetroMin, metroFirst, originWalk])

  const arrivalAtBusStopMin = useMemo(() => {
    if (!metroFirst) return null
    if (!activeMetroTrain) return null
    if (isDirect) {
      if (activeMetroTrain._destArrivalTimestamp) {
        return (activeMetroTrain._destArrivalTimestamp - Date.now()) / 60_000 + trip.busLeg.boardWalkMinutes
      }
      if (activeMetroTrain._destArrivalMin != null) {
        return activeMetroTrain._destArrivalMin + trip.busLeg.boardWalkMinutes
      }
    }
    if (leg2Connection?._destArrivalTimestamp) {
      return (leg2Connection._destArrivalTimestamp - Date.now()) / 60_000 + trip.busLeg.boardWalkMinutes
    }
    if (leg2Connection?._destArrivalMin != null) {
      return leg2Connection._destArrivalMin + trip.busLeg.boardWalkMinutes
    }
    if (leg2Connection && '_totalTime' in leg2Connection && typeof leg2Connection._totalTime === 'number') {
      return leg2Connection._totalTime + trip.busLeg.boardWalkMinutes
    }
    return Math.max(0, getTrainMinutes(activeMetroTrain.Min)) + totalMetroRide + trip.busLeg.boardWalkMinutes
  }, [activeMetroTrain, isDirect, leg2Connection, metroFirst, totalMetroRide, trip.busLeg.boardWalkMinutes])

  const estimatedArrivalAtBusStop = metroFirst && arrivalAtBusStopMin == null && reachableMetroTrain
    ? Math.max(0, getTrainMinutes(reachableMetroTrain.Min)) + totalMetroRide + trip.busLeg.boardWalkMinutes
    : arrivalAtBusStopMin
  const departures = useMemo(
    () => metroFirst
      ? mergeBusDepartures(trip, busPredictions, estimatedArrivalAtBusStop)
      : busFirstDepartures,
    [trip, busPredictions, metroFirst, estimatedArrivalAtBusStop, busFirstDepartures]
  )
  const selectedDepartureRow = selectedBusDeparture
    ? departures.find((departure) => selectedBusMatches(selectedBusDeparture, departure)) ?? {
        key: 'selected-bus-fallback',
        source: selectedBusDeparture.isRealTime ? 'live' as const : 'scheduled' as const,
        minutes: selectedBusDeparture.minutesFromNow,
        direction: trip.busLeg.headsign || trip.busLeg.routeName,
        vehicleId: selectedBusDeparture.vehicleId,
        waitTime: null,
        clockTime: selectedBusDeparture.clockTime ?? minutesToClockTime(currentSelectedBusMinutes ?? selectedBusDeparture.minutesFromNow),
        arrivalClock: minutesToClockTime((currentSelectedBusMinutes ?? selectedBusDeparture.minutesFromNow) + busRide),
      }
    : null

  const busWait = metroFirst
    ? Math.max(0, departures[0]?.waitTime ?? trip.busLeg.scheduledWaitMinutes ?? 0)
    : selectedBusDeparture
      ? Math.max(0, (currentSelectedBusMinutes ?? selectedBusDeparture.minutesFromNow) - trip.busLeg.boardWalkMinutes)
      : departures[0]
        ? Math.max(0, departures[0].minutes - trip.busLeg.boardWalkMinutes)
        : trip.busLeg.scheduledWaitMinutes ?? 0
  const totalMinutes = computeTotalMinutes(metroFirst
    ? [originWalk, metroWait, ...metroRideSegments, trip.busLeg.boardWalkMinutes, busWait, busRide, trip.busLeg.alightWalkMinutes]
    : [trip.busLeg.boardWalkMinutes, busWait, busRide, trip.busLeg.alightWalkMinutes, metroWait, ...metroRideSegments, destWalk]
  ) || trip.totalTimeMinutes
  const arrivalClock = minutesToClockTime(totalMinutes)

  const busStopContext: PlaceContext | null = metroFirst && metroTripData?.trip ? {
    place: {
      id: `bus-stop-${trip.busLeg.boardStop.stopId}`,
      name: trip.busLeg.boardStop.name,
      context: `${agencyLabel(trip.busLeg.agencyId)} stop`,
      lat: trip.busLeg.boardStop.lat,
      lon: trip.busLeg.boardStop.lon,
    },
    station: metroTripData.trip.destination,
    exit: {
      id: `bus-transfer-${trip.busLeg.boardStop.stopId}`,
      name: trip.busLeg.nearestExitName ?? 'Nearest station exit',
      lat: trip.busLeg.nearestExitLat ?? trip.busLeg.boardStop.lat,
      lon: trip.busLeg.nearestExitLon ?? trip.busLeg.boardStop.lon,
      isAccessible: accessible,
    },
    walkTimeMinutes: trip.busLeg.boardWalkMinutes,
    walkDistanceMeters: trip.busLeg.boardWalkMeters,
    direction: 'from_station',
    alternatives: [],
  } : null
  const metroOriginContext = metroFirst && originPlaceContext && !originPlaceContext.busOnly
    ? { ...originPlaceContext, alternatives: [] }
    : null
  const metroDestContext = metroFirst
    ? busStopContext
    : destPlaceContext ? { ...destPlaceContext, alternatives: [] } : null
  const metroStepCount = (metroOriginContext ? 1 : 0)
    + 1
    + (leg1CarPosition ? 1 : 0)
    + (!isDirect && transfer ? 1 : 0)
    + (!isDirect && leg2CarPosition ? 1 : 0)
    + 1
    + 1
    + (metroDestContext ? 1 : 0)
  const prefixSteps = metroFirst ? 0 : 3
  const finalSummaryStep = prefixSteps + metroStepCount + (metroFirst ? 3 : 1)
  const isRefreshing = metroFetching || leg2Fetching || predictionsFetching
  const noopWalkingAlternative = useCallback(() => undefined, [])

  if (metroError && !metroTripData?.trip) {
    return (
      <div className="beta-hybrid-detail">
        <button type="button" className="beta-hybrid-back" onClick={onBack}><ArrowLeft /> All Metro + bus options</button>
        <div className="beta-error" role="alert">
          <span>
            Couldn&apos;t load the Metro part of this itinerary.
            {metroErrorDetails instanceof Error ? ` ${metroErrorDetails.message}` : ''}
          </span>
          <button type="button" onClick={() => void refetchMetro()}>Try again</button>
        </div>
      </div>
    )
  }

  if (metroLoading || !metroTripData?.trip) {
    return (
      <div className="beta-hybrid-detail">
        <button type="button" className="beta-hybrid-back" onClick={onBack}><ArrowLeft /> All Metro + bus options</button>
        <div className="beta-hybrid-loading" role="status" aria-label="Loading full wayfinding"><span /><span /><span /></div>
      </div>
    )
  }

  const renderMetro = (stepOffset: number) => (
    <BetaTripView
      origin={metroTripData.trip.origin}
      destination={metroTripData.trip.destination}
      transfer={transfer}
      leg1Trains={metroTrains}
      leg2Trains={leg2Trains}
      leg1CarPosition={leg1CarPosition}
      leg1LineCarPositions={metroTripData.trip.leg1.lineCarPositions}
      leg2CarPosition={leg2CarPosition}
      leg1Stops={metroTripData.trip.leg1.stops ?? []}
      leg1StopsBeyond={metroTripData.trip.leg1.stopsBeyond ?? []}
      leg1LineStops={metroTripData.trip.leg1.lineStops}
      leg1LineStopsBeyond={metroTripData.trip.leg1.lineStopsBeyond}
      leg2Stops={metroTripData.trip.leg2?.stops ?? []}
      leg2StopsBeyond={metroTripData.trip.leg2?.stopsBeyond ?? []}
      leg1Time={isDirect ? trip.metroTimeMinutes : transfer?.leg1Time ?? 0}
      leg2Time={transfer?.leg2Time ?? 0}
      walkTime={walkTime}
      onSelectLeg1Train={(train) => handleTrainSelect(train)}
      onClearLeg1Selection={() => {
        setSelectedTrain(null)
        setDepartureTimestamp(null)
        setSelectedLeg2Train(null)
      }}
      selectedLeg1Train={selectedTrain}
      departureTimestamp={departureTimestamp}
      onRefresh={() => {
        refetchMetro()
        refetchPredictions()
        if (!isDirect) refetchLeg2()
      }}
      isRefreshing={isRefreshing}
      fetchedAt={metroTripData.meta.fetchedAt}
      isLoadingLeg2={needsLiveLeg2 && leg2Loading}
      isDirect={isDirect}
      showDeparted={showDeparted}
      onToggleShowDeparted={() => setShowDeparted((value) => !value)}
      accessible={accessible}
      originPlaceContext={metroOriginContext}
      destPlaceContext={metroDestContext}
      onSelectOriginWalkingAlt={noopWalkingAlternative}
      onSelectDestWalkingAlt={noopWalkingAlternative}
      embedded
      stepOffset={stepOffset}
      overviewTitle="Metro leg at a glance"
      selectedLeg2Train={selectedLeg2Train}
      onSelectLeg2Train={(train) => setSelectedLeg2Train(train)}
      onClearLeg2Selection={() => setSelectedLeg2Train(null)}
      preferredLeg1Train={activeMetroTrain}
    />
  )

  const breakdown = buildBreakdown({
    metroFirst,
    originWalk,
    metroWait,
    directRide,
    leg1Ride: remainingLeg1Ride,
    transferWalk: isDirect ? null : walkTime,
    leg2Wait,
    leg2Ride,
    walkToBus: trip.busLeg.boardWalkMinutes,
    busWait,
    busRide,
    walkFromBus: trip.busLeg.alightWalkMinutes,
    destWalk,
  })

  return (
    <div className="beta-hybrid-detail">
      <button type="button" className="beta-hybrid-back" onClick={onBack}>
        <ArrowLeft aria-hidden="true" /> All Metro + bus options
      </button>
      <div className="beta-summary" aria-live="polite">
        <span className="beta-total">{totalMinutes}<small> min</small></span>
        <span className="beta-via">
          {metroFirst ? 'Metro → ' : ''}{agencyLabel(trip.busLeg.agencyId)} {trip.busLeg.routeName}{metroFirst ? '' : ' → Metro'}
        </span>
        <span className="beta-arrival">Arr {arrivalClock}</span>
      </div>
      <div className="beta-refresh-row">
        <UpdatedAgo fetchedAt={metroTripData.meta.fetchedAt} isFetching={isRefreshing} />
        <button
          type="button"
          onClick={() => {
            refetchMetro()
            refetchPredictions()
            if (!isDirect) refetchLeg2()
          }}
          disabled={isRefreshing}
        >
          <RefreshCw className={isRefreshing ? 'animate-spin' : ''} />
          {isRefreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {metroFirst ? (
        <>
          {renderMetro(0)}
          <BetaStep number={metroStepCount + 1} title={`Board ${agencyLabel(trip.busLeg.agencyId)} ${trip.busLeg.routeName}`}>
            <BetaBusLegSign
              trip={trip}
              departures={departures}
              predictionsLoading={predictionsLoading}
              arrivalAtStopMin={estimatedArrivalAtBusStop}
            />
          </BetaStep>
          <BetaStep number={metroStepCount + 2} title={`Get off at ${trip.busLeg.alightStop.name} — walk to your destination`}>
            <BetaBusWalkSign
              fromLat={trip.busLeg.alightStop.lat}
              fromLon={trip.busLeg.alightStop.lon}
              toLat={destPlaceContext?.place.lat}
              toLon={destPlaceContext?.place.lon}
              minutes={trip.busLeg.alightWalkMinutes}
              meters={trip.busLeg.alightWalkMeters}
              destination={destPlaceContext?.place.name ?? 'Your destination'}
              detail={`${trip.busLeg.alightStop.name} → destination`}
              fromLabel={trip.busLeg.alightStop.name}
              toLabel={destPlaceContext?.place.name}
            />
          </BetaStep>
          <BetaStep number={finalSummaryStep} title="Your complete trip at a glance">
            <BetaHybridGlance trip={trip} totalMinutes={totalMinutes} arrivalClock={arrivalClock} segments={breakdown} />
          </BetaStep>
        </>
      ) : (
        <>
          <BetaStep number={1} title={`Walk to ${trip.busLeg.boardStop.name}`}>
            <BetaBusWalkSign
              fromLat={originPlaceContext?.place.lat}
              fromLon={originPlaceContext?.place.lon}
              toLat={trip.busLeg.boardStop.lat}
              toLon={trip.busLeg.boardStop.lon}
              minutes={trip.busLeg.boardWalkMinutes}
              meters={trip.busLeg.boardWalkMeters}
              destination={trip.busLeg.boardStop.name}
              detail={`${originPlaceContext?.place.name ?? 'Your location'} → bus stop`}
              fromLabel={originPlaceContext?.place.name}
              toLabel={trip.busLeg.boardStop.name}
            />
          </BetaStep>
          <BetaStep
            number={2}
            title={`Board ${agencyLabel(trip.busLeg.agencyId)} ${trip.busLeg.routeName}`}
            trailing={selectedBusDeparture ? (
              <button type="button" className="beta-change-link" onClick={handleBusClear}>Change bus</button>
            ) : <span className="beta-select-note">Optional · select for exact Metro connections</span>}
          >
            <BetaBusLegSign
              trip={trip}
              departures={departures}
              predictionsLoading={predictionsLoading}
              selectedDeparture={selectedBusDeparture}
              selectedRow={selectedDepartureRow}
              onSelect={handleBusSelect}
            />
          </BetaStep>
          <BetaStep number={3} title={`Get off at ${trip.busLeg.alightStop.name} — walk to Metro`}>
            <BetaBusWalkSign
              fromLat={trip.busLeg.alightStop.lat}
              fromLon={trip.busLeg.alightStop.lon}
              toLat={trip.busLeg.nearestExitLat}
              toLon={trip.busLeg.nearestExitLon}
              minutes={trip.busLeg.alightWalkMinutes}
              meters={trip.busLeg.alightWalkMeters}
              destination={`${trip.busLeg.nearestExitName ?? stationNames.get(trip.metroFrom) ?? 'Metro'} entrance`}
              detail={`${trip.busLeg.alightStop.name} → ${stationNames.get(trip.metroFrom) ?? trip.metroFrom}`}
              fromLabel={trip.busLeg.alightStop.name}
              toLabel={`${stationNames.get(trip.metroFrom) ?? trip.metroFrom} ${trip.busLeg.nearestExitName ?? 'station entrance'}`}
            />
          </BetaStep>
          {renderMetro(3)}
          <BetaStep number={finalSummaryStep} title="Your complete trip at a glance">
            <BetaHybridGlance trip={trip} totalMinutes={totalMinutes} arrivalClock={arrivalClock} segments={breakdown} />
          </BetaStep>
        </>
      )}
      <div className="beta-data-note beta-hybrid-data-note">
        <Bus aria-hidden="true" /> Live bus predictions, schedules, walking distances, and Metro pathfinding are combined in this itinerary.
      </div>
    </div>
  )
}

function BetaBusLegSign({
  trip,
  departures,
  predictionsLoading,
  arrivalAtStopMin,
  selectedDeparture = null,
  selectedRow = null,
  onSelect,
}: {
  trip: HybridTrip
  departures: DisplayBusDeparture[]
  predictionsLoading: boolean
  arrivalAtStopMin?: number | null
  selectedDeparture?: SelectedBusDeparture | null
  selectedRow?: DisplayBusDeparture | null
  onSelect?: (departure: SelectedBusDeparture) => void
}) {
  const selectable = !!onSelect
  const [showAllDepartures, setShowAllDepartures] = useState(false)
  const allRows = selectedRow
    ? [selectedRow, ...departures.filter((row) => !selectedBusMatches(selectedDeparture, row))]
    : departures
  const rows = showAllDepartures ? allRows : allRows.slice(0, 4)
  const canToggleOtherDepartures = selectable && !!selectedDeparture && allRows.length > 4

  return (
    <div className="beta-sign beta-bus-sign" data-testid="bus-leg-panel" data-route-id={trip.busLeg.routeId}>
      <div className="beta-bus-sign-header">
        <span className="beta-bus-route-block"><Bus aria-hidden="true" /><b>{trip.busLeg.routeName}</b></span>
        <span>
          <strong>{agencyLabel(trip.busLeg.agencyId)} {trip.busLeg.routeName}</strong>
          <small>Toward {trip.busLeg.headsign || trip.busLeg.alightStop.name}</small>
        </span>
      </div>
      <div className="beta-bus-stop-line">
        <span className="is-board"><i /><small>Board</small><strong>{trip.busLeg.boardStop.name}</strong></span>
        <span className="beta-bus-stop-track" aria-hidden="true" />
        <span className="is-alight"><i /><small>Get off</small><strong>{trip.busLeg.alightStop.name}</strong></span>
        <em>{trip.busLeg.scheduledRideMinutes ?? trip.busLeg.estimatedRideMinutes} min ride</em>
      </div>
      <div className="beta-trains-heading">
        Next buses
        {arrivalAtStopMin != null && <span>after your estimated arrival</span>}
      </div>
      <div className="beta-bus-departure-list">
        {predictionsLoading ? (
          <div className="beta-bus-prediction-loading"><Loader2 /> Loading live departures…</div>
        ) : rows.length > 0 ? rows.map((departure, index) => (
          <BetaBusDepartureRow
            key={departure.key}
            trip={trip}
            departure={departure}
            selected={selectedBusMatches(selectedDeparture, departure)}
            best={!selectedDeparture && index === 0 && departure.waitTime != null}
            selectable={selectable}
            onSelect={onSelect}
          />
        )) : (
          <div className="beta-no-trains">No departures found after your estimated arrival</div>
        )}
      </div>
      {canToggleOtherDepartures && (
        <button
          type="button"
          className="beta-show-more beta-bus-show-more"
          onClick={() => setShowAllDepartures((value) => !value)}
          aria-expanded={showAllDepartures}
        >
          {showAllDepartures ? 'Hide other departures' : `Show ${allRows.length - 4} more departures`}
        </button>
      )}
    </div>
  )
}

function BetaBusDepartureRow({
  trip,
  departure,
  selected,
  best,
  selectable,
  onSelect,
}: {
  trip: HybridTrip
  departure: DisplayBusDeparture
  selected: boolean
  best: boolean
  selectable: boolean
  onSelect?: (departure: SelectedBusDeparture) => void
}) {
  const waitStatus = departure.waitTime == null
    ? null
    : departure.waitTime < 0
      ? `Tight connection · ${departure.waitTime} min wait`
      : `${best ? 'Best connection · ' : ''}${departure.waitTime} min wait`
  const content = (
    <>
      <span className="beta-bus-row-route">{trip.busLeg.routeName}</span>
      <span className="beta-bus-row-copy">
        <strong>{departure.direction}</strong>
        <small>
          {departure.source === 'live' ? <><Radio /> Live</> : <><Clock3 /> Scheduled</>}
          {departure.vehicleId ? ` · Vehicle ${departure.vehicleId}` : ''}
          {waitStatus ? ` · ${waitStatus}` : ''}
          {` · Arr ${departure.arrivalClock}`}
        </small>
      </span>
      {selected && <span className="beta-bus-your-bus">Your bus</span>}
      <span className="beta-min-box">
        {departure.minutes <= 0 ? 'ARR' : departure.minutes}
        {departure.minutes > 0 && <small>min</small>}
      </span>
      {selected && <Check className="beta-row-check" aria-hidden="true" />}
    </>
  )

  if (!selectable) {
    return (
      <div
        className={`beta-bus-row ${best ? 'is-best' : ''}`}
        data-testid="bus-departure-option"
        data-source={departure.source === 'live' ? 'realtime' : 'scheduled'}
      >
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      className={`beta-bus-row ${selected ? 'is-selected' : ''} ${best ? 'is-best' : ''}`}
      data-testid={selected ? 'bus-departure-selected' : 'bus-departure-option'}
      data-source={departure.source === 'live' ? 'realtime' : 'scheduled'}
      aria-pressed={selected}
      onClick={() => onSelect?.({
        minutesFromNow: departure.minutes,
        isRealTime: departure.source === 'live',
        vehicleId: departure.vehicleId,
        clockTime: departure.clockTime,
      })}
    >
      {content}
    </button>
  )
}

function BetaBusWalkSign({
  fromLat,
  fromLon,
  toLat,
  toLon,
  minutes,
  meters,
  destination,
  detail,
  fromLabel,
  toLabel,
}: {
  fromLat?: number
  fromLon?: number
  toLat?: number
  toLon?: number
  minutes: number
  meters: number
  destination: string
  detail: string
  fromLabel?: string
  toLabel?: string
}) {
  const hasFrom = fromLat != null && fromLon != null
  const hasTo = toLat != null && toLon != null
  const originValue = hasFrom
    ? `${fromLat},${fromLon}`
    : fromLabel ? encodeURIComponent(fromLabel) : null
  const destinationValue = hasTo
    ? `${toLat},${toLon}`
    : toLabel ? encodeURIComponent(toLabel) : null
  const mapsUrl = destinationValue
    ? `https://www.google.com/maps/dir/?api=1${originValue ? `&origin=${originValue}` : ''}&destination=${destinationValue}&travelmode=walking`
    : null

  return (
    <div className="beta-sign beta-direction-sign beta-bus-walk-sign">
      <span className="beta-helper-tile"><Footprints aria-hidden="true" /></span>
      <span className="beta-direction-copy">
        <strong>{destination}</strong>
        <small>{minutes} min walk · {formatDistance(meters)} · {detail}</small>
      </span>
      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="beta-maps-link">
          Maps <ExternalLink aria-hidden="true" />
        </a>
      )}
      <ArrowUp className="beta-direction-arrow" aria-hidden="true" />
    </div>
  )
}

function buildBreakdown({
  metroFirst,
  originWalk,
  metroWait,
  directRide,
  leg1Ride,
  transferWalk,
  leg2Wait,
  leg2Ride,
  walkToBus,
  busWait,
  busRide,
  walkFromBus,
  destWalk,
}: {
  metroFirst: boolean
  originWalk: number
  metroWait: number | null
  directRide: number | null
  leg1Ride: number | null
  transferWalk: number | null
  leg2Wait: number | null
  leg2Ride: number | null
  walkToBus: number
  busWait: number
  busRide: number
  walkFromBus: number
  destWalk: number
}): Array<{ label: string; minutes: number | null; icon: ReactNode }> {
  const metroSegments = directRide != null
    ? [{ label: 'Metro ride', minutes: directRide, icon: <TrainFront /> }]
    : [
        { label: 'Metro leg 1', minutes: leg1Ride, icon: <TrainFront /> },
        { label: 'Transfer walk', minutes: transferWalk, icon: <Footprints /> },
        { label: 'Transfer wait', minutes: leg2Wait, icon: <Clock3 /> },
        { label: 'Metro leg 2', minutes: leg2Ride, icon: <TrainFront /> },
      ]
  const busSegments = [
    { label: 'Walk to bus', minutes: walkToBus, icon: <Footprints /> },
    { label: 'Bus wait', minutes: busWait, icon: <Clock3 /> },
    { label: 'Bus ride', minutes: busRide, icon: <Bus /> },
    { label: 'Walk after bus', minutes: walkFromBus, icon: <Footprints /> },
  ]
  return metroFirst
    ? [
        ...(originWalk > 0 ? [{ label: 'Walk to Metro', minutes: originWalk, icon: <Footprints /> }] : []),
        { label: 'Metro wait', minutes: metroWait, icon: <Clock3 /> },
        ...metroSegments,
        ...busSegments,
      ]
    : [
        ...busSegments,
        { label: 'Metro wait', minutes: metroWait, icon: <Clock3 /> },
        ...metroSegments,
        ...(destWalk > 0 ? [{ label: 'Final walk', minutes: destWalk, icon: <Footprints /> }] : []),
      ]
}

function BetaHybridGlance({
  trip,
  totalMinutes,
  arrivalClock,
  segments,
}: {
  trip: HybridTrip
  totalMinutes: number
  arrivalClock: string
  segments: Array<{ label: string; minutes: number | null; icon: ReactNode }>
}) {
  return (
    <div className="beta-sign beta-hybrid-glance">
      <div className="beta-hybrid-glance-head">
        <span>
          {trip.pattern === 'metro-bus' ? <><TrainFront /><ArrowRight /><Bus /></> : <><Bus /><ArrowRight /><TrainFront /></>}
          <strong>{agencyLabel(trip.busLeg.agencyId)} {trip.busLeg.routeName}</strong>
        </span>
        <span><b>{totalMinutes}</b> min · Arr {arrivalClock}</span>
      </div>
      <div className="beta-hybrid-breakdown">
        {segments.map((segment, index) => (
          <span key={`${segment.label}-${index}`}>
            <i>{segment.icon}</i>
            <small>{segment.label}</small>
            <strong>{segment.minutes == null ? '—' : `${Math.round(segment.minutes)} min`}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}
