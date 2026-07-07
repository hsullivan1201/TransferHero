import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Unhandled render error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <p className="text-lg font-semibold text-[var(--text-primary)]">Something went wrong.</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Reload the page to get back on track.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2 bg-[#E31837] text-white font-semibold rounded hover:bg-[#c41430] transition-colors"
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
