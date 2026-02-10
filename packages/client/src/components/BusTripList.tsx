import { useState } from 'react'
import { Bus } from 'lucide-react'
import type { HybridTrip, PlaceContext } from '@transferhero/shared'
import { BusTripCard } from './BusTripCard'
import { BusTripDetail } from './BusTripDetail'

interface BusTripListProps {
  trips: HybridTrip[]
  isLoading: boolean
  stationNames: Map<string, string>
  originPlaceContext: PlaceContext | null
  destPlaceContext: PlaceContext | null
  walkTime: number
  accessible: boolean
}

const INITIAL_VISIBLE = 5

export function BusTripList({ trips, isLoading, stationNames, originPlaceContext, destPlaceContext, walkTime, accessible }: BusTripListProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-4 animate-pulse">
            <div className="h-4 bg-[var(--bg-tertiary)] rounded w-3/4 mb-3" />
            <div className="h-3 bg-[var(--bg-tertiary)] rounded w-1/2 mb-2" />
            <div className="h-3 bg-[var(--bg-tertiary)] rounded w-2/3" />
          </div>
        ))}
      </div>
    )
  }

  if (trips.length === 0) {
    return (
      <div className="text-center py-8">
        <Bus className="w-8 h-8 text-[var(--text-secondary)] mx-auto mb-2 opacity-40" />
        <p className="text-[var(--text-secondary)] text-sm">
          No bus options available for this trip
        </p>
        <p className="text-[var(--text-secondary)] text-xs mt-1">
          Try a different origin or destination
        </p>
      </div>
    )
  }

  // When a trip is selected, show the full detail view
  if (selectedIndex !== null && trips[selectedIndex]) {
    return (
      <BusTripDetail
        trip={trips[selectedIndex]}
        stationNames={stationNames}
        originPlaceContext={originPlaceContext}
        destPlaceContext={destPlaceContext}
        onBack={() => setSelectedIndex(null)}
        walkTime={walkTime}
        accessible={accessible}
      />
    )
  }

  const visibleTrips = expanded ? trips : trips.slice(0, INITIAL_VISIBLE)
  const hiddenCount = trips.length - INITIAL_VISIBLE

  return (
    <div className="space-y-3">
      {visibleTrips.map((trip, i) => (
        <BusTripCard
          key={`${trip.busLeg.routeId}-${trip.metroFrom}-${trip.metroTo}-${i}`}
          trip={trip}
          stationNames={stationNames}
          onSelect={() => setSelectedIndex(i)}
        />
      ))}
      {!expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          Show {hiddenCount} more option{hiddenCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
