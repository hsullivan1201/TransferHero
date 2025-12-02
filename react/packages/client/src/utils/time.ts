/**
 * Converts minutes from now to a clock time string
 */
export function minutesToClockTime(minutes: number): string {
  const now = new Date()
  now.setMinutes(now.getMinutes() + minutes)
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * Gets train minutes from Min value (handles ARR/BRD)
 */
export function getTrainMinutes(min: string | number): number {
  if (min === 'ARR' || min === 'BRD') return 0
  return typeof min === 'number' ? min : parseInt(min, 10)
}

/**
 * Format time with seconds precision when under 2 minutes
 * Returns: "1 min 30 sec", "45 sec", or "3 min" depending on time remaining
 */
export function formatTimeWithSeconds(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes >= 2) {
    // 2+ minutes: just show minutes
    return `${minutes} min`
  } else if (minutes === 1) {
    // 1-2 minutes: show "1 min 30 sec"
    return seconds > 0 ? `1 min ${seconds} sec` : '1 min'
  } else if (totalSeconds > 0) {
    // Under 1 minute: show "45 sec"
    return `${totalSeconds} sec`
  } else {
    // 0 or negative
    return 'ARR'
  }
}

/**
 * Get clock time from milliseconds in the future
 */
export function millisecondsToClockTime(milliseconds: number): string {
  const future = new Date(Date.now() + milliseconds)
  return future.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
