import { useState, useCallback } from 'react'

export function readPersisted<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

export function writePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full or unavailable — state still works for this session
  }
}

/**
 * useState backed by localStorage. Reads once on mount, writes through on set.
 * Values must be JSON-serializable.
 */
export function usePersistedState<T>(key: string, defaultValue: T) {
  const [value, setValue] = useState<T>(() => readPersisted(key, defaultValue))

  const setAndPersist = useCallback((next: T | ((prev: T) => T)) => {
    setValue(prev => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next
      writePersisted(key, resolved)
      return resolved
    })
  }, [key])

  return [value, setAndPersist] as const
}
