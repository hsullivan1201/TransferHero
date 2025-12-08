import { useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Train, CatchableTrain, TransferResult, CarPosition } from '@transferhero/shared'
import { LegPanel } from './LegPanel'
import { JourneyInfo } from './JourneyInfo'
import { deriveWaitMinutes, computeTotalMinutes, resolveArrivalClock } from '../utils/time'

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
  onToggleShowDeparted
}: TripViewProps) {

  // displayTrain brain dump: pick a live copy of the selected train
  // match only by exact tripId—line+destination roulette gave us ghost trains
  const liveTrain = selectedLeg1Train
    ? (selectedLeg1Train._tripId
        ? leg1Trains.find(t => t._tripId === selectedLeg1Train._tripId)
        : undefined
      ) || selectedLeg1Train
    : null

  let displayTrain = liveTrain
  let currentMin: number | undefined = undefined
  let customStatus: string | undefined = undefined

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
      currentMin = minutesRemaining
      
      displayTrain = {
        ...liveTrain,
        Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining,
        _destArrivalTimestamp: liveTrain._transferArrivalTimestamp
      }
      
      customStatus = minutesRemaining <= 0
        ? `Arrived at ${transferName || targetName}`
        : `En Route to ${transferName || targetName} · Arr ${liveTrain._transferArrivalTime || ''}`
    } else if (minUntilDeparture > 0) {
      // not left yet: countdown from the timestamp we recorded
      currentMin = minUntilDeparture
      // hand off the timestamp so seconds view can be crisp
      displayTrain = {
        ...liveTrain,
        Min: minUntilDeparture,
        _destArrivalTimestamp: departureTimestamp // use the timestamp for the origin clock
      }
      customStatus = `Departs ${originName} in ${minUntilDeparture} min`
    } else if (minUntilDeparture >= -1) {
      // living in the arr/brd limbo
      currentMin = 0

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

        displayTrain = {
          ...liveTrain,
          Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining,
          _destArrivalTimestamp: liveTrain._transferArrivalTimestamp
        }
        customStatus = minutesRemaining <= 0
          ? `Arrived at ${transferName || targetName}`
          : `En Route to ${transferName || targetName} · Arr ${liveTrain._transferArrivalTime || ''}`
      } else {
        // still loitering at the origin
        const isArriving = liveTrain.Min === 'ARR'
        displayTrain = { ...liveTrain, Min: isArriving ? 'ARR' : 'BRD' }
        customStatus = isArriving ? `Arriving at ${originName}` : `Boarding at ${originName}`
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
      currentMin = -Math.abs(minUntilDeparture)
      // keep the timestamp so TrainCard can flex seconds view
      displayTrain = {
        ...liveTrain,
        Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining,
        _destArrivalTimestamp: liveTrain._destArrivalTimestamp // pass it through for precise display
      }
      customStatus = minutesRemaining <= 0 ? `Arrived at ${targetName}` : `En Route to ${targetName}${arrivalTimeSuffix}`
    }
  } else if (liveTrain) {
    // selected train but no timestamp yet? lean on live min
    const liveMin = typeof liveTrain.Min === 'number'
      ? liveTrain.Min
      : liveTrain.Min === 'ARR' || liveTrain.Min === 'BRD'
        ? 0
        : parseInt(liveTrain.Min, 10) || 0

    if (liveMin > 0) {
      customStatus = `Departs ${originName} in ${liveMin} min`
    } else if (liveTrain.Min === 'ARR') {
      customStatus = `Arriving at ${originName}`
    } else {
      customStatus = `Boarding at ${originName}`
    }
  }

  const selectedNumCars = selectedLeg1Train ? parseInt(selectedLeg1Train.Car || '8', 10) : undefined

  const arrivalTime = selectedLeg1Train && leg2Trains.length > 0 && leg2Trains[0]._canCatch
    ? leg2Trains[0]._arrivalClock
    : undefined

  const waitMinutes = deriveWaitMinutes(liveTrain, departureTimestamp)
  const totalMinutes = computeTotalMinutes([waitMinutes, leg1Time, walkTime, leg2Time])
  const arrivalClock = resolveArrivalClock(totalMinutes, arrivalTime)

  return (
    <div className="animate-fade-in">
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
            />
          </div>
        )}
      </div>

      {!isDirect && (
        <div className="lg:hidden mt-4">
          <JourneyInfo
            leg1Time={leg1Time}
            transferTime={walkTime}
            leg2Time={leg2Time}
            waitMinutes={waitMinutes}
            totalMinutes={totalMinutes}
            arrivalClock={arrivalClock ?? undefined}
          />
        </div>
      )}
    </div>
  )
}