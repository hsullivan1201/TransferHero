import { useState } from 'react'
import { ChevronDown, ChevronUp, Check } from 'lucide-react'
import type { TransferResult, TransferAlternative } from '@transferhero/shared'

interface TransferDisplayProps {
  transfer: TransferResult
  onSelectAlternative: (alternative: TransferAlternative | null) => void
  selectedIndex: number // -1 means fastest (default) is selected
}

export function TransferDisplay({
  transfer,
  onSelectAlternative,
  selectedIndex
}: TransferDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Filter meaningful alternatives (within 10 minutes of fastest)
  const alternatives = (transfer.alternatives || []).filter(alt => alt.timeDiff <= 10)
  const hasAlternatives = alternatives.length > 0

  // Determine the display name for the header (selected alternative or original)
  const selectedAlt = selectedIndex >= 0 ? transfer.alternatives?.[selectedIndex] : null
  const headerName = selectedAlt ? selectedAlt.name : transfer.name

  if (transfer.direct) {
    return (
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3">
        <span className="text-[var(--text-primary)] font-medium">
          Direct route - no transfer needed
        </span>
      </div>
    )
  }

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-3">
      <div 
        className={`flex items-center justify-between ${hasAlternatives ? 'cursor-pointer' : ''}`}
        onClick={hasAlternatives ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <div>
          <span className="text-[var(--text-primary)] font-semibold">
            Transfer at: {headerName}
          </span>
          {hasAlternatives && selectedIndex === -1 && (
            <span className="ml-2 text-xs text-[var(--text-secondary)]">(fastest)</span>
          )}
        </div>

        {hasAlternatives && (
          <button
            className="flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          >
            {alternatives.length + 1} options
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {isExpanded && hasAlternatives && (
        <div className="mt-3 space-y-2">
          {/* Fastest option */}
          <button
            onClick={() => onSelectAlternative(null)}
            className={`w-full text-left p-2 rounded flex items-center justify-between cursor-pointer transition-colors ${
              selectedIndex === -1
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'hover:bg-[var(--suggestion-hover)]'
            }`}
          >
            <span>
              <strong>{transfer.defaultTransferName || transfer.name}</strong>
              <span className="text-xs ml-2">(fastest)</span>
            </span>
            {selectedIndex === -1 && <Check className="w-4 h-4" />}
          </button>

          {/* Alternative options */}
          {alternatives.map((alt) => {
            const isSelected = selectedAlt?.station === alt.station
            return (
              <button
                key={alt.station}
                onClick={() => onSelectAlternative(alt)}
                className={`w-full text-left p-2 rounded flex items-center justify-between cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    : 'hover:bg-[var(--suggestion-hover)]'
                }`}
              >
                <span>
                  <strong>{alt.name}</strong>
                  <span className="text-xs ml-2 text-[var(--text-secondary)]">
                    +{alt.timeDiff} min
                  </span>
                </span>
                {isSelected && <Check className="w-4 h-4" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}