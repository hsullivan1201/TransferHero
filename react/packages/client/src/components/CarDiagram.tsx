import { ChevronDown } from 'lucide-react'
import type { CarPosition } from '@transferhero/shared'

interface CarDiagramProps {
  numCars: number
  carPosition: CarPosition
  type: 'board' | 'exit'
}

export function CarDiagram({ numCars, carPosition, type }: CarDiagramProps) {
  const highlightCar = type === 'board' ? carPosition.boardCar : carPosition.exitCar
  const title = type === 'board' ? 'Board car for best exit' : 'Exit car at transfer'

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-4 mt-4 border border-[var(--border-color)]">
      <div className="text-xs text-[var(--text-secondary)] uppercase font-semibold tracking-wide mb-3">
        {title}
      </div>

      <div className="flex flex-col items-center">
        {/* Arrow row */}
        <div className="flex gap-1 h-6 mb-0.5">
          {Array.from({ length: numCars }, (_, i) => {
            const carNum = i + 1
            const isHighlighted = carNum === highlightCar

            return (
              <div key={i} className="w-9 flex items-end justify-center">
                {isHighlighted && (
                  <ChevronDown
                    className={`w-5 h-5 ${
                      type === 'board' ? 'text-green-600' : 'text-yellow-600'
                    }`}
                    strokeWidth={3}
                  />
                )}
              </div>
            )
          })}
        </div>

        {/* Car boxes row */}
        <div className="flex gap-1">
          {Array.from({ length: numCars }, (_, i) => {
            const carNum = i + 1
            const isHighlighted = carNum === highlightCar
            const highlightClass = type === 'board'
              ? 'bg-green-100 border-green-500 text-green-700 font-bold'
              : 'bg-yellow-100 border-yellow-500 text-yellow-700 font-bold'

            return (
              <div
                key={i}
                className={`w-9 h-7 border-2 rounded text-sm flex items-center justify-center transition-colors ${
                  isHighlighted
                    ? highlightClass
                    : 'bg-[var(--card-bg)] border-[var(--text-secondary)] text-[var(--text-primary)]'
                }`}
              >
                {carNum}
              </div>
            )
          })}
        </div>
      </div>

      <div className="text-xs text-[var(--text-secondary)] text-center mt-2">
        {carPosition.legend}
      </div>
    </div>
  )
}
