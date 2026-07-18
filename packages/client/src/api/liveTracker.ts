import type { LiveTrackerResponse, MetroMapData } from '@transferhero/shared'

export class LiveTrackerRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LiveTrackerRequestError'
    this.status = status
  }
}

async function requestError(response: Response): Promise<LiveTrackerRequestError> {
  let message = response.status === 404
    ? 'This live trip could not be found.'
    : response.status === 410
      ? 'This live trip has expired.'
      : `Live tracking is unavailable (${response.status}).`

  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string' && body.error.trim()) message = body.error
  } catch {
    // A useful status-specific message is already available above.
  }

  return new LiveTrackerRequestError(message, response.status)
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal,
  })

  if (!response.ok) throw await requestError(response)
  return response.json() as Promise<T>
}

/** Static network geometry used by the dependency-free SVG tracker map. */
export function getMetroMap(signal?: AbortSignal): Promise<MetroMapData> {
  return getJson<MetroMapData>('/api/stations/map', signal)
}

/** One live snapshot. The page intentionally owns the polling cadence. */
export function getLiveTracker(token: string, signal?: AbortSignal): Promise<LiveTrackerResponse> {
  return getJson<LiveTrackerResponse>(
    `/api/shares/${encodeURIComponent(token)}/live`,
    signal
  )
}
