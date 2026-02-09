import { useQuery } from '@tanstack/react-query'
import { fetchBusPredictions } from '../api/buses'

export function useBusPredictions(
  stopCode: string | null,
  routeId: string | null,
  enabled: boolean,
  boardStopId?: string,
  alightStopId?: string,
) {
  return useQuery({
    queryKey: ['bus-predictions', stopCode, routeId, boardStopId, alightStopId],
    queryFn: () => fetchBusPredictions(stopCode!, routeId!, boardStopId, alightStopId),
    enabled: enabled && stopCode !== null && routeId !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
    gcTime: 60_000,
  })
}
