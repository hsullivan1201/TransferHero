import { useState, useEffect, useCallback } from 'react'
import type { PlaceResult, Line } from '@transferhero/shared'
import type { SmartSelection } from '../components/SmartSelector'

export interface SavedTripSelection {
  type: 'station' | 'place'
  station?: { code: string; name: string; lines: Line[] }
  place?: PlaceResult
}

export interface SavedTrip {
  id: string
  label: string
  from: SavedTripSelection
  to: SavedTripSelection
  walkTime: number
  savedAt: number
}

interface SavedTripsStore {
  version: 1
  trips: SavedTrip[]
}

const STORAGE_KEY = 'transferhero-saved-trips'
const MAX_SAVED_TRIPS = 20

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try { return crypto.randomUUID() } catch { /* non-secure context */ }
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function migrate(raw: unknown): SavedTripsStore {
  if (raw && typeof raw === 'object' && 'version' in raw && 'trips' in raw) {
    return raw as SavedTripsStore
  }
  return { version: 1, trips: [] }
}

function displayName(sel: SavedTripSelection): string {
  if (sel.type === 'station' && sel.station) return sel.station.name
  if (sel.place) return sel.place.name
  return '?'
}

function selectionToSaved(sel: SmartSelection): SavedTripSelection {
  if (sel.type === 'station') {
    return { type: 'station', station: { code: sel.station.code, name: sel.station.name, lines: sel.station.lines } }
  }
  // Both 'place' and 'location' save as 'place'
  return { type: 'place', place: sel.place }
}

export function savedToSelection(saved: SavedTripSelection): SmartSelection {
  if (saved.type === 'station' && saved.station) {
    return { type: 'station', station: saved.station }
  }
  if (saved.place) {
    return { type: 'place', place: saved.place }
  }
  throw new Error('Invalid saved selection')
}

function isSameRoute(a: { from: SavedTripSelection; to: SavedTripSelection }, b: { from: SavedTripSelection; to: SavedTripSelection }): boolean {
  return selectionKey(a.from) === selectionKey(b.from) && selectionKey(a.to) === selectionKey(b.to)
}

function selectionKey(sel: SavedTripSelection): string {
  if (sel.type === 'station' && sel.station) return `s:${sel.station.code}`
  if (sel.place) return `p:${sel.place.id || `${sel.place.lat},${sel.place.lon}`}`
  return '?'
}

export function useSavedTrips() {
  const [store, setStore] = useState<SavedTripsStore>(() => {
    if (typeof window === 'undefined') return { version: 1, trips: [] }
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return { version: 1, trips: [] }
      return migrate(JSON.parse(raw))
    } catch {
      return { version: 1, trips: [] }
    }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  }, [store])

  const saveTrip = useCallback((from: SmartSelection, to: SmartSelection, walkTime: number) => {
    const fromSaved = selectionToSaved(from)
    const toSaved = selectionToSaved(to)
    const label = `${displayName(fromSaved)} → ${displayName(toSaved)}`

    const newTrip: SavedTrip = {
      id: generateId(),
      label,
      from: fromSaved,
      to: toSaved,
      walkTime,
      savedAt: Date.now(),
    }

    setStore(prev => {
      const filtered = prev.trips.filter(t => !isSameRoute(t, newTrip))
      const trips = [newTrip, ...filtered].slice(0, MAX_SAVED_TRIPS)
      return { ...prev, trips }
    })
  }, [])

  const deleteTrip = useCallback((id: string) => {
    setStore(prev => ({
      ...prev,
      trips: prev.trips.filter(t => t.id !== id),
    }))
  }, [])

  const isSaved = useCallback((from: SmartSelection | null, to: SmartSelection | null): boolean => {
    if (!from || !to) return false
    const fromSaved = selectionToSaved(from)
    const toSaved = selectionToSaved(to)
    return store.trips.some(t => isSameRoute(t, { from: fromSaved, to: toSaved }))
  }, [store.trips])

  return {
    savedTrips: store.trips,
    saveTrip,
    deleteTrip,
    isSaved,
  }
}
