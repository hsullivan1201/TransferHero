import type { PlaceContext, PlaceResult, ResolveResponse } from '@transferhero/shared'

const API_BASE = '/api'

export async function searchDestinations(query: string, session?: string): Promise<PlaceResult[]> {
  const params = new URLSearchParams({ q: query })
  if (session) params.set('session', session)

  const res = await fetch(`${API_BASE}/destinations/search?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.places || []
}

export async function resolveDestination(
  lat: number,
  lon: number,
  direction: PlaceContext['direction']
): Promise<ResolveResponse> {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    direction,
  })
  const res = await fetch(`${API_BASE}/destinations/resolve?${params}`)
  if (!res.ok) throw new Error('No stations within walking distance')
  return res.json()
}
