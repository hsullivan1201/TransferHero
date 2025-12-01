import { useState, useCallback } from 'react'
import { ArrowRight, Repeat } from 'lucide-react'
import type { Station } from '@transferhero/shared'
import { StationSelector } from './StationSelector'

interface TripSelectorProps {
  stations: Station[]
  onGo: (from: Station, to: Station, walkTime: number) => void
  isLoading?: boolean
  transferName?: string
}

export function TripSelector({ stations, onGo, isLoading, transferName }: TripSelectorProps) {
  const [fromStation, setFromStation] = useState<Station | null>(null)
  const [toStation, setToStation] = useState<Station | null>(null)
  const [walkTime, setWalkTime] = useState(3)

  const canGo = fromStation && toStation && fromStation.code !== toStation.code

  const handleGo = useCallback(() => {
    if (fromStation && toStation) {
      onGo(fromStation, toStation, walkTime)
    }
  }, [fromStation, toStation, walkTime, onGo])

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm">
      {/* All inputs in one row on desktop */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
        {/* From */}
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            From
          </label>
          <StationSelector
            field="from"
            value={fromStation}
            onChange={setFromStation}
            stations={stations}
            placeholder="Origin..."
          />
        </div>

        {/* To */}
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            To
          </label>
          <StationSelector
            field="to"
            value={toStation}
            onChange={setToStation}
            stations={stations}
            placeholder="Destination..."
          />
        </div>

        {/* Walk time */}
        <div className="shrink-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            Walk
          </label>
          <select
            value={walkTime}
            onChange={(e) => setWalkTime(Number(e.target.value))}
            className="w-full lg:w-24 px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map(min => (
              <option key={min} value={min}>{min} min</option>
            ))}
          </select>
        </div>

        {/* Go button */}
        <button
          onClick={handleGo}
          disabled={!canGo || isLoading}
          className="shrink-0 px-6 py-2 bg-[#E31837] text-white font-semibold rounded hover:bg-[#c41430] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          <ArrowRight className="w-5 h-5" />
          {isLoading ? 'Loading...' : 'Go'}
        </button>
      </div>

      {/* Transfer info inline */}
      {transferName && (
        <div className="mt-3 pt-3 border-t border-[var(--border-color)] flex items-center gap-2 text-[var(--text-primary)]">
          <Repeat className="w-4 h-4 text-[var(--text-secondary)]" />
          <span className="text-sm">
            <span className="text-[var(--text-secondary)]">Transfer at:</span>
            <span className="font-semibold ml-1.5">{transferName}</span>
          </span>
        </div>
      )}
    </div>
  )
}
