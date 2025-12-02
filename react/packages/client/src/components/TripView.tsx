import { useCallback } from 'react'
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
  onClearLeg1Selection?: () => void // NEW PROP
  isLoadingLeg2?: boolean
  selectedLeg1Train?: Train | null
  departureTimestamp?: number | null
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
  onClearLeg1Selection, // Destructure it
  isLoadingLeg2,
  selectedLeg1Train,
  departureTimestamp
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
  const isDirect = transfer?.direct ?? false
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

    if (minUntilDeparture > 0) {
      // Train hasn't departed yet - countdown based on recorded departure time
      currentMin = minUntilDeparture
      displayTrain = { ...liveTrain, Min: minUntilDeparture }
      customStatus = `Departs ${originName} in ${minUntilDeparture} min`
    } else if (minUntilDeparture >= -1) {
      // Train is arriving or boarding - check actual live status
      currentMin = 0
      const isArriving = liveTrain.Min === 'ARR'
      displayTrain = { ...liveTrain, Min: isArriving ? 'ARR' : 'BRD' }
      customStatus = isArriving ? `Arriving at ${originName}` : `Boarding at ${originName}`
    } else {
      // Train has departed - use real-time arrival at destination if available
      // Parse _destArrivalTime to get accurate minutes from now (avoid drift from backend-calculated _destArrivalMin)
      let minutesRemaining: number
      if (liveTrain._destArrivalTime) {
        // Parse clock time like "8:57 PM" to calculate minutes from now
        const arrivalDate = new Date()
        const match = liveTrain._destArrivalTime.match(/(\d+):(\d+)\s*(AM|PM)/i)
        if (match) {
          let hours = parseInt(match[1])
          const minutes = parseInt(match[2])
          const isPM = match[3].toUpperCase() === 'PM'
          if (isPM && hours !== 12) hours += 12
          if (!isPM && hours === 12) hours = 0
          arrivalDate.setHours(hours, minutes, 0, 0)
          // Handle day rollover
          if (arrivalDate < new Date()) {
            arrivalDate.setDate(arrivalDate.getDate() + 1)
          }
          minutesRemaining = Math.round((arrivalDate.getTime() - Date.now()) / 60000)
        } else {
          minutesRemaining = liveTrain._destArrivalMin ?? Math.max(0, leg1Time + minUntilDeparture)
        }
      } else {
        minutesRemaining = liveTrain._destArrivalMin ?? Math.max(0, leg1Time + minUntilDeparture)
      }
      currentMin = -Math.abs(minUntilDeparture)
      displayTrain = { ...liveTrain, Min: minutesRemaining <= 0 ? 'ARR' : minutesRemaining }
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
            onClearSelection={onClearLeg1Selection} // Pass it here
            selectedNumCars={selectedNumCars}
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