import type { ExitOption } from '@transferhero/shared'

type EgressType = ExitOption['type']

// These use the filled transit pictogram language from Material Design Icons
// (Apache-2.0), optically resized here for TransferHero's platform roundels.
export function PlatformEgressIcon({ type }: { type: EgressType }) {
  if (type === 'escalator') {
    return (
      <svg
        className="beta-egress-icon"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M20 8h-1.05l-12 12H4a2 2 0 0 1 0-4h1.29L7 14.29V10a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.29L17.29 4H20a2 2 0 0 1 0 4ZM8.5 5A1.5 1.5 0 1 1 7 6.5 1.5 1.5 0 0 1 8.5 5Z"
          fill="currentColor"
        />
      </svg>
    )
  }

  if (type === 'elevator') {
    return (
      <svg
        className="beta-egress-icon"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="m7 2 4 4H8v4H6V6H3l4-4Zm10 8-4-4h3V2h2v4h3l-4 4ZM7 12h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Zm0 2v6h10v-6H7Z"
          fill="currentColor"
        />
      </svg>
    )
  }

  if (type === 'exit') {
    return (
      <svg
        className="beta-egress-icon"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M8.5 4h10v16h-10"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M3 12h10m-3.25-3.25L13 12l-3.25 3.25"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <svg
      className="beta-egress-icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M15 5v4h-4v4H7v4H3v3h7v-4h4v-4h4V8h4V5h-7Z" fill="currentColor" />
    </svg>
  )
}
