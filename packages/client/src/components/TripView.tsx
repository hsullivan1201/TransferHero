import { useCallback, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Train, CatchableTrain, TransferResult, CarPosition, PlaceContext } from '@transferhero/shared'
import { LegPanel } from './LegPanel'
import { JourneyInfo } from './JourneyInfo'
import { WalkingCard } from './WalkingCard'
import { deriveWaitMinutes, computeTotalMinutes, resolveArrivalClock } from '../utils/time'
import { resolveExitLabel } from '../data/exitMapping'

type WalkingAlt = NonNullable<PlaceContext['alternatives']>[number]

interface TripViewProps {
  transfer: TransferResult | null
  leg1Trains: Train[]
  leg2Trains: CatchableTrain[]
  leg1CarPosition: CarPosition | null
  leg2CarPosition: CarPosition | null
  leg1Time: number
  leg2Time: number
  walkTime: number
  originName: string
  destinationName: string
  transferName: string
  onSelectLeg1Train: (train: Train, index: number) => void
  onClearLeg1Selection?: () => void
  isLoadingLeg2?: boolean
  selectedLeg1Train?: Train | null
  departureTimestamp?: number | null
  onRefresh?: () => void
  isRefreshing?: boolean
  isDirect?: boolean
  showDeparted?: boolean
  onToggleShowDeparted?: () => void
  originPlaceContext?: PlaceContext | null
  destPlaceContext?: PlaceContext | null
  onSelectOriginWalkingAlt?: (alt: WalkingAlt) => void
  onSelectDestWalkingAlt?: (alt: WalkingAlt) => void
}

