import { Train, Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

export function Header() {
  const { isDark, toggleTheme } = useTheme()

  return (
    <header className="py-3 border-b border-[var(--border-color)] bg-gradient-to-b from-[var(--bg-secondary)] to-[var(--bg-tertiary)]">
      <div className="max-w-4xl mx-auto px-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Train className="w-6 h-6 text-[#E31837]" />
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">TransferHero</h1>
            <p className="text-xs text-[var(--text-secondary)]">DC Metro Transfer Assistant</p>
          </div>
        </div>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
          aria-label="Toggle theme"
        >
          {isDark ? (
            <Sun className="w-5 h-5 text-[var(--text-primary)]" />
          ) : (
            <Moon className="w-5 h-5 text-[var(--text-primary)]" />
          )}
        </button>
      </div>
    </header>
  )
}
