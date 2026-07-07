import { useSyncExternalStore } from 'react'

// One shared interval for every subscriber — leaf components can tick without
// each spinning up their own timer.
type Listener = () => void
const listeners = new Set<Listener>()
let interval: ReturnType<typeof setInterval> | null = null

function subscribe(listener: Listener) {
  listeners.add(listener)
  if (!interval) {
    interval = setInterval(() => {
      listeners.forEach(l => l())
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && interval) {
      clearInterval(interval)
      interval = null
    }
  }
}

/**
 * Current time, updated once per second, rounded to `granularityMs`.
 * Rounding means a component using useNow(60_000) only re-renders
 * when the minute changes.
 */
export function useNow(granularityMs = 1000): number {
  return useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / granularityMs) * granularityMs
  )
}
