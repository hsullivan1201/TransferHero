import { Bus, Footprints, ArrowRight, Clock3 } from 'lucide-react'
import type { HybridTrip } from '@transferhero/shared'

interface BusTripCardProps {
  trip: HybridTrip
  stationNames: Map<string, string>
  onSelect: () => void
}

export function BusTripCard({ trip, stationNames, onSelect }: BusTripCardProps) {
  const isMetroBus = trip.pattern === 'metro-bus'
  const fromName = stationNames.get(trip.metroFrom) || trip.metroFrom
  const toName = stationNames.get(trip.metroTo) || trip.metroTo
  const { busLeg } = trip

  return (
    <div
      className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-sm overflow-hidden hover:border-[#0f9b8e] transition-colors cursor-pointer"
      onClick={onSelect}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          {isMetroBus ? (
            <>
              <MetroIcon />
              <span>{fromName} → {toName}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <BusIcon />
              <span className="text-[#0f9b8e]">{busLeg.routeName}</span>
            </>
          ) : (
            <>
              <BusIcon />
              <span className="text-[#0f9b8e]">{busLeg.routeName}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
              <MetroIcon />
              <span>{fromName} → {toName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)]">
          <Clock3 className="w-3.5 h-3.5" />
          <span>~{trip.totalTimeMinutes} min</span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        {/* Metro section */}
        <div className="flex items-center gap-3">
          <MetroIcon />
          <div className="text-sm text-[var(--text-primary)]">
            <span className="font-medium">{fromName}</span>
            <ArrowRight className="w-3 h-3 inline mx-1 text-[var(--text-secondary)]" />
            <span className="font-medium">{toName}</span>
            <span className="text-xs text-[var(--text-secondary)] ml-2">~{trip.metroTimeMinutes} min</span>
          </div>
        </div>

        {/* Bus section */}
        <div className="flex items-center gap-3">
          <BusIcon />
          <div className="text-sm text-[var(--text-primary)]">
            <span className="font-medium">{busLeg.routeName}</span>
            {busLeg.headsign && (
              <span className="text-xs text-[var(--text-secondary)] ml-1">→ {busLeg.headsign}</span>
            )}
            <span className="text-xs text-[var(--text-secondary)] ml-2">~{busLeg.estimatedRideMinutes} min</span>
          </div>
        </div>

        {/* Walking summary */}
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)] pl-8">
          <Footprints className="w-3 h-3 shrink-0" />
          <span>
            {busLeg.boardWalkMinutes} min walk to bus · {busLeg.alightWalkMinutes} min walk {isMetroBus ? 'to dest' : 'to Metro'}
          </span>
        </div>
      </div>
    </div>
  )
}

function MetroIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-[#666] flex items-center justify-center shrink-0">
      <span className="text-[10px] font-bold text-white">M</span>
    </div>
  )
}

function BusIcon() {
  return (
    <div className="w-5 h-5 rounded-full bg-[#0f9b8e] flex items-center justify-center shrink-0">
      <Bus className="w-3 h-3 text-white" />
    </div>
  )
}
