import { useState } from 'react'
import { ExternalLink, Footprints, ChevronDown, ChevronUp, Check } from 'lucide-react'
import type { PlaceContext } from '@transferhero/shared'
import { buildMapsUrl, formatDistance } from '../utils/geo'

interface WalkingCardProps {
  context: PlaceContext
  onSelectAlternative?: (alt: NonNullable<PlaceContext['alternatives']>[number]) => void
}

export function WalkingCard({ context, onSelectAlternative }: WalkingCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isOrigin = context.direction === 'to_station'
  const title = isOrigin ? 'Walk to Station' : 'Walk to Destination'

  // determine from/to for the directions link
  const fromLat = isOrigin ? context.place.lat : context.exit.lat
  const fromLon = isOrigin ? context.place.lon : context.exit.lon
  const toLat = isOrigin ? context.exit.lat : context.place.lat
  const toLon = isOrigin ? context.exit.lon : context.place.lon

  const mapsUrl = buildMapsUrl(fromLat, fromLon, toLat, toLon)

  const alternatives = context.alternatives ?? []
  const hasAlternatives = alternatives.length > 0 && !!onSelectAlternative

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Footprints className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
            <span className="font-semibold text-[var(--text-primary)] text-sm">{title}</span>
            <span className="text-sm text-[var(--text-secondary)]">
              · {context.walkTimeMinutes} min · {formatDistance(context.walkDistanceMeters)}
            </span>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 ml-6">
            {isOrigin ? (
              <>
                {context.place.name} → <span className="font-medium">{context.exit.name}</span>
              </>
            ) : (
              <>
                <span className="font-medium">{context.exit.name}</span> → {context.place.name}
              </>
            )}
          </p>
        </div>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 px-3 py-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-1.5"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Maps
        </a>
      </div>

      {/* Alternative stations */}
      {hasAlternatives && (
        <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {alternatives.length} other nearby {alternatives.length === 1 ? 'station' : 'stations'}
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {isExpanded && (
            <div className="mt-2 space-y-1.5">
              {/* Current station */}
              <div className="flex items-center justify-between p-2 rounded bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-sm">
                <span>
                  <strong>{context.station.name}</strong>
                  <span className="ml-2 text-xs">
                    {context.exit.name} · {context.walkTimeMinutes} min · {formatDistance(context.walkDistanceMeters)}
                  </span>
                </span>
                <Check className="w-4 h-4 shrink-0" />
              </div>

              {/* Alternatives */}
              {alternatives.map((alt) => (
                <button
                  key={alt.station.code}
                  onClick={() => onSelectAlternative!(alt)}
                  className="w-full text-left p-2 rounded text-sm hover:bg-[var(--suggestion-hover)] transition-colors cursor-pointer"
                >
                  <strong>{alt.station.name}</strong>
                  <span className="ml-2 text-xs text-[var(--text-secondary)]">
                    {alt.exit.name} · {alt.walkTimeMinutes} min · {formatDistance(alt.walkDistanceMeters)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
