/**
 * Build a platform-aware "Open in Maps" URL for walking directions.
 */
export function buildMapsUrl(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number
): string {
  // iOS Safari → Apple Maps
  if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return `maps://maps.apple.com/?saddr=${fromLat},${fromLon}&daddr=${toLat},${toLon}&dirflg=w`
  }
  // everything else → Google Maps
  return `https://www.google.com/maps/dir/?api=1&origin=${fromLat},${fromLon}&destination=${toLat},${toLon}&travelmode=walking`
}

/**
 * Format meters into a human-readable distance string.
 */
export function formatDistance(meters: number): string {
  if (meters < 160) return `${Math.round(meters)} m`
  const miles = meters / 1609.34
  return `${miles.toFixed(1)} mi`
}
