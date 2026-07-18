import { useQuery } from '@tanstack/react-query'
import type { PlaceContext } from '@transferhero/shared'
import { searchDestinations, resolveDestination } from '../api/destinations'

export function useDestinationSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ['destination-search', query],
    queryFn: () => searchDestinations(query),
    enabled: enabled && query.length >= 2,
    staleTime: 120_000, // 2 minutes
    gcTime: 5 * 60_000,
  })
}

export function useDestinationResolve(
  lat: number | null,
  lon: number | null,
  direction: PlaceContext['direction']
) {
  return useQuery({
    queryKey: ['destination-resolve', lat, lon, direction],
    queryFn: () => resolveDestination(lat!, lon!, direction),
    enabled: lat !== null && lon !== null,
    staleTime: 5 * 60_000, // 5 minutes — exit data doesn't change
    gcTime: 10 * 60_000,
  })
}
