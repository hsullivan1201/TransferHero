import { Train, Moon, Sun, Accessibility, Sparkles } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

interface HeaderProps {
  accessible?: boolean
  onToggleAccessible?: () => void
}

export function Header({ accessible = false, onToggleAccessible }: HeaderProps) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <header className="py-4 border-b border-[var(--border-color)] bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)]">
      <div className="max-w-6xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Train className="w-8 h-8 text-[#E31837]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">TransferHero</h1>
            <p className="hidden sm:block text-sm text-[var(--text-secondary)]">DC Metro transfers</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/beta"
            className="min-h-11 min-w-11 px-3 py-2 rounded-lg border border-[#E31837]/35 bg-[#E31837]/10 text-[#E31837] hover:bg-[#E31837] hover:text-white transition-colors inline-flex items-center justify-center gap-1.5 text-sm font-semibold"
            aria-label="Try the beta wayfinding interface"
          >
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Beta</span>
          </a>
          {onToggleAccessible && (
            <button
              onClick={onToggleAccessible}
              className={`p-2.5 rounded-lg transition-colors ${
                accessible 
                  ? 'bg-blue-600 text-white hover:bg-blue-700' 
                  : 'hover:bg-[var(--bg-tertiary)]'
              }`}
              aria-label="Toggle accessibility mode (elevator exits)"
              title={accessible ? 'Showing elevator exits' : 'Show elevator exits'}
            >
              <Accessibility className={`w-6 h-6 ${accessible ? 'text-white' : 'text-[var(--text-primary)]'}`} />
            </button>
          )}
          <button
            onClick={toggleTheme}
            className="p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
            aria-label="Toggle theme"
          >
            {isDark ? (
              <Sun className="w-6 h-6 text-[var(--text-primary)]" />
            ) : (
              <Moon className="w-6 h-6 text-[var(--text-primary)]" />
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
