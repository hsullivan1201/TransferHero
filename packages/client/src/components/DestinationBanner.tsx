import { MapPin, Navigation } from 'lucide-react'
import type { PlaceContext } from '@transferhero/shared'

interface DestinationBannerProps {
  context: PlaceContext
  isLocation?: boolean
}

export function DestinationBanner({ context, isLocation }: DestinationBannerProps) {
  const isOrigin = context.direction === 'to_station'
  const Icon = isLocation ? Navigation : MapPin

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] rounded text-sm">
      <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
      <span className="text-[var(--text-secondary)]">
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
    </div>
  )
}
