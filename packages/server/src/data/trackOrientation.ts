/** Which way an arriving train faces in a station's platform diagram. */

import type { Line } from '@transferhero/shared'
import type { Platform } from './carPositionService.js'
import { LINE_PATHS } from './lineConfig.js'
import { normalizePlatformCode } from './platformCodes.js'
import { ALL_STATIONS } from './stations.js'

export type TrackDirection = 'track1' | 'track2'

/** The station a train is being oriented at, and the line it is running on. */
export interface TrackContext {
  stationCode: string
  line: string
}

const trackDestsLower = new WeakMap<Platform, { track1: string[]; track2: string[] }>()

function getLowerTrackDestinations(platform: Platform): { track1: string[]; track2: string[] } {
  let cached = trackDestsLower.get(platform)
  if (!cached) {
    cached = {
      track1: platform.track1Destinations.map(d => d.toLowerCase()),
      track2: platform.track2Destinations.map(d => d.toLowerCase()),
    }
    trackDestsLower.set(platform, cached)
  }
  return cached
}

const normalizeStationName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Resolve a terminus or diagram label (e.g. "Largo" for Downtown Largo) to a station code. */
function findStationCodeByName(name: string): string | undefined {
  const normalized = normalizeStationName(name)
  if (!normalized) return undefined
  const station = ALL_STATIONS.find(s => normalizeStationName(s.name) === normalized)
    ?? ALL_STATIONS.find(s => normalizeStationName(s.name).endsWith(normalized))
  return station?.code
}

/**
 * Orient a train by which way its destination lies along the line, using the
 * diagram labels only to learn which way each track faces.
 */
function getTrackByLineGeometry(
  platform: Platform,
  destination: string,
  { stationCode, line }: TrackContext
): TrackDirection | null {
  const destinationCode = findStationCodeByName(destination)
  if (!destinationCode) return null

  for (const path of LINE_PATHS[line as Line] ?? []) {
    const here = path.indexOf(normalizePlatformCode(stationCode, path))
    const there = path.indexOf(normalizePlatformCode(destinationCode, path))
    if (here < 0 || there < 0 || here === there) continue
    const heading = Math.sign(there - here)

    for (const track of ['track1', 'track2'] as const) {
      const labels = track === 'track1' ? platform.track1Destinations : platform.track2Destinations
      for (const label of labels) {
        const labelCode = findStationCodeByName(label)
        const index = labelCode ? path.indexOf(normalizePlatformCode(labelCode, path)) : -1
        if (index < 0 || index === here) continue
        const labelIsAhead = Math.sign(index - here) === heading
        return labelIsAhead === (track === 'track1') ? 'track1' : 'track2'
      }
    }
  }

  return null
}

/** Determine the arriving train's orientation in the station's diagram. */
export function getTrackDirection(
  platform: Platform,
  destination: string,
  context?: TrackContext
): TrackDirection {
  // Terminal diagrams face both tracks into the station. Their destination
  // labels can be identical, so use the diagram's inbound orientation before
  // matching labels; car and door numbers must not reflect the return trip.
  if (platform.platformType === 'terminus_eb') return 'track2'
  if (platform.platformType === 'terminus_wb') return 'track1'

  const destLower = destination.toLowerCase()
  const { track1, track2 } = getLowerTrackDestinations(platform)

  for (const dLower of track1) {
    if (destLower.includes(dLower) || dLower.includes(destLower)) {
      return 'track1'
    }
  }

  for (const dLower of track2) {
    if (destLower.includes(dLower) || dLower.includes(destLower)) {
      return 'track2'
    }
  }

  // Short turns ("Fort Totten", "Pentagon City") aren't diagram labels. A blind
  // track 1 default mirrors every exit for trains headed the other way.
  return (context && getTrackByLineGeometry(platform, destination, context)) ?? 'track1'
}
