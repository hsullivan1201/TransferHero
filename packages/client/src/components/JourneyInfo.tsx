import type { ReactNode } from 'react'
import { Clock3, Train, User } from 'lucide-react'

interface JourneyInfoProps {
  leg1Time: number
  transferTime: number
  leg2Time: number
  waitMinutes?: number | null
  totalMinutes: number
  arrivalClock?: string
}

export function JourneyInfo({
  leg1Time,
  transferTime,
  leg2Time,
  waitMinutes,
  totalMinutes,
  arrivalClock,
}: JourneyInfoProps) {
  const wait = waitMinutes ?? 0

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg p-5 shadow-md space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] mb-1">
            total trip time
          </div>
          <div className="text-3xl font-bold text-[var(--text-primary)] leading-tight">
            {totalMinutes} min
          </div>
        </div>
        {arrivalClock && (
          <span className="px-3 py-1.5 rounded-full text-sm font-medium bg-[#1f2a3d] text-white border border-[var(--border-color)]">
            Arr {arrivalClock}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <JourneyStat label="wait" value={`${wait} min`} icon={<Clock3 className="w-4 h-4" />} />
        <JourneyStat label="leg 1 ride" value={`${leg1Time} min`} icon={<Train className="w-4 h-4" />} />
        <JourneyStat label="transfer walk" value={`${transferTime} min`} icon={<User className="w-4 h-4" />} />
        <JourneyStat label="leg 2 ride" value={`${leg2Time} min`} icon={<Train className="w-4 h-4" />} />
      </div>
    </div>
  )
}

interface JourneyStatProps {
  label: string
  value: string
  icon: ReactNode
}

function JourneyStat({ label, value, icon }: JourneyStatProps) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-color)]">
      <span className="text-[var(--text-secondary)]">{icon}</span>
      <div className="flex-1">
        <div className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)] mb-0.5">
          {label}
        </div>
        <div className="text-lg font-semibold text-[var(--text-primary)]">{value}</div>
      </div>
    </div>
  )
}
