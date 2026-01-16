import { useEffect, useMemo, useState } from 'react'
import type { Train, CatchableTrain, CarPosition } from '@transferhero/shared'
import { TrainList } from './TrainList'
import { CarDiagram } from './CarDiagram'
import { TrainCard } from './TrainCard'
import { getTrainMinutes } from '../utils/time'

interface LegPanelProps {
  leg: 1 | 2
  title: string
  subtitle?: string
  trains: (Train | CatchableTrain)[]
  carPosition: CarPosition | null
  selectedTrain?: Train | CatchableTrain | null 
  onTrainSelect?: (train: Train | CatchableTrain, index: number) => void
  onClearSelection?: () => void
  selectedNumCars?: number
  isLoading?: boolean
  customStatus?: string
  isDirect?: boolean
  showDeparted?: boolean
  onToggleShowDeparted?: () => void
}

function isDepartedTrain(train: Train | CatchableTrain): boolean {
  const min = getTrainMinutes(train.Min)
  return train._departed === true || (typeof min === 'number' && min < 0)
}

export function LegPanel({
  leg,
  title,
  subtitle,
  trains,
  carPosition,
  selectedTrain,
  onTrainSelect,
  onClearSelection,
  selectedNumCars,
  isLoading,
  customStatus,
  isDirect,
  showDeparted,
  onToggleShowDeparted
}: LegPanelProps) {
  const variant = leg === 1 ? 'selectable' : 'display'
  // direct trips: leg 1 is basically the destination, so show exit info anyway
  const carDiagramType = (leg === 1 && !isDirect) ? 'board' : 'exit'
  const [collapsed, setCollapsed] = useState(false)

  // auto-collapse leg 1 when something is picked; pop back open when cleared
  useEffect(() => {
    if (leg !== 1) return
    setCollapsed(!!selectedTrain)
  }, [selectedTrain, leg])

  // split trains into regular vs already-gone
  const { regularTrains, departedTrains } = useMemo(() => {
    const regular: (Train | CatchableTrain)[] = []
    const departed: (Train | CatchableTrain)[] = []
    const isSelectedTrain = (train: Train | CatchableTrain) => {
      if (!selectedTrain) return false
      if (selectedTrain._tripId && train._tripId) return train._tripId === selectedTrain._tripId
      return train.Line === selectedTrain.Line
        && train.DestinationName === selectedTrain.DestinationName
        && train.Min === selectedTrain.Min
    }
    for (const train of trains) {
      if (leg === 1 && isSelectedTrain(train)) continue
      if (isDepartedTrain(train)) {
        departed.push(train)
      } else {
        regular.push(train)
      }
    }
    return { regularTrains: regular, departedTrains: departed }
  }, [trains, selectedTrain, leg])

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-md">
      <div className="bg-gray-800 px-5 py-4">
        <h3 className="text-white font-semibold text-lg">{title}</h3>
        {subtitle && (
          <p className="text-gray-300 text-base mt-0.5">{subtitle}</p>
        )}
      </div>

      <div className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#E31837]" />
          </div>
        ) : (
          <>
            {/* pinned pick */}
            {selectedTrain && leg === 1 && (
              <div className="mb-6 animate-fade-in">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    Current Ride
                  </div>
                  {/* tiny "change" link */}
                  <button 
                    onClick={onClearSelection} 
                    className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
                  >
                    Change
                  </button>
                </div>
                <TrainCard
                  train={selectedTrain}
                  index={-1}
                  variant="selectable"
                  isSelected={true}
                  customStatus={customStatus}
                />
                
                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-[var(--border-color)]"></div>
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-2 bg-[var(--card-bg)] text-xs text-[var(--text-secondary)] uppercase">
                      Other Departures
                    </span>
                  </div>
                </div>
              </div>
            )}

            {leg === 1 && selectedTrain && (
              <div className="flex items-center justify-between mb-3">
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

            {!collapsed && (
              <TrainList
                trains={regularTrains}
                variant={variant}
                selectedIndex={-1} 
                onSelect={onTrainSelect}
              />
            )}

            {/* departed trains (leg 1 only) */}
            {leg === 1 && onToggleShowDeparted && !collapsed && (
              <div className="mt-4">
                <button
                  onClick={onToggleShowDeparted}
                  className="w-full py-3 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex items-center justify-center gap-2 border border-dashed border-[var(--border-color)] rounded-lg hover:border-solid"
                >
                  <span className="text-xs">{showDeparted ? '▼' : '▶'}</span>
                  {showDeparted ? 'Hide departed trains' : 'Already on a train?'}
                </button>
                
                {showDeparted && departedTrains.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                    <div className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                      Trains Already Departed
                    </div>
                    <TrainList
                      trains={departedTrains}
                      variant={variant}
                      selectedIndex={-1}
                      onSelect={onTrainSelect}
                    />
                  </div>
                )}
                
                {showDeparted && departedTrains.length === 0 && (
                  <div className="mt-4 text-center text-sm text-[var(--text-secondary)] py-4">
                    No recently departed trains found
                  </div>
                )}
              </div>
            )}

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