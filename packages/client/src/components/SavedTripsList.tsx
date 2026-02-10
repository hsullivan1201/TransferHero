import { ArrowRight, X, MapPin, Train } from 'lucide-react'
import { LineDots } from './LineDot'
import type { SavedTrip } from '../hooks/useSavedTrips'

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function SelectionLabel({ sel }: { sel: SavedTrip['from'] }) {
  if (sel.type === 'station' && sel.station) {
    return (
      <span className="inline-flex items-center gap-1">
        <LineDots lines={sel.station.lines} size="sm" />
        <span>{sel.station.name}</span>
      </span>
    )
  }
  if (sel.place) {
    return (
      <span className="inline-flex items-center gap-1">
        <MapPin className="w-3 h-3 text-[var(--text-secondary)]" />
        <span>{sel.place.name}</span>
      </span>
    )
  }
  return <span>?</span>
}

interface SavedTripsListProps {
  trips: SavedTrip[]
  onLoad: (trip: SavedTrip) => void
  onDelete: (id: string) => void
}

export function SavedTripsList({ trips, onLoad, onDelete }: SavedTripsListProps) {
  return (
    <div className="animate-fade-in">
      <h3 className="text-sm font-medium text-[var(--text-secondary)] mb-3">Saved Trips</h3>
      <div className="space-y-2">
        {trips.map(trip => (
          <div
            key={trip.id}
            className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg px-3 py-2.5 flex items-center gap-3 group"
          >
            <button
              onClick={() => onLoad(trip)}
              className="flex-1 min-w-0 flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                <SelectionLabel sel={trip.from} />
                <ArrowRight className="w-3 h-3 text-[var(--text-secondary)] shrink-0" />
                <SelectionLabel sel={trip.to} />
              </div>
              <span className="text-xs text-[var(--text-secondary)] shrink-0 ml-auto">
                {timeAgo(trip.savedAt)}
              </span>
            </button>
            <button
              onClick={() => onDelete(trip.id)}
              className="shrink-0 p-1 text-[var(--text-secondary)] hover:text-red-500 lg:opacity-0 lg:group-hover:opacity-100 transition-all"
              aria-label="Delete saved trip"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="text-center py-8 opacity-50 mt-4">
        <Train className="w-10 h-10 mx-auto mb-2 text-[var(--text-secondary)]" />
        <p className="text-sm text-[var(--text-secondary)]">
          Select stations above to plan a new trip
        </p>
      </div>
    </div>
  )
}
