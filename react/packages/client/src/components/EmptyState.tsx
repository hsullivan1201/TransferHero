import { Train } from 'lucide-react'

export function EmptyState() {
  return (
    <div className="text-center py-16 opacity-70 animate-fade-in">
      <Train className="w-16 h-16 mx-auto mb-4 text-[var(--text-secondary)]" />
      <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
        Plan Your Transfer
      </h2>
      <p className="text-[var(--text-secondary)] max-w-md mx-auto">
        Select your origin and destination stations above to find the best transfer options
        and see real-time train arrivals.
      </p>
    </div>
  )
}