export function TripView({
  transfer,
  leg1Trains,
  leg2Trains,
  leg1CarPosition,
  leg2CarPosition,
  leg1Time,
  leg2Time,
  walkTime,
  originName,
  destinationName,
  transferName,
  onSelectLeg1Train,
  onClearLeg1Selection,
  isLoadingLeg2,
  selectedLeg1Train,
  departureTimestamp,
  onRefresh,
  isRefreshing,
  isDirect = false,
  showDeparted = false,
  onToggleShowDeparted,
  originPlaceContext,
  destPlaceContext,
  onSelectOriginWalkingAlt,
  onSelectDestWalkingAlt,
}: TripViewProps) {

  // memoize the heavy display-train computation — re-evaluates when
  // train data, selection, or timing deps change (including 30s refetch)
  const { displayTrain, customStatus, selectedNumCars } = useMemo(() => {
    // pick a live copy of the selected train
    // match only by exact tripId—line+destination roulette gave us ghost trains
    const liveTrain = selectedLeg1Train
      ? (selectedLeg1Train._tripId
          ? leg1Trains.find(t => t._tripId === selectedLeg1Train._tripId)
          : undefined
        ) || selectedLeg1Train
      : null

    let _displayTrain = liveTrain
    let _customStatus: string | undefined = undefined

    // decide if we're talking to the transfer stop or the final stop
    const targetName = isDirect ? destinationName : transferName

    // tack on an arrival suffix if realtime feels generous
    const arrivalTimeSuffix = liveTrain?._destArrivalTime
      ? ` · Arr ${liveTrain._destArrivalTime}`
      : ''

    if (liveTrain && departureTimestamp) {
      const now = Date.now()
      // trust the saved departure time; live min sometimes fibs
      const msUntilDeparture = departureTimestamp - now
      const minUntilDeparture = Math.round(msUntilDeparture / 60000)

      // if the user picked an already-gone train from "already on a train?"
      if (liveTrain._departed && liveTrain._transferArrivalTimestamp) {
        // departed train: countdown to the transfer like any other
        const minutesRemaining = Math.floor((liveTrain._transferArrivalTimestamp - now) / 60000)

        _displayTrain = {
          ...liveTrain,
          Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining,
          _destArrivalTimestamp: liveTrain._transferArrivalTimestamp
        }

        _customStatus = minutesRemaining <= 0
          ? `Arrived at ${transferName || targetName}`
          : `En Route to ${transferName || targetName} · Arr ${liveTrain._transferArrivalTime || ''}`
      } else if (minUntilDeparture > 0) {
        // not left yet: countdown from the timestamp we recorded
        // hand off the timestamp so seconds view can be crisp
        _displayTrain = {
          ...liveTrain,
          Min: minUntilDeparture,
          _destArrivalTimestamp: departureTimestamp // use the timestamp for the origin clock
        }
        _customStatus = `Departs ${originName} in ${minUntilDeparture} min`
      } else if (minUntilDeparture >= -1) {
        // living in the arr/brd limbo

        // sanity check: back-calc departure from transfer arrival
        let hasActuallyDeparted = false
        if (liveTrain._transferArrivalTimestamp && leg1Time) {
          const expectedDepartureTime = liveTrain._transferArrivalTimestamp - (leg1Time * 60 * 1000)
          hasActuallyDeparted = Date.now() >= expectedDepartureTime
        }

        if (hasActuallyDeparted) {
          // seems like it left based on the math—countdown to transfer
          let minutesRemaining: number
          if (liveTrain._transferArrivalTimestamp) {
            minutesRemaining = Math.floor((liveTrain._transferArrivalTimestamp - Date.now()) / 60000)
          } else {
            minutesRemaining = Math.max(0, leg1Time + minUntilDeparture)
          }

          _displayTrain = {
            ...liveTrain,
            Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining,
            _destArrivalTimestamp: liveTrain._transferArrivalTimestamp
          }
          _customStatus = minutesRemaining <= 0
            ? `Arrived at ${transferName || targetName}`
            : `En Route to ${transferName || targetName} · Arr ${liveTrain._transferArrivalTime || ''}`
        } else {
          // still loitering at the origin
          const isArriving = liveTrain.Min === 'ARR'
          _displayTrain = { ...liveTrain, Min: isArriving ? 'ARR' : 'BRD' }
          _customStatus = isArriving ? `Arriving at ${originName}` : `Boarding at ${originName}`
        }
      } else {
        // already departed: lean on destination realtime if we have it
        // use timestamps when possible; they're less dramatic than mins
        let minutesRemaining: number
        if (liveTrain._destArrivalTimestamp) {
          // best case: backend handed us an exact arrival
          minutesRemaining = Math.floor((liveTrain._destArrivalTimestamp - Date.now()) / 60000)
        } else {
          // otherwise, use whatever fallback math we have
          minutesRemaining = liveTrain._destArrivalMin ?? Math.max(0, leg1Time + minUntilDeparture)
        }
        // keep the timestamp so TrainCard can flex seconds view
        _displayTrain = {
          ...liveTrain,
          Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining,
          _destArrivalTimestamp: liveTrain._destArrivalTimestamp // pass it through for precise display
        }
        _customStatus = minutesRemaining <= 0 ? `Arrived at ${targetName}` : `En Route to ${targetName}${arrivalTimeSuffix}`
      }
    } else if (liveTrain) {
      // selected train but no timestamp yet? lean on live min
      const liveMin = typeof liveTrain.Min === 'number'
        ? liveTrain.Min
        : liveTrain.Min === 'ARR' || liveTrain.Min === 'BRD'
          ? 0
          : parseInt(liveTrain.Min, 10) || 0

      if (liveMin > 0) {
        _customStatus = `Departs ${originName} in ${liveMin} min`
      } else if (liveTrain.Min === 'ARR') {
        _customStatus = `Arriving at ${originName}`
      } else {
        _customStatus = `Boarding at ${originName}`
      }
    }

    const _selectedNumCars = selectedLeg1Train ? parseInt(selectedLeg1Train.Car || '8', 10) : undefined

    return { displayTrain: _displayTrain, customStatus: _customStatus, selectedNumCars: _selectedNumCars }
  }, [selectedLeg1Train, leg1Trains, departureTimestamp, isDirect, originName, destinationName, transferName, leg1Time])

  const arrivalTime = selectedLeg1Train && leg2Trains.length > 0 && leg2Trains[0]._canCatch
    ? leg2Trains[0]._arrivalClock
    : undefined

  const waitMinutes = deriveWaitMinutes(displayTrain, departureTimestamp)
  const firstMileWalk = originPlaceContext?.walkTimeMinutes ?? 0
  const lastMileWalk = destPlaceContext?.walkTimeMinutes ?? 0
  const totalMinutes = computeTotalMinutes([firstMileWalk, waitMinutes, leg1Time, walkTime, leg2Time, lastMileWalk])
  const arrivalClock = resolveArrivalClock(totalMinutes, arrivalTime)

  const destExitLabel = destPlaceContext?.exit.name && destPlaceContext?.station.code
    ? resolveExitLabel(destPlaceContext.station.code, destPlaceContext.exit.name)
    : undefined

  return (
    <div className="animate-fade-in">
      {/* Walking card for origin (place → station) */}
      {originPlaceContext && (
        <div className="mb-4">
          <WalkingCard context={originPlaceContext} onSelectAlternative={onSelectOriginWalkingAlt} />
        </div>
      )}

      {/* refresh button, aka the "did it change yet?" switch */}
      {onRefresh && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium">
              {isRefreshing ? 'Refreshing...' : 'Refresh Trains'}
            </span>
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        <div className="lg:flex-[2] min-w-0">
          <LegPanel
            leg={1}
            title={`Leg 1: ${originName}`}
            subtitle={isDirect ? `To ${destinationName}` : `To ${transferName}`}
            trains={leg1Trains}
            carPosition={leg1CarPosition}
            selectedTrain={displayTrain}
            customStatus={customStatus}
            onTrainSelect={onSelectLeg1Train}
            onClearSelection={onClearLeg1Selection}
            selectedNumCars={selectedNumCars}
            isDirect={isDirect}
            showDeparted={showDeparted}
            onToggleShowDeparted={onToggleShowDeparted}
            destinationExitName={isDirect ? destPlaceContext?.exit.name : undefined}
            destinationExitLabel={isDirect ? destExitLabel : undefined}
          />
        </div>
        
        {/* rest of the layout stays boringly unchanged */}
        {!isDirect && (
          <div className="hidden lg:flex shrink-0 lg:w-64">
            <JourneyInfo
              leg1Time={leg1Time}
              transferTime={walkTime}
              leg2Time={leg2Time}
              waitMinutes={waitMinutes}
              totalMinutes={totalMinutes}
              arrivalClock={arrivalClock ?? undefined}
              firstMileWalkMinutes={firstMileWalk || undefined}
              lastMileWalkMinutes={lastMileWalk || undefined}
            />
          </div>
        )}

        {!isDirect && (
          <div className="lg:flex-[2] min-w-0">
            <LegPanel
              leg={2}
              title={`Leg 2: ${transferName}`}
              subtitle={`To ${destinationName}`}
              trains={leg2Trains}
              carPosition={leg2CarPosition}
              selectedNumCars={selectedNumCars}
              isLoading={isLoadingLeg2}
              destinationExitName={destPlaceContext?.exit.name}
              destinationExitLabel={destExitLabel}
            />
          </div>
        )}
      </div>

      {/* Walking card for destination (station → place) */}
      {destPlaceContext && (
        <div className="mt-4">
          <WalkingCard context={destPlaceContext} onSelectAlternative={onSelectDestWalkingAlt} />
        </div>
      )}

      {!isDirect && (
        <div className="lg:hidden mt-4">
          <JourneyInfo
            leg1Time={leg1Time}
            transferTime={walkTime}
            leg2Time={leg2Time}
            waitMinutes={waitMinutes}
            totalMinutes={totalMinutes}
            arrivalClock={arrivalClock ?? undefined}
            firstMileWalkMinutes={firstMileWalk || undefined}
            lastMileWalkMinutes={lastMileWalk || undefined}
          />
        </div>
      )}
    </div>
  )
}