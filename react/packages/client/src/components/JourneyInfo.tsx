import { ArrowDown } from 'lucide-react'

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
    <div className="bg-[var(--card-bg)] border-2 border-[var(--border-color)] rounded-lg p-4 shadow-sm">
      <div className="flex items-center justify-center mb-3">
        <ArrowDown className="w-8 h-8 text-[var(--text-primary)]" />
      </div>

      <div className="space-y-2">
        <JourneyDetail label="Leg 1" value={`${leg1Time} min`} />
        <JourneyDetail label="Transfer Walk" value={`${transferTime} min`} />
        <JourneyDetail label="Leg 2" value={`${leg2Time} min`} />

        <div className="mt-3 p-3 bg-[#1a2332] dark:bg-[#0d1117] dark:border dark:border-[#30363d] rounded-md">
          <div className="text-xs text-white/70 uppercase tracking-wide mb-1">
            Total Journey
          </div>
          <div className="text-xl font-bold text-white">
            {totalTime} min
            {arrivalTime && (
              <span className="text-sm font-normal text-white/80 ml-2">
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
}

function JourneyDetail({ label, value }: JourneyDetailProps) {
  return (
    <div className="flex flex-col p-3 bg-[var(--bg-secondary)] rounded-md">
      <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wide mb-0.5">
        {label}
      </span>
      <span className="text-lg font-semibold text-[var(--text-primary)]">
        {value}
      </span>
    </div>
  )
}
