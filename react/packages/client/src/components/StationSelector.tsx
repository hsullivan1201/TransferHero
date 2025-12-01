import { useState, useRef, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import type { Station } from '@transferhero/shared'
import { LineDots } from './LineDot'

interface StationSelectorProps {
  field: 'from' | 'to'
  value: Station | null
  onChange: (station: Station | null) => void
  stations: Station[]
  placeholder?: string
}

export function StationSelector({
  field,
  value,
  onChange,
  stations,
  placeholder = 'Search stations...'
}: StationSelectorProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filteredStations = query.length > 0
    ? stations.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.code.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10)
    : []

  const handleSelect = useCallback((station: Station) => {
    onChange(station)
    setQuery('')
    setIsOpen(false)
    setActiveIndex(-1)
  }, [onChange])

  const handleClear = useCallback(() => {
    onChange(null)
    setQuery('')
    inputRef.current?.focus()
  }, [onChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || filteredStations.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex(prev =>
          prev < filteredStations.length - 1 ? prev + 1 : prev
        )
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex(prev => prev > 0 ? prev - 1 : -1)
        break
      case 'Enter':
        e.preventDefault()
        if (activeIndex >= 0 && activeIndex < filteredStations.length) {
          handleSelect(filteredStations[activeIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        setActiveIndex(-1)
        break
    }
  }, [isOpen, filteredStations, activeIndex, handleSelect])

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const activeElement = listRef.current.children[activeIndex] as HTMLElement
      activeElement?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex])

  if (value) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
        onClick={handleClear}
      >
        <LineDots lines={value.lines} />
        <span className="flex-1 font-medium text-[var(--text-primary)]">{value.name}</span>
        <button
          onClick={(e) => { e.stopPropagation(); handleClear() }}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Clear selection"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setIsOpen(e.target.value.length > 0)
          setActiveIndex(-1)
        }}
        onFocus={() => query.length > 0 && setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--border-color)] rounded-md text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
        aria-label={`${field === 'from' ? 'Origin' : 'Destination'} station`}
        aria-expanded={isOpen}
        aria-autocomplete="list"
      />

      {isOpen && filteredStations.length > 0 && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 z-50 bg-[var(--suggestion-bg)] border border-[var(--border-color)] border-t-0 rounded-b-md max-h-64 overflow-y-auto shadow-lg"
          role="listbox"
        >
          {filteredStations.map((station, index) => (
            <div
              key={station.code}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-[var(--border-color)] last:border-b-0 transition-colors ${
                index === activeIndex
                  ? 'bg-[var(--suggestion-hover)]'
                  : 'hover:bg-[var(--suggestion-hover)]'
              }`}
              onMouseDown={() => handleSelect(station)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              <LineDots lines={station.lines} size="sm" />
              <span className="text-[var(--text-primary)]">{station.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
