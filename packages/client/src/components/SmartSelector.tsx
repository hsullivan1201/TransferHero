import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X, MapPin, Navigation } from 'lucide-react'
import type { Station, PlaceResult } from '@transferhero/shared'
import { LineDots } from './LineDot'
import { useDestinationSearch } from '../hooks/useDestination'

export type SmartSelection =
  | { type: 'station'; station: Station }
  | { type: 'place'; place: PlaceResult }
  | { type: 'location'; place: PlaceResult } // from geolocation

interface SmartSelectorProps {
  field: 'from' | 'to'
  value: SmartSelection | null
  onChange: (selection: SmartSelection | null) => void
  stations: Station[]
  placeholder?: string
  showCurrentLocation?: boolean
}

export function SmartSelector({
  field,
  value,
  onChange,
  stations,
  placeholder,
  showCurrentLocation = false,
}: SmartSelectorProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // debounce for place search
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  // local station filtering (instant)
  const stationMatches = useMemo(() => {
    if (query.length === 0) return []
    return stations
      .filter(
        (s) =>
          s.name.toLowerCase().includes(query.toLowerCase()) ||
          s.code.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 10)
  }, [query, stations])

  // server place search (debounced, only when station matches are sparse)
  const shouldSearchPlaces = debouncedQuery.length >= 2 && stationMatches.length < 3
  const { data: placeResults = [], isFetching: placesLoading } =
    useDestinationSearch(debouncedQuery, shouldSearchPlaces)

  // combined items for keyboard nav
  type DropdownItem =
    | { kind: 'station'; station: Station }
    | { kind: 'place'; place: PlaceResult }
    | { kind: 'location' }

  const items: DropdownItem[] = useMemo(() => {
    const result: DropdownItem[] = []
    // current location option when empty
    if (showCurrentLocation && query.length === 0) {
      result.push({ kind: 'location' })
    }
    for (const s of stationMatches) {
      result.push({ kind: 'station', station: s })
    }
    for (const p of placeResults) {
      result.push({ kind: 'place', place: p })
    }
    return result
  }, [stationMatches, placeResults, showCurrentLocation, query])

  const handleSelectStation = useCallback(
    (station: Station) => {
      onChange({ type: 'station', station })
      setQuery('')
      setIsOpen(false)
      setActiveIndex(-1)
    },
    [onChange]
  )

  const handleSelectPlace = useCallback(
    (place: PlaceResult) => {
      onChange({ type: 'place', place })
      setQuery('')
      setIsOpen(false)
      setActiveIndex(-1)
    },
    [onChange]
  )

  const handleUseLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoError('Location is not supported by this browser')
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        onChange({
          type: 'location',
          place: {
            id: '__current_location__',
            name: 'Current Location',
            context: `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`,
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
          },
        })
        setQuery('')
        setIsOpen(false)
        setActiveIndex(-1)
      },
      (err) => {
        setLocating(false)
        console.error('Geolocation error:', err)
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Location access denied — check browser permissions'
            : 'Could not get your location — try again'
        )
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [onChange])

  const handleSelectItem = useCallback(
    (item: DropdownItem) => {
      if (item.kind === 'station') handleSelectStation(item.station)
      else if (item.kind === 'place') handleSelectPlace(item.place)
      else handleUseLocation()
    },
    [handleSelectStation, handleSelectPlace, handleUseLocation]
  )

  const handleClear = useCallback(() => {
    onChange(null)
    setQuery('')
    inputRef.current?.focus()
  }, [onChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || items.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((prev) => (prev < items.length - 1 ? prev + 1 : prev))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1))
          break
        case 'Enter':
          e.preventDefault()
          if (activeIndex >= 0 && activeIndex < items.length) {
            handleSelectItem(items[activeIndex])
          }
          break
        case 'Escape':
          setIsOpen(false)
          setActiveIndex(-1)
          break
      }
    },
    [isOpen, items, activeIndex, handleSelectItem]
  )

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const activeElement = listRef.current.children[activeIndex] as HTMLElement
      activeElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  // selected value chip
  if (value) {
    const isPlace = value.type === 'place' || value.type === 'location'
    return (
      <div
        className="flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
        onClick={handleClear}
      >
        {isPlace ? (
          value.type === 'location' ? (
            <Navigation className="w-4 h-4 text-blue-500 shrink-0" />
          ) : (
            <MapPin className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
          )
        ) : (
          <LineDots lines={value.station.lines} />
        )}
        <span className="flex-1 font-medium text-[var(--text-primary)] text-base truncate">
          {isPlace ? value.place.name : value.station.name}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleClear()
          }}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Clear selection"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    )
  }

  const showDropdown = isOpen && (items.length > 0 || placesLoading || (showCurrentLocation && query.length === 0))
  const defaultPlaceholder = placeholder || (field === 'from' ? 'Station or place...' : 'Station or place...')

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIsOpen(true)
          setActiveIndex(-1)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={defaultPlaceholder}
        className="w-full px-4 py-2.5 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[var(--text-primary)] text-base placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
        aria-label={`${field === 'from' ? 'Origin' : 'Destination'} station or place`}
        aria-expanded={isOpen}
        aria-autocomplete="list"
      />

      {showDropdown && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 z-50 bg-[var(--suggestion-bg)] border border-[var(--border-color)] border-t-0 rounded-b-md max-h-72 overflow-y-auto shadow-lg"
          role="listbox"
        >
          {/* Current location option (From field only, shown when empty) */}
          {showCurrentLocation && query.length === 0 && (
            <div
              role="option"
              aria-selected={activeIndex === 0}
              className={`flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-[var(--border-color)] transition-colors ${
                activeIndex === 0 ? 'bg-[var(--suggestion-hover)]' : 'hover:bg-[var(--suggestion-hover)]'
              }`}
              onMouseDown={handleUseLocation}
              onMouseEnter={() => setActiveIndex(0)}
            >
              <Navigation className="w-4 h-4 text-blue-500 shrink-0" />
              <span className="text-[var(--text-primary)] text-base">
                {locating ? 'Locating...' : 'Use current location'}
              </span>
            </div>
          )}

          {/* Station matches */}
          {stationMatches.length > 0 && (
            <>
              {stationMatches.map((station, i) => {
                const idx = showCurrentLocation && query.length === 0 ? i + 1 : i
                return (
                  <div
                    key={station.code}
                    role="option"
                    aria-selected={idx === activeIndex}
                    className={`flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-[var(--border-color)] last:border-b-0 transition-colors ${
                      idx === activeIndex ? 'bg-[var(--suggestion-hover)]' : 'hover:bg-[var(--suggestion-hover)]'
                    }`}
                    onMouseDown={() => handleSelectStation(station)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <LineDots lines={station.lines} size="sm" />
                    <span className="text-[var(--text-primary)] text-base">{station.name}</span>
                  </div>
                )
              })}
            </>
          )}

          {/* Divider between stations and places */}
          {stationMatches.length > 0 && placeResults.length > 0 && (
            <div className="px-4 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
              <span className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                Places
              </span>
            </div>
          )}

          {/* Place results */}
          {placeResults.map((place, i) => {
            const baseOffset = (showCurrentLocation && query.length === 0 ? 1 : 0) + stationMatches.length
            const realIdx = baseOffset + i
            return (
              <div
                key={place.id}
                role="option"
                aria-selected={realIdx === activeIndex}
                className={`flex items-center gap-2 px-4 py-3 cursor-pointer border-b border-[var(--border-color)] last:border-b-0 transition-colors ${
                  realIdx === activeIndex ? 'bg-[var(--suggestion-hover)]' : 'hover:bg-[var(--suggestion-hover)]'
                }`}
                onMouseDown={() => handleSelectPlace(place)}
                onMouseEnter={() => setActiveIndex(realIdx)}
              >
                <MapPin className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[var(--text-primary)] text-base truncate">{place.name}</div>
                  {place.context && (
                    <div className="text-sm text-[var(--text-secondary)] truncate">{place.context}</div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Loading indicator for places */}
          {placesLoading && (
            <div className="px-4 py-3 text-sm text-[var(--text-secondary)]">Searching places...</div>
          )}
        </div>
      )}

      {geoError && (
        <p role="alert" className="mt-1.5 text-sm text-red-500">{geoError}</p>
      )}
    </div>
  )
}
