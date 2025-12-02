import { useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Train, CatchableTrain, TransferResult, CarPosition } from '@transferhero/shared'
import { LegPanel } from './LegPanel'
import { JourneyInfo } from './JourneyInfo'

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

  // Logic for displayTrain calculation and status
  // Find the live version of the selected train from refreshed data
  // ONLY match by exact tripId - Line+Destination matching is unreliable and causes wrong train bugs
  const liveTrain = selectedLeg1Train
    ? (selectedLeg1Train._tripId
        ? leg1Trains.find(t => t._tripId === selectedLeg1Train._tripId)
        : undefined
      ) || selectedLeg1Train
    : null

  let displayTrain = liveTrain
  let currentMin: number | undefined = undefined
  let customStatus: string | undefined = undefined

  // Determine target name (transfer station or destination for direct trips)
  const targetName = isDirect ? destinationName : transferName

  // Build arrival time suffix if real-time data available (use live train data)
  const arrivalTimeSuffix = liveTrain?._destArrivalTime
    ? ` · Arr ${liveTrain._destArrivalTime}`
    : ''

  if (liveTrain && departureTimestamp) {
    const now = Date.now()
    // Use departureTimestamp as source of truth (not liveMin which might be from wrong train)
    const msUntilDeparture = departureTimestamp - now
    const minUntilDeparture = Math.round(msUntilDeparture / 60000)

    // Handle departed trains selected from "Already on a train?" section
    if (liveTrain._departed && liveTrain._transferArrivalTimestamp) {
      // Departed train - show countdown to transfer station (same format as regular trains)
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
      // Train hasn't departed yet - countdown based on recorded departure time
      currentMin = minUntilDeparture
      // Pass departureTimestamp for precise seconds display when <2min
      displayTrain = {
        ...liveTrain,
        Min: minUntilDeparture,
        _destArrivalTimestamp: departureTimestamp // Use departure time for origin countdown
      }
      customStatus = `Departs ${originName} in ${minUntilDeparture} min`
    } else if (minUntilDeparture >= -1) {
      // Train is arriving or boarding
      currentMin = 0

      // Smart departure detection: use transfer arrival to calculate expected departure
      let hasActuallyDeparted = false
      if (liveTrain._transferArrivalTimestamp && leg1Time) {
        const expectedDepartureTime = liveTrain._transferArrivalTimestamp - (leg1Time * 60 * 1000)
        hasActuallyDeparted = Date.now() >= expectedDepartureTime
      }

      if (hasActuallyDeparted) {
        // Train has departed based on transfer arrival math
        // Calculate time to transfer station
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
        // Still boarding at origin
        const isArriving = liveTrain.Min === 'ARR'
        displayTrain = { ...liveTrain, Min: isArriving ? 'ARR' : 'BRD' }
        customStatus = isArriving ? `Arriving at ${originName}` : `Boarding at ${originName}`
      }
    } else {
      // Train has departed - use real-time arrival at destination if available
      // Use exact timestamp for most accurate calculation
      let minutesRemaining: number
      if (liveTrain._destArrivalTimestamp) {
        // Most accurate: use exact arrival timestamp from backend
        minutesRemaining = Math.floor((liveTrain._destArrivalTimestamp - Date.now()) / 60000)
      } else {
        // Fallback to other methods if timestamp not available
        minutesRemaining = liveTrain._destArrivalMin ?? Math.max(0, leg1Time + minUntilDeparture)
      }
      currentMin = -Math.abs(minUntilDeparture)
      // Preserve timestamp for TrainCard to show seconds when <2min
      displayTrain = {
        ...liveTrain,
        Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining,
        _destArrivalTimestamp: liveTrain._destArrivalTimestamp // Pass through for precise display
      }
      customStatus = minutesRemaining <= 0 ? `Arrived at ${targetName}` : `En Route to ${targetName}${arrivalTimeSuffix}`
    }
  } else if (liveTrain) {
    // Train selected but departure not yet tracked - use live Min for display
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

  return (
    <div className="animate-fade-in">
      {/* Refresh Button */}
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
        
        {/* ... [Rest of JSX remains the same] ... */}
        {!isDirect && (
          <div className="hidden lg:flex shrink-0 lg:w-64">
            <JourneyInfo
              leg1Time={leg1Time}
              transferTime={walkTime}
              leg2Time={leg2Time}
              selectedTrainMin={currentMin}
              arrivalTime={arrivalTime}
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
            selectedTrainMin={currentMin}
            arrivalTime={arrivalTime}
          />
        </div>
      )}
    </div>
  )
}