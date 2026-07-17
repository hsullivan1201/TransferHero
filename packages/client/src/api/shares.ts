import type { SharedTripPayload } from '@transferhero/shared'

interface CreateShareResponse {
  token: string
  url: string
  trip: SharedTripPayload
}

interface ResolveShareResponse {
  trip: SharedTripPayload
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error) return new Error(body.error)
  } catch {
    // The generic status message below is enough when the response is not JSON.
  }
  return new Error(`Share request failed (${response.status})`)
}

export async function createTripShareLink(payload: SharedTripPayload): Promise<CreateShareResponse> {
  const response = await fetch('/api/shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trip: payload }),
  })

  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<CreateShareResponse>
}

export async function resolveTripShareToken(token: string): Promise<SharedTripPayload> {
  const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) throw await responseError(response)
  const body = await response.json() as ResolveShareResponse
  return body.trip
}
