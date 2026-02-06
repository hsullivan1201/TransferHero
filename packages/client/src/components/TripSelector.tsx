import { useState, useCallback, useEffect } from 'react'
import { ArrowRight } from 'lucide-react'
import type { Station, TransferResult, TransferAlternative, PlaceContext, PlaceResult, ResolveResponse } from '@transferhero/shared'
import { SmartSelector, type SmartSelection } from './SmartSelector'
import { DestinationBanner } from './DestinationBanner'
import { TransferDisplay } from './TransferDisplay'
import { useDestinationResolve } from '../hooks/useDestination'

type WalkingAlt = NonNullable<PlaceContext['alternatives']>[number]

function buildPlaceContext(
  place: PlaceResult,
  resolved: ResolveResponse,
  override: WalkingAlt | null,
  direction: 'to_station' | 'from_station'
): PlaceContext {
  if (override) {
    // Swap: selected alt becomes main, original main joins the alternatives list
    const alts = [
      { station: resolved.station, exit: resolved.exit, walkTimeMinutes: resolved.walkTimeMinutes, walkDistanceMeters: resolved.walkDistanceMeters },
      ...resolved.alternatives.filter(a => a.station.code !== override.station.code),
    ]
    return {
      place,
      station: override.station,
      exit: override.exit,
      walkTimeMinutes: override.walkTimeMinutes,
      walkDistanceMeters: override.walkDistanceMeters,
      direction,
      alternatives: alts,
    }
  }
  return {
    place,
    station: resolved.station,
    exit: resolved.exit,
    walkTimeMinutes: resolved.walkTimeMinutes,
    walkDistanceMeters: resolved.walkDistanceMeters,
    direction,
    alternatives: resolved.alternatives,
  }
}

interface TripSelectorProps {
  stations: Station[]
  onGo: (from: Station, to: Station, walkTime: number) => void
  isLoading?: boolean
  transfer?: TransferResult | null
  onSelectAlternative?: (alternative: TransferAlternative | null) => void
  selectedAlternativeIndex?: number
  onOriginPlaceContext?: (ctx: PlaceContext | null) => void
  onDestPlaceContext?: (ctx: PlaceContext | null) => void
}

export function TripSelector({
  stations,
  onGo,
  isLoading,
  transfer,
  onSelectAlternative,
  selectedAlternativeIndex = -1,
  onOriginPlaceContext,
  onDestPlaceContext,
}: TripSelectorProps) {
  const [fromSelection, setFromSelection] = useState<SmartSelection | null>(null)
  const [toSelection, setToSelection] = useState<SmartSelection | null>(null)
  const [walkTime, setWalkTime] = useState(2)

  // station override when user picks an alternative walking station
  const [originOverride, setOriginOverride] = useState<WalkingAlt | null>(null)
  const [destOverride, setDestOverride] = useState<WalkingAlt | null>(null)

  // resolve place selections to stations
  const fromPlace = fromSelection && fromSelection.type !== 'station' ? fromSelection.place : null
  const toPlace = toSelection && toSelection.type !== 'station' ? toSelection.place : null

  const { data: fromResolved } = useDestinationResolve(fromPlace?.lat ?? null, fromPlace?.lon ?? null)
  const { data: toResolved } = useDestinationResolve(toPlace?.lat ?? null, toPlace?.lon ?? null)

  // reset overrides when the place selection changes
  useEffect(() => { setOriginOverride(null) }, [fromPlace?.id])
  useEffect(() => { setDestOverride(null) }, [toPlace?.id])

  // derive the actual stations from selections, respecting overrides
  const fromStation: Station | null =
    fromSelection?.type === 'station'
      ? fromSelection.station
      : originOverride?.station ?? fromResolved?.station ?? null

  const toStation: Station | null =
    toSelection?.type === 'station'
      ? toSelection.station
      : destOverride?.station ?? toResolved?.station ?? null

  // build and propagate place contexts
  useEffect(() => {
    if (fromPlace && fromResolved) {
      onOriginPlaceContext?.(buildPlaceContext(fromPlace, fromResolved, originOverride, 'to_station'))
    } else {
      onOriginPlaceContext?.(null)
    }
  }, [fromPlace?.id, fromResolved?.station?.code, originOverride?.station.code])

  useEffect(() => {
    if (toPlace && toResolved) {
      onDestPlaceContext?.(buildPlaceContext(toPlace, toResolved, destOverride, 'from_station'))
    } else {
      onDestPlaceContext?.(null)
    }
  }, [toPlace?.id, toResolved?.station?.code, destOverride?.station.code])

  const canGo = fromStation && toStation && fromStation.code !== toStation.code

  const handleGo = useCallback(() => {
    if (fromStation && toStation) {
      onGo(fromStation, toStation, walkTime)
    }
  }, [fromStation, toStation, walkTime, onGo])

  const handleOriginAlt = useCallback((alt: WalkingAlt) => {
    setOriginOverride(alt)
  }, [])

  const handleDestAlt = useCallback((alt: WalkingAlt) => {
    setDestOverride(alt)
  }, [])

  // build place contexts for banner display
  const originPlaceContext: PlaceContext | null =
    fromPlace && fromResolved
      ? buildPlaceContext(fromPlace, fromResolved, originOverride, 'to_station')
      : null

  const destPlaceContext: PlaceContext | null =
    toPlace && toResolved
      ? buildPlaceContext(toPlace, toResolved, destOverride, 'from_station')
      : null

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm">
      {/* All inputs in one row on desktop */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
        {/* From */}
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            From
          </label>
          <SmartSelector
            field="from"
            value={fromSelection}
            onChange={setFromSelection}
            stations={stations}
            placeholder="Origin..."
            showCurrentLocation
          />
          {originPlaceContext && (
            <div className="mt-1.5">
              <DestinationBanner
                context={originPlaceContext}
                isLocation={fromSelection?.type === 'location'}
                onSelectAlternative={handleOriginAlt}
              />
            </div>
          )}
        </div>

        {/* To */}
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            To
          </label>
          <SmartSelector
            field="to"
            value={toSelection}
            onChange={setToSelection}
            stations={stations}
            placeholder="Destination..."
          />
          {destPlaceContext && (
            <div className="mt-1.5">
              <DestinationBanner
                context={destPlaceContext}
                onSelectAlternative={handleDestAlt}
              />
            </div>
          )}
        </div>

        {/* Walk time */}
        <div className="shrink-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            Transfer walk
          </label>
          <select
            value={walkTime}
            onChange={(e) => setWalkTime(Number(e.target.value))}
            className="w-full lg:w-24 px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[1, 2, 3, 4, 5].map((min) => (
              <option key={min} value={min}>
                {min} min
              </option>
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

      {/* Transfer Display - shows transfer station with alternatives */}
      {transfer && !transfer.direct && onSelectAlternative && (
        <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
          <TransferDisplay
            transfer={transfer}
            onSelectAlternative={onSelectAlternative}
            selectedIndex={selectedAlternativeIndex}
          />
        </div>
      )}
    </div>
  )
}
