import { Suspense, lazy } from 'react'
import { ExternalLink, Footprints } from 'lucide-react'
import type { PlaceContext } from '@transferhero/shared'
import { buildMapsUrl, formatDistance } from '../utils/geo'

const WalkingMap = lazy(() =>
  import('./WalkingMap').then((m) => ({ default: m.WalkingMap }))
)

interface WalkingCardProps {
  context: PlaceContext
}

export function WalkingCard({ context }: WalkingCardProps) {
  const isOrigin = context.direction === 'to_station'
  const title = isOrigin ? 'Walk to Station' : 'Walk to Destination'

  // determine from/to for the map and directions link
  const fromLat = isOrigin ? context.place.lat : context.exit.lat
  const fromLon = isOrigin ? context.place.lon : context.exit.lon
  const toLat = isOrigin ? context.exit.lat : context.place.lat
  const toLon = isOrigin ? context.exit.lon : context.place.lon

  const mapsUrl = buildMapsUrl(fromLat, fromLon, toLat, toLon)

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-sm">
      {/* Map */}
      <Suspense
        fallback={
          <div
            className="w-full bg-[var(--bg-tertiary)] flex items-center justify-center"
            style={{ height: '180px' }}
          >
            <span className="text-sm text-[var(--text-secondary)]">Loading map...</span>
          </div>
        }
      >
        <WalkingMap
          exitLat={context.exit.lat}
          exitLon={context.exit.lon}
          placeLat={context.place.lat}
          placeLon={context.place.lon}
        />
      </Suspense>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Footprints className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
              <h3 className="font-semibold text-[var(--text-primary)] text-sm">{title}</h3>
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
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
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
              {context.walkTimeMinutes} min · {formatDistance(context.walkDistanceMeters)}
            </p>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 px-4 py-2 bg-[var(--bg-tertiary)] border border-[var(--border-color)] rounded-lg text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors flex items-center gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open in Maps
          </a>
        </div>
      </div>
    </div>
  )
}
