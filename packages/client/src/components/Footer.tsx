import { Github, ExternalLink } from 'lucide-react'

export function Footer() {
  return (
    <footer className="mt-8 py-6 bg-[var(--bg-secondary)] border-t border-[var(--border-color)]">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[var(--text-secondary)]">
          <div className="flex items-center gap-4">
            <span>TransferHero</span>
            <span className="hidden sm:inline">|</span>
            <a
              href="https://wmata.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
            >
              WMATA Data
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex items-center gap-4">
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors"
            >
              <Github className="w-4 h-4" />
              <span>Source</span>
            </a>
          </div>
        </div>

        <div className="mt-4 text-xs text-center text-[var(--text-secondary)]">
          Real-time data provided by WMATA API. Not affiliated with Washington Metropolitan Area Transit Authority.
        </div>
      </div>
    </footer>
  )
}
