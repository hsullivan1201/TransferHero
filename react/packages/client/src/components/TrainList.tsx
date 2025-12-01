import { useState } from 'react'
import type { Train, CatchableTrain } from '@transferhero/shared'
import { TrainCard } from './TrainCard'

interface TrainListProps {
  trains: (Train | CatchableTrain)[]
  variant: 'selectable' | 'display'
  selectedIndex?: number
  onSelect?: (train: Train | CatchableTrain, index: number) => void
  initialShowCount?: number
}

export function TrainList({
  trains,
  variant,
  selectedIndex,
  onSelect,
  initialShowCount = 3
}: TrainListProps) {
  const [showAll, setShowAll] = useState(false)

  const displayedTrains = showAll ? trains : trains.slice(0, initialShowCount)
  const hasMore = trains.length > initialShowCount

  if (trains.length === 0) {
    return (
      <div className="text-center py-6 text-[var(--text-secondary)]">
        No trains found
      </div>
    )
  }

  return (
    <div>
      {displayedTrains.map((train, index) => (
        <TrainCard
          key={`${train.Line}-${train.DestinationName}-${train.Min}-${index}`}
          train={train}
          index={index}
          variant={variant}
          isSelected={selectedIndex === index}
          onClick={onSelect ? () => onSelect(train, index) : undefined}
        />
      ))}

      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-3 mt-3 bg-[var(--bg-secondary)] border border-dashed border-[var(--border-color)] rounded-lg text-base text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] hover:border-solid transition-colors font-medium"
        >
          Show {trains.length - initialShowCount} more trains
        </button>
      )}
    </div>
  )
}
