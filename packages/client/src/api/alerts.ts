import type { AlertsResponse } from '@transferhero/shared'

export async function fetchAlerts(): Promise<AlertsResponse> {
  const res = await fetch('/api/alerts', { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch alerts')
  return res.json()
}
