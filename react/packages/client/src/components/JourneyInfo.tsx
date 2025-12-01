import { ArrowDown, Train, User } from 'lucide-react'

interface JourneyInfoProps {
  leg1Time: number
  transferTime: number
  leg2Time: number
  selectedTrainMin?: number
  arrivalTime?: string
}

export function JourneyInfo({
  leg1Time,
  transferTime,
  leg2Time,
  selectedTrainMin,
  arrivalTime
}: JourneyInfoProps) {
  const totalTime = (selectedTrainMin ?? 0) + leg1Time + transferTime + leg2Time

  return (
    <div className="bg-[var(--card-bg)] border-2 border-[var(--border-color)] rounded-lg p-5 shadow-sm">
      <div className="flex items-center justify-center mb-4">
        <ArrowDown className="w-10 h-10 text-[var(--text-primary)]" />
      </div>

      <div className="space-y-3">
        <JourneyDetail label="Leg 1" value={`${leg1Time} min`} icon={<Train className="w-5 h-5" />} />
        <JourneyDetail label="Transfer Walk" value={`${transferTime} min`} icon={<User className="w-5 h-5" />} />
        <JourneyDetail label="Leg 2" value={`${leg2Time} min`} icon={<Train className="w-5 h-5" />} />

        <div className="mt-4 p-4 bg-[#1a2332] dark:bg-[#0d1117] dark:border dark:border-[#30363d] rounded-md">
          <div className="text-xs text-white/70 uppercase tracking-wide mb-1.5">
            Total Journey
          </div>
          <div className="text-2xl font-bold text-white">
            {totalTime} min
            {arrivalTime && (
              <span className="text-base font-normal text-white/80 ml-2">
                Arr {arrivalTime}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface JourneyDetailProps {
  label: string
  value: string
  icon: React.ReactNode
}

function JourneyDetail({ label, value, icon }: JourneyDetailProps) {
  return (
    <div className="flex items-center p-3 bg-[var(--bg-secondary)] rounded-md">
      <div className="text-[var(--text-secondary)] mr-3">
        {icon}
      </div>
      <div className="flex-1">
        <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wide block mb-0.5">
          {label}
        </span>
        <span className="text-xl font-semibold text-[var(--text-primary)]">
          {value}
        </span>
      </div>
    </div>
  )
}
