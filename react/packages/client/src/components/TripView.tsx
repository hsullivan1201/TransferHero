import { useState, useCallback } from 'react'
import type { Train, CatchableTrain, TransferResult, CarPosition } from '@transferhero/shared'
import { LegPanel } from './LegPanel'
import { JourneyInfo } from './JourneyInfo'
import { getTrainMinutes } from '../utils/time'

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
  isLoadingLeg2?: boolean
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
  isLoadingLeg2
}: TripViewProps) {
  const [selectedLeg1Index, setSelectedLeg1Index] = useState<number | undefined>(undefined)

  const selectedLeg1Train = selectedLeg1Index !== undefined ? leg1Trains[selectedLeg1Index] : undefined
  const selectedNumCars = selectedLeg1Train ? parseInt(selectedLeg1Train.Car || '8', 10) : undefined
  const selectedTrainMin = selectedLeg1Train ? getTrainMinutes(selectedLeg1Train.Min) : undefined

  // Calculate arrival time for journey info
  const arrivalTime = selectedLeg1Train && leg2Trains.length > 0 && leg2Trains[0]._canCatch
    ? leg2Trains[0]._arrivalClock
    : undefined

  const handleLeg1Select = useCallback((train: Train, index: number) => {
    setSelectedLeg1Index(index)
    onSelectLeg1Train(train, index)
  }, [onSelectLeg1Train])

  const isDirect = transfer?.direct ?? false

  return (
    <div className="animate-fade-in">
      {/* Main layout - horizontal on desktop: Leg1 | JourneyInfo | Leg2 */}
      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        {/* Leg 1 Panel */}
        <div className="lg:flex-[2] min-w-0">
          <LegPanel
            leg={1}
            title={`Leg 1: ${originName}`}
            subtitle={isDirect ? `To ${destinationName}` : `To ${transferName}`}
            trains={leg1Trains}
            carPosition={leg1CarPosition}
            selectedTrainIndex={selectedLeg1Index}
            onTrainSelect={handleLeg1Select}
            selectedNumCars={selectedNumCars}
          />
        </div>

        {/* Journey Info (center column on desktop) */}
        {!isDirect && (
          <div className="hidden lg:flex shrink-0 lg:w-64">
            <JourneyInfo
              leg1Time={leg1Time}
              transferTime={walkTime}
              leg2Time={leg2Time}
              selectedTrainMin={selectedTrainMin}
              arrivalTime={arrivalTime}
            />
          </div>
        )}

        {/* Leg 2 Panel */}
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

      {/* Journey Info (below panels on mobile/tablet) */}
      {!isDirect && (
        <div className="lg:hidden mt-4">
          <JourneyInfo
            leg1Time={leg1Time}
            transferTime={walkTime}
            leg2Time={leg2Time}
            selectedTrainMin={selectedTrainMin}
            arrivalTime={arrivalTime}
          />
        </div>
      )}
    </div>
  )
}
