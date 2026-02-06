import { useState } from 'react'
import { MapPin, Navigation, ChevronDown, ChevronUp, Check } from 'lucide-react'
import type { PlaceContext } from '@transferhero/shared'
import { formatDistance } from '../utils/geo'

interface DestinationBannerProps {
  context: PlaceContext
  isLocation?: boolean
  onSelectAlternative?: (alt: NonNullable<PlaceContext['alternatives']>[number]) => void
}

export function DestinationBanner({ context, isLocation, onSelectAlternative }: DestinationBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isOrigin = context.direction === 'to_station'
  const Icon = isLocation ? Navigation : MapPin

  const alternatives = context.alternatives ?? []
  const hasAlternatives = alternatives.length > 0 && !!onSelectAlternative

  return (
    <div className="bg-[var(--bg-tertiary)] rounded text-sm">
      <div
        className={`flex items-center gap-2 px-3 py-2 ${hasAlternatives ? 'cursor-pointer' : ''}`}
        onClick={hasAlternatives ? () => setIsExpanded(!isExpanded) : undefined}
      >
        <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
        <span className="flex-1 text-[var(--text-secondary)]">
          {isOrigin ? (
            <>
              Walk to <span className="font-medium text-[var(--text-primary)]">{context.station.name}</span>
              {' · '}
              Enter at <span className="font-medium text-[var(--text-primary)]">{context.exit.name}</span>
              {' · '}
              {context.walkTimeMinutes} min walk
            </>
          ) : (
            <>
              Via <span className="font-medium text-[var(--text-primary)]">{context.station.name}</span>
              {' · '}
              Exit at <span className="font-medium text-[var(--text-primary)]">{context.exit.name}</span>
              {' · '}
              {context.walkTimeMinutes} min walk
            </>
          )}
        </span>
        {hasAlternatives && (
          <button className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0">
            {alternatives.length + 1} options
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {isExpanded && hasAlternatives && (
        <div className="px-3 pb-2 space-y-1">
          {/* Current (closest) station */}
          <div className="flex items-center justify-between p-1.5 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs">
            <span>
              <strong>{context.station.name}</strong>
              <span className="ml-1.5 text-[var(--text-secondary)]">
                {context.exit.name} · {context.walkTimeMinutes} min
              </span>
            </span>
            <Check className="w-3.5 h-3.5 shrink-0" />
          </div>

          {/* Alternatives */}
          {alternatives.map((alt) => (
            <button
              key={alt.station.code}
              onClick={(e) => {
                e.stopPropagation()
                onSelectAlternative!(alt)
                setIsExpanded(false)
              }}
              className="w-full text-left p-1.5 rounded text-xs hover:bg-[var(--suggestion-hover)] transition-colors cursor-pointer"
            >
              <strong>{alt.station.name}</strong>
              <span className="ml-1.5 text-[var(--text-secondary)]">
                {alt.exit.name} · {alt.walkTimeMinutes} min · {formatDistance(alt.walkDistanceMeters)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
