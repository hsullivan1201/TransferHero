import type { PlaceResult } from '@transferhero/shared'
import { fetchWithTimeout } from '../utils/http.js'

// read lazily — dotenv.config() runs after ESM imports resolve
function getApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY || ''
}
const DC_CENTER = { lat: 38.9072, lng: -77.0369 }
const BIAS_RADIUS_M = 30000 // 30km
const GOOGLE_PLACES_TIMEOUT_MS = 6_000

// simple cache with periodic cleanup (avoids O(n) scan on every write)
const cache = new Map<string, { results: PlaceResult[]; ts: number }>()
const CACHE_TTL_MS = 120_000 // 2 minutes
const CACHE_MAX_SIZE = 500

// Periodic stale-entry cleanup instead of per-write iteration
const geocodingCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (now - entry.ts > CACHE_TTL_MS) cache.delete(key)
  }
}, 60_000)
geocodingCleanupTimer.unref?.()

function evictIfOverCapacity() {
  if (cache.size > CACHE_MAX_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
}

export function isGeocodingEnabled(): boolean {
  return getApiKey().length > 0
}

/**
 * Search for places using Google Places API (New) - Text Search.
 * Returns simplified results biased toward DC.
 */
export async function searchPlaces(query: string, sessionToken?: string): Promise<PlaceResult[]> {
  if (!isGeocodingEnabled()) return []

  const cacheKey = query.toLowerCase().trim()
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.results
  }

  try {
    const response = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
      timeoutMs: GOOGLE_PLACES_TIMEOUT_MS,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': getApiKey(),
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location',
      },
      body: JSON.stringify({
        textQuery: query,
        ...(sessionToken ? { sessionToken } : {}),
        locationBias: {
          circle: {
            center: { latitude: DC_CENTER.lat, longitude: DC_CENTER.lng },
            radius: BIAS_RADIUS_M,
          },
        },
        maxResultCount: 6,
        languageCode: 'en',
      }),
    })

    if (!response.ok) {
      console.error(`[Geocoding] Google Places returned ${response.status}`)
      return []
    }

    const data: any = await response.json()
    const places: PlaceResult[] = (data.places || []).map((p: any) => ({
      id: p.id || '',
      name: p.displayName?.text || '',
      context: p.formattedAddress || '',
      lat: p.location?.latitude || 0,
      lon: p.location?.longitude || 0,
    }))

    evictIfOverCapacity()
    cache.set(cacheKey, { results: places, ts: Date.now() })

    return places
  } catch (err) {
    console.error('[Geocoding] search failed:', err)
    return []
  }
}
