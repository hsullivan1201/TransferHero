export type LocationFailure = 'denied' | 'timeout' | 'unavailable' | 'inaccurate'

interface LocationCallbacks {
  onSuccess: (position: GeolocationPosition) => void
  onError: (failure: LocationFailure) => void
  onFallback: () => void
}

// A broad city-level fix is not a useful walking origin. This is an acceptance
// limit for reported uncertainty, not a guarantee of the nearest station/exit.
const MAX_ACCURACY_METERS = 200

export function requestCurrentLocation(
  geolocation: Pick<Geolocation, 'getCurrentPosition'>,
  signal: AbortSignal,
  callbacks: LocationCallbacks,
): void {
  let finished = false
  let attemptId = 0

  const fail = (failure: LocationFailure) => {
    finished = true
    callbacks.onError(failure)
  }

  const attempt = (fallback: boolean) => {
    if (signal.aborted || finished) return
    const id = ++attemptId
    // getCurrentPosition cannot be cancelled; ignore callbacks after a manual
    // selection, unmount, completion, or transition to the fallback attempt.
    const isActive = () => !signal.aborted && !finished && id === attemptId
    const onError = (error: Pick<GeolocationPositionError, 'code'>) => {
      if (!isActive()) return
      if (error.code === 1) {
        fail('denied')
      } else if (!fallback && (error.code === 2 || error.code === 3)) {
        callbacks.onFallback()
        attempt(true)
      } else {
        fail(error.code === 3 ? 'timeout' : 'unavailable')
      }
    }

    try {
      geolocation.getCurrentPosition(
        (position) => {
          if (!isActive()) return
          const { latitude, longitude, accuracy } = position.coords
          if (!Number.isFinite(latitude) || Math.abs(latitude) > 90
            || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
            fail('unavailable')
            return
          }
          if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS) {
            fail('inaccurate')
            return
          }
          finished = true
          callbacks.onSuccess(position)
        },
        onError,
        // At most two acquisition attempts. The browser's timeout excludes time
        // waiting for permission or for the page to become visible.
        fallback
          ? { enableHighAccuracy: false, timeout: 15_000, maximumAge: 30_000 }
          : { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
      )
    } catch {
      if (isActive()) fail('unavailable')
    }
  }

  attempt(false)
}

export function locationErrorMessage(failure: LocationFailure, isIOS: boolean): string {
  switch (failure) {
    case 'denied':
      return isIOS
        ? 'Location access is blocked. On iPhone or iPad, open Settings → Privacy & Security → Location Services. Turn it on and allow access for Safari Websites or your browser. Also allow location for this website in your browser, then try again. You can enter a station or address instead.'
        : 'Location access is blocked. Allow location for this website in your browser and check your device’s Location Services, then try again. You can enter a station or address instead.'
    case 'timeout':
      return 'Finding your location took too long. Move near a window or outdoors and try again, or enter a station or address.'
    case 'unavailable':
      return 'Your device could not determine your location. Check Location Services and your Wi-Fi or mobile connection, then try again, or enter a station or address.'
    case 'inaccurate':
      return 'Your location is too approximate to choose a nearby station reliably. Enable Precise Location for your browser if available, or move outdoors and try again. You can enter a station or address instead.'
  }
}
