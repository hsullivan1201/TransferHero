import { QueryClient, focusManager } from '@tanstack/react-query'

// Page visibility is a better signal than window focus on mobile. Keeping this
// in one shared module means the classic and beta surfaces behave identically.
focusManager.setEventListener((handleFocus) => {
  const onVisibilityChange = () => {
    handleFocus(document.visibilityState === 'visible')
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
})

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
})
