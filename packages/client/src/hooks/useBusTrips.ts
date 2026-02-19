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
      originLat ?? undefined,
      originLon ?? undefined,
      destLat ?? undefined,
      destLon ?? undefined,
      originStation!,
      destStation!
    ),
    enabled: enabled && originStation !== null && destStation !== null,
    staleTime: 20_000, // keep rankings fresh as wait times change
    refetchInterval: enabled ? 20_000 : false,
    gcTime: 5 * 60_000,
  })
}
