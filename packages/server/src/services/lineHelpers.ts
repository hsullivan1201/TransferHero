import type { Line } from '@transferhero/shared'
import { LINE_STATIONS } from '../data/lineConfig.js'
import { PLATFORM_CODES, normalizePlatformCode } from '../data/platformCodes.js'

/**
 * get all lines that serve the origin and can reach the transfer platform.
 * interlined origins (like OR/SV at new carrollton) get the full menu.
 */
export function getInterlinesForLeg1(fromStation: { lines: Line[] }, fromPlatform: string): Line[] | undefined {
  const validLines = fromStation.lines.filter(line => {
    const stationsOnLine = LINE_STATIONS[line]
    if (!stationsOnLine) return false
    const normalizedPlatform = normalizePlatformCode(fromPlatform, stationsOnLine)
    return stationsOnLine.includes(normalizedPlatform)
  })

  return validLines.length > 0 ? validLines : undefined
}

/**
 * get all lines that share a transfer platform and still serve the destination.
 * interlined segments (OR/SV/BL at metro center, etc.) get the full list.
 */
export function getInterlinesForLeg2(toPlatform: string, toStation: { lines: Line[] }): Line[] | undefined {
  const platformConfig = PLATFORM_CODES[toPlatform]
  if (!platformConfig) return undefined

  const linesOnPlatform = Object.entries(platformConfig)
    .filter(([_, code]) => code === toPlatform)
    .map(([line]) => line as Line)

  if (linesOnPlatform.length === 0) return undefined

  const validLines = linesOnPlatform.filter(line => toStation.lines.includes(line))
  return validLines.length > 0 ? validLines : undefined
}

/**
 * get a single terminus string from an array—car position service wants one value
 */
export function getTerminusString(terminus: string | string[]): string {
  if (Array.isArray(terminus)) {
    return terminus[0] || ''
  }
  return terminus
}
