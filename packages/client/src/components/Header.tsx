import { Train, Moon, Sun, Accessibility } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

interface HeaderProps {
  accessible?: boolean
  onToggleAccessible?: () => void
}

export function Header({ accessible = false, onToggleAccessible }: HeaderProps) {
  const { isDark, toggleTheme } = useTheme()

  return (
    <header className="py-4 border-b border-[var(--border-color)] bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)]">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Train className="w-8 h-8 text-[#E31837]" />
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">TransferHero</h1>
            <p className="text-sm text-[var(--text-secondary)]">DC Metro transfers</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
