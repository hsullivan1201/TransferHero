import { X } from 'lucide-react'

interface PrivacyPolicyProps {
  onClose: () => void
}

export function PrivacyPolicy({ onClose }: PrivacyPolicyProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[var(--bg-primary)] rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-[var(--border-color)]">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Privacy</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <X className="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
          <p>
            TransferHero is a free tool to help you navigate Metro. Here's the deal with your data:
          </p>

          <h3 className="font-medium text-[var(--text-primary)]">What we log</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Trip lookups</strong>: origin and destination stations you search for, which helps us debug issues. This data is not kept.
            </li>
            <li>
              <strong>Server requests</strong>: standard request logs that may include coordinates if you use the "current location" feature or search for a place. This data is not kept.
            </li>
            <li>
              <strong>Infrastructure logs</strong>: our hosting provider logs IP addresses as part of normal operations. This data is not kept.
            </li>
          </ul>

          <h3 className="font-medium text-[var(--text-primary)]">Saved trips</h3>
          <p>
            When you save a trip, it's stored in your browser's local storage on your device. This data never leaves your phone or computer; we don't see it, collect it, or back it up. Clearing your browser data will delete your saved trips.
          </p>

          <h3 className="font-medium text-[var(--text-primary)]">Shared trip links</h3>
          <p>
            When you choose “Share trip,” we store a signed copy of the shared trip so its short link works. It includes the trip endpoints and may include place names, coordinates, route details, and timing. Anyone with the link can view those details. Shared links do not currently expire.
          </p>

          <h3 className="font-medium text-[var(--text-primary)]">What we don't do</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>We don't create accounts or track you across sessions.</li>
            <li>We don't sell or share your data with anyone.</li>
            <li>Logs are not stored permanently, they rotate and get deleted.</li>
          </ul>

          <p>
            That's basically it. We keep things minimal because we don't need much
            to run a transit app.
          </p>
        </div>
      </div>
    </div>
  )
}
