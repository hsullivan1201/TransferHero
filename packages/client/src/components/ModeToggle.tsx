interface ModeToggleProps {
  mode: 'metro' | 'metro-bus'
  onModeChange: (mode: 'metro' | 'metro-bus') => void
  busCount?: number
  busOnlyLock?: boolean
}

export function ModeToggle({ mode, onModeChange, busCount, busOnlyLock }: ModeToggleProps) {
  return (
    <div className="flex rounded-lg border border-[var(--border-color)] overflow-hidden bg-[var(--card-bg)]">
      <button
        onClick={() => !busOnlyLock && onModeChange('metro')}
        disabled={busOnlyLock}
        className={`px-4 py-2 text-sm font-medium transition-colors ${
          busOnlyLock
            ? 'opacity-40 cursor-not-allowed text-[var(--text-secondary)]'
            : mode === 'metro'
              ? 'bg-[#E31837] text-white cursor-pointer'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] cursor-pointer'
        }`}
      >
        Metro
      </button>
      <button
        onClick={() => onModeChange('metro-bus')}
        className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
          mode === 'metro-bus'
            ? 'bg-[#0f9b8e] text-white'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
        }`}
      >
        Metro+Bus
        {busCount !== undefined && busCount > 0 && (
          <span className={`text-xs rounded-full px-1.5 py-0.5 ${
            mode === 'metro-bus'
              ? 'bg-white/20'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
          }`}>
            {busCount}
          </span>
        )}
      </button>
    </div>
  )
}
