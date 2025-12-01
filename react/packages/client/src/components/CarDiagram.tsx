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
    <div className="bg-[var(--bg-secondary)] rounded-lg p-3 mt-3 border border-[var(--border-color)]">
      <div className="text-xs text-[var(--text-secondary)] uppercase font-semibold tracking-wide mb-2">
        {title}
      </div>

      <div className="flex gap-0.5 justify-center">
        {Array.from({ length: numCars }, (_, i) => {
          const carNum = i + 1
          const isHighlighted = carNum === highlightCar
          const highlightClass = type === 'board'
            ? 'bg-green-100 border-green-500 text-green-700 font-bold'
            : 'bg-yellow-100 border-yellow-500 text-yellow-700 font-bold'

          return (
            <div
              key={i}
              className={`w-7 h-5 border-2 rounded text-xs flex items-center justify-center relative transition-colors ${
                isHighlighted
                  ? highlightClass
                  : 'bg-[var(--card-bg)] border-[var(--text-secondary)] text-[var(--text-primary)]'
              }`}
            >
              {carNum}
              {isHighlighted && (
                <span className="absolute -top-3.5 text-[10px] font-bold">
                  {type === 'board' ? 'B' : 'X'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      <div className="text-[10px] text-[var(--text-secondary)] text-center mt-1">
        {carPosition.legend}
      </div>
    </div>
  )
}
