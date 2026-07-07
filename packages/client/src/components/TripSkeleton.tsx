function PanelSkeleton() {
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg overflow-hidden animate-pulse">
      <div className="h-10 bg-[var(--bg-tertiary)]" />
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-[var(--bg-tertiary)] rounded-lg" />
        ))}
      </div>
    </div>
  )
}

/** Placeholder shown while the first trip fetch is in flight. */
export function TripSkeleton() {
  return (
    <div data-testid="trip-skeleton">
      <div className="flex justify-end mb-3">
        <div className="h-8 w-32 bg-[var(--bg-tertiary)] rounded animate-pulse" />
      </div>
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1">
          <PanelSkeleton />
        </div>
        <div className="hidden lg:block w-48">
          <div className="h-40 bg-[var(--bg-tertiary)] rounded-lg animate-pulse" />
        </div>
        <div className="flex-1">
          <PanelSkeleton />
        </div>
      </div>
    </div>
  )
}
