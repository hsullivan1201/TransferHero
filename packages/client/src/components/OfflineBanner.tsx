import { WifiOff } from 'lucide-react'

export function OfflineBanner() {
  return (
    <div
      role="status"
      className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 text-sm"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>You're offline — live train data is unavailable. Saved trips are still viewable.</span>
    </div>
  )
}
