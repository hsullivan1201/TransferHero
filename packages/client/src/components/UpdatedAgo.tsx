import { useNow } from '../hooks/useNow'

interface UpdatedAgoProps {
  fetchedAt?: string
  isFetching?: boolean
  /** Override the whole display, e.g. "Planned for 5:30 PM" for scheduled trips */
  label?: string
}

/** "Updated 12s ago" staleness indicator for real-time data. */
export function UpdatedAgo({ fetchedAt, isFetching, label }: UpdatedAgoProps) {
  const now = useNow(1000)

  if (label) {
    return <span className="text-xs text-[var(--text-secondary)]">{label}</span>
  }
  if (isFetching) {
    return <span className="text-xs text-[var(--text-secondary)]">Updating…</span>
  }
  if (!fetchedAt) return null

  const seconds = Math.max(0, Math.round((now - new Date(fetchedAt).getTime()) / 1000))
  const stale = seconds > 45
  const text = seconds < 60
    ? `Updated ${seconds}s ago`
    : `Updated ${Math.floor(seconds / 60)}m ago`

  return (
    <span className={`text-xs ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--text-secondary)]'}`}>
      {text}
    </span>
  )
}
