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
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-sm">
      {/* Header */}
      <div className="bg-gray-800 px-4 py-3">
        <h3 className="text-white font-semibold">{title}</h3>
        {subtitle && (
          <p className="text-gray-300 text-sm">{subtitle}</p>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E31837]" />
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
