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
