import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowRight, ArrowUpDown, Bookmark, BookmarkCheck } from 'lucide-react'
import type { Station, TransferResult, TransferAlternative, PlaceContext, PlaceResult, ResolveResponse } from '@transferhero/shared'
import { SmartSelector, type SmartSelection } from './SmartSelector'
import { DestinationBanner } from './DestinationBanner'
import { TransferDisplay } from './TransferDisplay'
import { useDestinationResolve } from '../hooks/useDestination'
import { savedToSelection, type SavedTrip } from '../hooks/useSavedTrips'

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
      busOnly: resolved.busOnly,
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
    busOnly: resolved.busOnly,
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
  activeOriginPlaceContext?: PlaceContext | null
  activeDestPlaceContext?: PlaceContext | null
  onSaveTrip?: (from: SmartSelection, to: SmartSelection, walkTime: number) => void
  checkTripSaved?: (from: SmartSelection | null, to: SmartSelection | null) => boolean
  loadTrip?: SavedTrip | null
  onTripLoaded?: () => void
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
  activeOriginPlaceContext,
  activeDestPlaceContext,
  onSaveTrip,
  checkTripSaved,
  loadTrip,
  onTripLoaded,
}: TripSelectorProps) {
  const [fromSelection, setFromSelection] = useState<SmartSelection | null>(null)
  const [toSelection, setToSelection] = useState<SmartSelection | null>(null)
  const [walkTime, setWalkTime] = useState(2)
  const [swapFxTick, setSwapFxTick] = useState(0)
  const [showSwapFx, setShowSwapFx] = useState(false)

  // station override when user picks an alternative walking station
  const [originOverride, setOriginOverride] = useState<WalkingAlt | null>(null)
  const [destOverride, setDestOverride] = useState<WalkingAlt | null>(null)

  // Load a saved trip into the selectors
  const lastLoadedId = useRef<string | null>(null)
  useEffect(() => {
    if (loadTrip && loadTrip.id !== lastLoadedId.current) {
      lastLoadedId.current = loadTrip.id
      setFromSelection(savedToSelection(loadTrip.from))
      setToSelection(savedToSelection(loadTrip.to))
      setWalkTime(loadTrip.walkTime)
      setOriginOverride(null)
      setDestOverride(null)
      onTripLoaded?.()
    }
  }, [loadTrip?.id])

  // resolve place selections to stations
  const fromPlace = fromSelection && fromSelection.type !== 'station' ? fromSelection.place : null
  const toPlace = toSelection && toSelection.type !== 'station' ? toSelection.place : null

  const { data: fromResolved, error: fromResolveError } = useDestinationResolve(fromPlace?.lat ?? null, fromPlace?.lon ?? null)
  const { data: toResolved, error: toResolveError } = useDestinationResolve(toPlace?.lat ?? null, toPlace?.lon ?? null)

  // Place/resolve change: reset override and build context in one pass (no cascade)
  useEffect(() => {
    setOriginOverride(null)
    if (fromPlace && fromResolved) {
      onOriginPlaceContext?.(buildPlaceContext(fromPlace, fromResolved, null, 'to_station'))
    } else {
      onOriginPlaceContext?.(null)
    }
  }, [fromPlace?.id, fromResolved?.station?.code])

  useEffect(() => {
    setDestOverride(null)
    if (toPlace && toResolved) {
      onDestPlaceContext?.(buildPlaceContext(toPlace, toResolved, null, 'from_station'))
    } else {
      onDestPlaceContext?.(null)
    }
  }, [toPlace?.id, toResolved?.station?.code])

  // Override-only change: rebuild context with the selected alternative
  useEffect(() => {
    if (originOverride && fromPlace && fromResolved) {
      onOriginPlaceContext?.(buildPlaceContext(fromPlace, fromResolved, originOverride, 'to_station'))
    }
  }, [originOverride?.station.code])

  useEffect(() => {
    if (destOverride && toPlace && toResolved) {
      onDestPlaceContext?.(buildPlaceContext(toPlace, toResolved, destOverride, 'from_station'))
    }
  }, [destOverride?.station.code])

  // derive the actual stations from selections, respecting overrides
  const fromStation: Station | null =
    fromSelection?.type === 'station'
      ? fromSelection.station
      : originOverride?.station ?? fromResolved?.station ?? null

  const toStation: Station | null =
    toSelection?.type === 'station'
      ? toSelection.station
      : destOverride?.station ?? toResolved?.station ?? null

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

  const handleSwap = useCallback(() => {
    setFromSelection(toSelection)
    setToSelection(fromSelection)
    setOriginOverride(null)
    setDestOverride(null)
    onSelectAlternative?.(null)
    setSwapFxTick((tick) => tick + 1)
  }, [fromSelection, toSelection, onSelectAlternative])

  useEffect(() => {
    if (swapFxTick === 0) return

    setShowSwapFx(true)
    const timer = setTimeout(() => {
      setShowSwapFx(false)
    }, 170)

    return () => clearTimeout(timer)
  }, [swapFxTick])

  // build place contexts for banner display
  // prefer active contexts from tripState (kept in sync by WalkingCard alt selections)
  const localOriginPlaceContext: PlaceContext | null =
    fromPlace && fromResolved
      ? buildPlaceContext(fromPlace, fromResolved, originOverride, 'to_station')
      : null

  const localDestPlaceContext: PlaceContext | null =
    toPlace && toResolved
      ? buildPlaceContext(toPlace, toResolved, destOverride, 'from_station')
      : null

  const originPlaceContext = activeOriginPlaceContext ?? localOriginPlaceContext
  const destPlaceContext = activeDestPlaceContext ?? localDestPlaceContext

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-4 shadow-sm">
      {/* All inputs in one row on desktop */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-end">
        {/* From */}
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            From
          </label>
          <div
            className={`rounded-md transition-shadow duration-150 ${showSwapFx ? 'ring-2 ring-[#E31837]/30 ring-offset-1 ring-offset-transparent' : ''}`}
          >
            <SmartSelector
              field="from"
              value={fromSelection}
              onChange={setFromSelection}
              stations={stations}
              placeholder="Origin..."
              showCurrentLocation
            />
          </div>
          {fromResolveError && (
            <p className="mt-1.5 text-sm text-red-500">No stations within walking distance</p>
          )}
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

        {/* Swap */}
        <div className="shrink-0 self-center lg:self-end lg:pb-2">
          <button
            type="button"
            onClick={handleSwap}
            disabled={!fromSelection && !toSelection}
            className={`w-11 h-11 rounded-full border border-[var(--border-color)] bg-[var(--input-bg)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 flex items-center justify-center ${showSwapFx ? 'bg-[#E31837]/10 border-[#E31837] text-[#E31837]' : ''}`}
            aria-label="Swap origin and destination"
            data-testid="swap-trip-direction"
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>

        {/* To */}
        <div className="flex-1 min-w-0">
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-1.5">
            To
          </label>
          <div
            className={`rounded-md transition-shadow duration-150 ${showSwapFx ? 'ring-2 ring-[#E31837]/30 ring-offset-1 ring-offset-transparent' : ''}`}
          >
            <SmartSelector
              field="to"
              value={toSelection}
              onChange={setToSelection}
              stations={stations}
              placeholder="Destination..."
            />
          </div>
          {toResolveError && (
            <p className="mt-1.5 text-sm text-red-500">No stations within walking distance</p>
          )}
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

        {/* Go + Save buttons */}
        <div className="shrink-0 flex gap-2">
          <button
            onClick={handleGo}
            disabled={!canGo || isLoading}
            className="flex-1 lg:flex-none px-6 py-2 bg-[#E31837] text-white font-semibold rounded hover:bg-[#c41430] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            <ArrowRight className="w-5 h-5" />
            {isLoading ? 'Loading...' : 'Go'}
          </button>
          {onSaveTrip && (
            <button
              onClick={() => fromSelection && toSelection && onSaveTrip(fromSelection, toSelection, walkTime)}
              disabled={!canGo}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded border border-[var(--border-color)] text-[var(--text-secondary)] active:text-[#E31837] active:border-[#E31837] hover:text-[#E31837] hover:border-[#E31837] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label={checkTripSaved?.(fromSelection, toSelection) ? 'Trip saved' : 'Save trip'}
            >
              {checkTripSaved?.(fromSelection, toSelection)
                ? <BookmarkCheck className="w-5 h-5 text-[#E31837]" />
                : <Bookmark className="w-5 h-5" />
              }
            </button>
          )}
        </div>
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
