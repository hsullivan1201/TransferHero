/**
 * turns minutes-from-now into a friendly clock time
 */
export function minutesToClockTime(minutes: number): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + minutes)
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * translates Min into a number; ARR/BRD count as 0
 */
export function getTrainMinutes(min: string | number): number {
  if (min === 'ARR' || min === 'BRD') return 0
  return typeof min === 'number' ? min : parseInt(min, 10)
}

/**
 * format with seconds when we're under 2 minutes
 * returns things like "1 min 30 sec", "45 sec", or "3 min"
 */
export function formatTimeWithSeconds(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes >= 2) {
    // 2+ min: keep it simple
    return `${minutes} min`
  } else if (minutes === 1) {
    // 1-2 min: show off the seconds
    return seconds > 0 ? `1 min ${seconds} sec` : '1 min'
  } else if (totalSeconds > 0) {
    // under a minute: just seconds
    return `${totalSeconds} sec`
  } else {
    // nothing left; call it ARR
    return 'ARR'
  }
}

/**
 * get clock time from some milliseconds in the future
 */
export function millisecondsToClockTime(milliseconds: number): string {
  const future = new Date(Date.now() + milliseconds)
  return future.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * calc minutes until departure for the chosen train.
 * prefers timestamps over vibes; already-departed returns 0 to dodge negatives.
 */
export function deriveWaitMinutes(
  train?: { Min?: string | number; _departed?: boolean } | null,
  departureTimestamp?: number | null
): number | null {
  if (!train) return null
  if (train._departed) return 0

  if (departureTimestamp) {
    const diff = Math.round((departureTimestamp - Date.now()) / 60000)
    return Math.max(0, diff)
  }

  const min = getTrainMinutes(train.Min ?? 0)
  return Number.isFinite(min) ? Math.max(0, min) : null
}

/**
 * sum up journey parts, ignore the junk, and never go below zero
 */
export function computeTotalMinutes(parts: Array<number | null | undefined>): number {
  const total = parts.reduce((acc, part) => {
    return acc + (typeof part === 'number' && Number.isFinite(part) ? part : 0)
  }, 0)

  return Math.max(0, Math.round(total))
}

/**
 * best-effort arrival clock string:
 * use the provided one, otherwise fake it with now + totalMinutes
 */
export function resolveArrivalClock(totalMinutes: number, arrivalClock?: string | null): string | null {
  if (arrivalClock) return arrivalClock
  if (!Number.isFinite(totalMinutes)) return null
  return minutesToClockTime(totalMinutes)
}
