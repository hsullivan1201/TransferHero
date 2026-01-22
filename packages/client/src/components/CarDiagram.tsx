import { ChevronDown } from 'lucide-react'
import type { CarPosition } from '@transferhero/shared'

interface CarDiagramProps {
  numCars?: number
  carPosition: CarPosition
  type: 'board' | 'exit'
}

export function CarDiagram({ numCars, carPosition, type }: CarDiagramProps) {
  const highlightCar = type === 'board' ? carPosition.boardCar : carPosition.exitCar
  const title = type === 'board' ? 'Board car for best exit' : 'Exit options'
  
  const exits = carPosition.exits ?? []
  
  const highlightedCars = exits.length > 0 
    ? [...new Set(exits.map(e => e.car))]
    : [highlightCar]
  
  // pick the car with the favored exit (teacher's pet car)
  const preferredCar = exits.find(e => e.preferred)?.car
  
  const showExitLabels = type === 'exit' && exits.length > 0

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg p-4 mt-4 border border-[var(--border-color)]">
      <div className="text-xs text-[var(--text-secondary)] uppercase font-semibold tracking-wide mb-3">
        {title}
      </div>

      <div className="flex flex-col items-center">
        <div className="flex gap-1 h-6 mb-0.5">
          {Array.from({ length: 8 }, (_, i) => {
            const carNum = i + 1
            const isHighlighted = highlightedCars.includes(carNum)
            const isPreferred = carNum === preferredCar

            return (
              <div key={i} className="w-9 flex items-end justify-center">
                {isHighlighted && (
                  <ChevronDown
                    className={`w-5 h-5 ${
                      type === 'board'
                        ? 'text-green-600'
                        : isPreferred
                          ? 'text-blue-600'
                          : 'text-yellow-600'
                    }`}
                    strokeWidth={isPreferred ? 3 : 2}
                  />
                )}
              </div>
            )
          })}
        </div>

        <div className="flex gap-1">
          {Array.from({ length: 8 }, (_, i) => {
            const carNum = i + 1
            const isHighlighted = highlightedCars.includes(carNum)
            const isPreferred = carNum === preferredCar

            let highlightClass = ''
            if (type === 'board') {
              highlightClass = 'bg-green-100 border-green-500 text-green-700 font-bold'
            } else if (isPreferred) {
              highlightClass = 'bg-blue-100 border-blue-500 text-blue-700 font-bold'
            } else if (isHighlighted) {
              highlightClass = 'bg-yellow-100 border-yellow-500 text-yellow-700 font-bold'
            }

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

      {!showExitLabels && (
        <div className="text-xs text-[var(--text-secondary)] text-center mt-2">
          {carPosition.legend}
        </div>
      )}

      {showExitLabels && (
        <div className="text-[11px] text-[var(--text-secondary)] text-center mt-2 space-x-3">
          {exits.map((exit, idx) => (
            <span key={idx} className={`inline-flex items-center gap-1 ${exit.preferred ? 'text-blue-600 font-semibold' : ''}`}>
              <span className={`font-semibold ${exit.preferred ? 'text-blue-700' : 'text-[var(--text-primary)]'}`}>{exit.car}:</span>
              <span className="truncate max-w-[140px]">{exit.label}</span>
            </span>
          ))}
        </div>
      )}

      {showExitLabels && (
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-[var(--text-secondary)]">
          {preferredCar && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500"></span>
              Best exit
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500"></span>
            {preferredCar ? 'Other options' : 'Exit options'}
          </span>
        </div>
      )}
    </div>
  )
}
