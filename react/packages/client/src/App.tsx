import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Header, Footer, EmptyState, TripSelector, TripView } from './components'
import { useStations, useTrip, useLeg2, useTripState } from './hooks/useTrip'
import type { Station } from '@transferhero/shared'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
})

function AppContent() {
  const { data: stations = [], isLoading: stationsLoading, error: stationsError } = useStations()
  const tripState = useTripState()

  const {
    data: tripData,
    isLoading: tripLoading,
    error: tripError,
  } = useTrip(
    tripState.from?.code ?? null,
    tripState.to?.code ?? null,
    tripState.walkTime,
    tripState.selectedAlternative?.station ?? null
  )

  // Find live version of selected train from refreshed data for accurate timing
  // ONLY match by exact tripId - Line+Destination matching causes wrong train bugs
  const liveLeg1Train = tripState.selectedLeg1Train && tripData?.trip.leg1.trains
    ? (tripState.selectedLeg1Train._tripId
        ? tripData.trip.leg1.trains.find(t => t._tripId === tripState.selectedLeg1Train!._tripId)
        : undefined
      ) || tripState.selectedLeg1Train
    : tripState.selectedLeg1Train

  const {
    data: leg2Data,
    isLoading: leg2Loading,
  } = useLeg2({
    tripId: tripState.tripId ?? '',
    departureTimestamp: tripState.departureTimestamp,
    walkTime: tripState.walkTime,
    transferStation: tripState.selectedAlternative?.station,
    enabled: !!tripState.tripId && tripState.selectedLeg1Train !== null,
    // Pass LIVE real-time arrival at transfer station (updates every 30s)
    transferArrivalMin: liveLeg1Train?._destArrivalMin,
  })

  const handleGo = (from: Station, to: Station, walkTime: number) => {
    tripState.startTrip(from, to, walkTime)
  }

  const hasTrip = tripState.from && tripState.to && tripData

  const activeTransfer = tripData?.trip.isDirect
    ? null
    : tripState.selectedAlternative
      ? { ...tripState.selectedAlternative, alternatives: tripData?.trip.transfer?.alternatives }
      : tripData?.trip.transfer

  const leg2Trains = leg2Data?.trains ?? tripData?.trip.leg2?.trains ?? []

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8">
        {stationsLoading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#E31837] mx-auto" />
            <p className="mt-2 text-[var(--text-secondary)]">Loading stations...</p>
          </div>
        )}

        {stationsError && (
          <div className="text-center py-8 text-red-500">
            Failed to load stations. Please refresh the page.
          </div>
        )}

        {!stationsLoading && !stationsError && (
          <TripSelector
            stations={stations}
            onGo={handleGo}
            isLoading={tripLoading}
            transfer={tripData?.trip.isDirect ? null : tripData?.trip.transfer}
            onSelectAlternative={tripState.selectAlternative}
            selectedAlternativeIndex={
              tripState.selectedAlternative
                ? tripData?.trip.transfer?.alternatives?.findIndex(
                    a => a.station === tripState.selectedAlternative?.station
                  ) ?? -1
                : -1
            }
          />
        )}

        {tripError && (
          <div className="mt-6 text-center py-8 text-red-500">
            Failed to load trip data. Please try again.
          </div>
        )}

        <div className="mt-6">
          {hasTrip && tripData.trip ? (
            <TripView
              transfer={activeTransfer ?? null}
              leg1Trains={tripData.trip.leg1.trains}
              leg2Trains={leg2Trains}
              leg1CarPosition={tripData.trip.leg1.carPosition}
              leg2CarPosition={tripData.trip.leg2?.carPosition ?? null}
              leg1Time={activeTransfer?.leg1Time ?? tripData.trip.transfer?.leg1Time ?? 0}
              leg2Time={activeTransfer?.leg2Time ?? tripData.trip.transfer?.leg2Time ?? 0}
              walkTime={tripState.walkTime}
              originName={tripData.trip.origin.name}
              destinationName={tripData.trip.destination.name}
              transferName={activeTransfer?.name ?? tripData.trip.transfer?.name ?? ''}
              onSelectLeg1Train={tripState.selectLeg1Train}
              onClearLeg1Selection={tripState.clearLeg1Selection}
              isLoadingLeg2={leg2Loading}
              selectedLeg1Train={tripState.selectedLeg1Train}
              departureTimestamp={tripState.departureTimestamp}
          />
          ) : !tripLoading && !tripError && (
            <EmptyState />
          )}
        </div>
      </main>

      <Footer />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}