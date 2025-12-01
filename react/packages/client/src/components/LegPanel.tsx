import type { Train, CatchableTrain, CarPosition } from '@transferhero/shared'
import { TrainList } from './TrainList'
import { CarDiagram } from './CarDiagram'

interface LegPanelProps {
  leg: 1 | 2
  title: string
  subtitle?: string
  trains: (Train | CatchableTrain)[]
  carPosition: CarPosition | null
  selectedTrainIndex?: number
  onTrainSelect?: (train: Train | CatchableTrain, index: number) => void
  selectedNumCars?: number
  isLoading?: boolean
}

export function LegPanel({
  leg,
  title,
  subtitle,
  trains,
  carPosition,
  selectedTrainIndex,
  onTrainSelect,
  selectedNumCars,
  isLoading
}: LegPanelProps) {
  const variant = leg === 1 ? 'selectable' : 'display'
  const carDiagramType = leg === 1 ? 'board' : 'exit'

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-md">
      {/* Header */}
      <div className="bg-gray-800 px-5 py-4">
        <h3 className="text-white font-semibold text-lg">{title}</h3>
        {subtitle && (
          <p className="text-gray-300 text-base mt-0.5">{subtitle}</p>
        )}
      </div>

      {/* Content */}
      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#E31837]" />
          </div>
        ) : (
          <>
            <TrainList
              trains={trains}
              variant={variant}
              selectedIndex={selectedTrainIndex}
              onSelect={onTrainSelect}
            />

            {/* Car diagram */}
            {carPosition && selectedNumCars && (
              <CarDiagram
                numCars={selectedNumCars}
                carPosition={carPosition}
                type={carDiagramType}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
