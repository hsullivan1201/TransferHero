import { useQuery } from '@tanstack/react-query'
import { fetchBusTrips } from '../api/buses'

export function useBusTrips(
  originLat: number | null,
  originLon: number | null,
  destLat: number | null,
  destLon: number | null,
  originStation: string | null,
  destStation: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['bus-trips', originLat, originLon, destLat, destLon, originStation, destStation],
    queryFn: () => fetchBusTrips(
      originLat!,
      originLon!,
      destLat!,
      destLon!,
      originStation!,
      destStation!
    ),
    enabled: enabled && originLat !== null && originLon !== null &&
      destLat !== null && destLon !== null &&
      originStation !== null && destStation !== null,
    staleTime: 60_000, // 60s — bus routes are static, no need for frequent refetches
    gcTime: 5 * 60_000,
  })
}
