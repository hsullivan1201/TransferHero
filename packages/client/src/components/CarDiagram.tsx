import { ChevronDown, MapPin } from 'lucide-react'
import type { CarPosition, ExitOption } from '@transferhero/shared'

interface CarDiagramProps {
  numCars?: number
  carPosition: CarPosition
  type: 'board' | 'exit'
  destinationExitName?: string
  destinationExitLabel?: number
}

const STOP_WORDS = new Set([
  'to', 'the', 'at', 'of', 'and', 'in', 'from', 'for',
  'corner', 'entrance', 'elevator', 'escalator', 'stairs', 'platform',
  'side', 'only', 'street', 'avenue', 'all', 'trains', 'exit', 'path',
])

/** Extract meaningful keywords from a string, stripping punctuation and stop words */
function extractKeywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[.,;:()'"!?&]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 0 && !STOP_WORDS.has(w))
  )
}

/**
 * Find the single best destination exit match.
 *
 * Primary: match by exitLabel (from manual mapping — exact, no fuzz).
 * Fallback: keyword matching — picks the single best match by keyword count.
 *           Ties return empty set (shows fallback text instead of wrong highlight).
 */
function findDestinationExits(
  exits: ExitOption[],
  destExitName: string | undefined,
  destExitLabel: number | undefined
): Set<number> {
  // Primary: exact exitLabel match
  if (destExitLabel != null) {
    const matched = exits.filter(e => e.exitLabel === destExitLabel).map(e => e.car)
    if (matched.length > 0) return new Set(matched)
  }

  // Fallback: keyword matching — single best match only
  if (!destExitName) return new Set()

  const gtfsWords = extractKeywords(destExitName)
  let bestCar: number | null = null
  let bestScore = 0
  let tied = false

  for (const exit of exits) {
    const labelWords = extractKeywords(exit.label)
    let score = 0
    for (const word of labelWords) {
      if (gtfsWords.has(word)) score += word.length
    }
    if (score > bestScore) {
      bestScore = score
      bestCar = exit.car
      tied = false
    } else if (score === bestScore && score > 0 && exit.car !== bestCar) {
      tied = true
    }
  }

  // Require minimum score of 4 and no ties — if tied, show fallback text
  if (bestCar !== null && bestScore >= 4 && !tied) {
    return new Set([bestCar])
  }
  return new Set()
}

export function CarDiagram({ numCars, carPosition, type, destinationExitName, destinationExitLabel }: CarDiagramProps) {
  const highlightCar = type === 'board' ? carPosition.boardCar : carPosition.exitCar
  const title = type === 'board' ? 'Board car for best exit' : 'Exit options'

  const exits = carPosition.exits ?? []

  const highlightedCars = exits.length > 0
    ? [...new Set(exits.map(e => e.car))]
    : [highlightCar]

  // All cars with preferred exits (can be multiple)
  const preferredCars = new Set(exits.filter(e => e.preferred).map(e => e.car))
  const hasPreferred = preferredCars.size > 0

  // Destination exit matching
  const destCars = (destinationExitName || destinationExitLabel != null) && exits.length > 0
    ? findDestinationExits(exits, destinationExitName, destinationExitLabel)
    : new Set<number>()
  const hasDestMatch = destCars.size > 0

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
            const isDest = destCars.has(carNum)
            const isPreferred = preferredCars.has(carNum)

            return (
              <div key={i} className="w-9 flex items-end justify-center">
                {isHighlighted && (
                  <ChevronDown
                    className={`w-5 h-5 ${
                      type === 'board'
                        ? 'text-green-600'
                        : isDest
                          ? 'text-purple-600'
                          : isPreferred
                            ? 'text-blue-600'
                            : 'text-yellow-600'
                    }`}
                    strokeWidth={isDest || isPreferred ? 3 : 2}
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
            const isDest = destCars.has(carNum)
            const isPreferred = preferredCars.has(carNum)

            let highlightClass = ''
            if (type === 'board') {
              highlightClass = 'bg-green-100 border-green-500 text-green-700 font-bold'
            } else if (isDest) {
              highlightClass = 'bg-purple-100 border-purple-500 text-purple-700 font-bold'
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
          {[...exits].sort((a, b) => a.car - b.car).map((exit, idx) => {
            const isDest = destCars.has(exit.car)
            return (
              <span key={idx} className={`inline-flex items-center gap-1 ${isDest ? 'text-purple-600 font-semibold' : exit.preferred ? 'text-blue-600 font-semibold' : ''}`}>
                <span className={`font-semibold ${isDest ? 'text-purple-700' : exit.preferred ? 'text-blue-700' : 'text-[var(--text-primary)]'}`}>{exit.car}:</span>
                <span className="truncate max-w-[140px]">{exit.label}</span>
              </span>
            )
          })}
        </div>
      )}

      {showExitLabels && (
        <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-[var(--text-secondary)]">
          {hasDestMatch && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-500"></span>
              Nearest to destination
            </span>
          )}
          {hasPreferred && !hasDestMatch && (
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-500"></span>
              Best exit
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-yellow-500"></span>
            {hasPreferred || hasDestMatch ? 'Other options' : 'Exit options'}
          </span>
        </div>
      )}

      {/* Fallback: destination exit name with no matching exit label */}
      {destinationExitName && !hasDestMatch && type === 'exit' && (
        <div className="flex items-center justify-center gap-1.5 mt-2 text-[11px] text-purple-600">
          <MapPin className="w-3.5 h-3.5" />
          <span>Use <span className="font-semibold">{destinationExitName}</span> exit</span>
        </div>
      )}
    </div>
  )
}
