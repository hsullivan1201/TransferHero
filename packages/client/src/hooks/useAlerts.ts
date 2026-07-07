import { useQuery } from '@tanstack/react-query'
import { fetchAlerts } from '../api/alerts'

export function useAlerts(enabled: boolean = true) {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: fetchAlerts,
    enabled,
    staleTime: 55 * 1000,
    refetchInterval: 60 * 1000,
    // alerts are supplementary — don't let a failure surface as an app error
    retry: 1,
  })
}
