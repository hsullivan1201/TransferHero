import { useMemo, useCallback, useState } from 'react'
import { Bus, Footprints, RefreshCw, ExternalLink, Rss } from 'lucide-react'
import type { HybridTrip, Train, PlaceContext, BusStop } from '@transferhero/shared'
import { LegPanel } from './LegPanel'
import { WalkingCard } from './WalkingCard'
import { formatDistance } from '../utils/geo'
import { useTrip, useLeg2 } from '../hooks/useTrip'
import { getTrainMinutes, minutesToClockTime } from '../utils/time'

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

  // Fetch real Metro trip data for the metro portion
  const {
    data: metroTripData,
    isLoading: metroLoading,
    refetch: refetchMetro,
  } = useTrip(trip.metroFrom, trip.metroTo, walkTime, null, accessible)

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
    if (!selectedTrain || !metroTripData?.trip.leg1.trains) return null
    if (selectedTrain._tripId) {
      return metroTripData.trip.leg1.trains.find(t => t._tripId === selectedTrain._tripId) || selectedTrain
    }
    return selectedTrain
  }, [selectedTrain, metroTripData])

  const isDirect = metroTripData?.trip.isDirect ?? false
  const transfer = metroTripData?.trip.transfer ?? null
  const transferName = transfer?.name ?? ''

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
  })

  const metroTrains = metroTripData?.trip.leg1.trains ?? []
  const leg1CarPosition = metroTripData?.trip.leg1.carPosition ?? null
  const leg2Trains = leg2Data?.trains ?? metroTripData?.trip.leg2?.trains ?? []
  const leg2CarPosition = metroTripData?.trip.leg2?.carPosition ?? null

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
            stop={busLeg.boardStop}
            walkMinutes={busLeg.boardWalkMinutes}
            walkMeters={busLeg.boardWalkMeters}
            label="Walk to Bus Stop"
            sublabel={`${originPlaceContext?.place.name || 'Your location'} → ${busLeg.boardStop.name}`}
          />
          <BusLegPanel busLeg={busLeg} isFirst={true} />
          <BusWalkCard
            stop={busLeg.alightStop}
            walkMinutes={busLeg.alightWalkMinutes}
            walkMeters={busLeg.alightWalkMeters}
            label="Walk to Metro"
            sublabel={`${busLeg.alightStop.name} → ${fromName}`}
          />
        </>
      )}

      {/* Refresh button */}
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={() => { refetchMetro(); if (!isDirect) refetchLeg2() }}
          disabled={metroLoading || leg2Loading}
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
        selectedTrain={displayTrain}
        onTrainSelect={handleTrainSelect}
        onClearSelection={handleClearSelection}
        isDirect={isDirect}
        destinationExitName={isDirect ? busLeg.nearestExitName : undefined}
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
          destinationExitName={busLeg.nearestExitName}
          selectedTrain={isMetroBus ? displayLeg2Train : undefined}
          onTrainSelect={isMetroBus ? handleLeg2Select : undefined}
          onClearSelection={isMetroBus ? handleLeg2Clear : undefined}
        />
      )}

      {/* For metro-bus: walk from Metro exit to bus stop, then bus leg */}
      {isMetroBus && (
        <>
          <BusWalkCard
            stop={busLeg.boardStop}
            walkMinutes={busLeg.boardWalkMinutes}
            walkMeters={busLeg.boardWalkMeters}
            label="Walk to Bus Stop"
            sublabel={`${toName} exit → ${busLeg.boardStop.name}`}
          />
          <BusLegPanel busLeg={busLeg} isFirst={false} arrivalAtBusStopMin={arrivalAtBusStopMin} />
          <BusWalkCard
            stop={busLeg.alightStop}
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
    </div>
  )
}

/** Walking card between Metro station and bus stop */
function BusWalkCard({ stop, walkMinutes, walkMeters, label, sublabel }: {
  stop: BusStop
  walkMinutes: number
  walkMeters: number
  label: string
  sublabel: string
}) {
  // Open walking directions to the bus stop from current location
  const mapsUrl = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? `maps://maps.apple.com/?daddr=${stop.lat},${stop.lon}&dirflg=w`
    : `https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lon}&travelmode=walking`

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
function BusLegPanel({ busLeg, isFirst, arrivalAtBusStopMin }: {
  busLeg: HybridTrip['busLeg']
  isFirst: boolean
  arrivalAtBusStopMin?: number | null
}) {
  // Filter & annotate predictions when we know the user's arrival time
  const filteredPredictions = useMemo(() => {
    const annotate = (p: typeof busLeg.predictions[number], waitTime: number | null) => ({
      ...p,
      waitTime,
      clockTime: minutesToClockTime(p.minutes),
    })
    if (arrivalAtBusStopMin == null) {
      return busLeg.predictions.map(p => annotate(p, null))
    }
    return busLeg.predictions
      .filter(p => p.minutes >= arrivalAtBusStopMin - 1) // 1-min grace period
      .map(p => annotate(p, Math.max(0, Math.round(p.minutes - arrivalAtBusStopMin))))
  }, [busLeg.predictions, arrivalAtBusStopMin])

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
          ~{busLeg.estimatedRideMinutes} min ride
        </div>

        {/* Real-time predictions */}
        {busLeg.predictions.length > 0 ? (
          <div>
            <div className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
              Next Buses
            </div>
            {filteredPredictions.length > 0 ? (
              <div className="space-y-2">
                {filteredPredictions.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#0f9b8e] flex items-center justify-center">
                        <span className="text-white text-xs font-bold">{busLeg.routeName}</span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                          {p.directionText}
                          <Rss className="w-3.5 h-3.5 text-[#0f9b8e]" aria-label="Live prediction" />
                        </div>
                        {p.waitTime != null ? (
                          <div className="text-xs text-[#0f9b8e]">
                            {p.waitTime === 0 ? 'Bus waiting' : `${p.waitTime} min wait`}
                          </div>
                        ) : p.vehicleId ? (
                          <div className="text-xs text-[var(--text-secondary)]">Vehicle {p.vehicleId}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-[#0f9b8e]">
                        {p.minutes === 0 ? 'ARR' : `${p.minutes} min`}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)]">
                        {p.minutes === 0 ? 'now' : p.clockTime}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-sm text-[var(--text-secondary)]">
                No buses after your arrival — check back shortly
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-sm text-[var(--text-secondary)]">
            <span className="px-2 py-1 rounded bg-[var(--bg-tertiary)] text-xs">Scheduled</span>
            <span className="ml-2">No live predictions available</span>
          </div>
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
