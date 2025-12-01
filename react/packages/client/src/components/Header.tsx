import { Train, Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

export function Header() {
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
    </header>
  )
}
