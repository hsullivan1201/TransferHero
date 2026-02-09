import { useQuery } from '@tanstack/react-query'
import { fetchBusPredictions } from '../api/buses'

export function useBusPredictions(
  stopCode: string | null,
  routeId: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['bus-predictions', stopCode, routeId],
    queryFn: () => fetchBusPredictions(stopCode!, routeId!),
    enabled: enabled && stopCode !== null && routeId !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
    gcTime: 60_000,
  })
}
