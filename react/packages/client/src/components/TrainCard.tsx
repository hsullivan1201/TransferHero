// react/packages/client/src/components/TrainCard.tsx
import { Satellite, Rss, Check } from 'lucide-react'
import type { Train, CatchableTrain, Line } from '@transferhero/shared'
import { getLineClass } from '../utils/lineColors'
import { getDisplayName } from '../utils/displayNames'
import { minutesToClockTime, getTrainMinutes } from '../utils/time'

interface TrainCardProps {
  train: Train | CatchableTrain
  index: number
  variant: 'selectable' | 'display'
  isSelected?: boolean
  onClick?: () => void
  customStatus?: string
}

function isCatchableTrain(train: Train | CatchableTrain): train is CatchableTrain {
  return '_waitTime' in train
}

export function TrainCard({
  train,
  index,
  variant,
  isSelected,
  onClick,
  customStatus
}: TrainCardProps) {
  const trainMin = getTrainMinutes(train.Min)
  const clockTime = minutesToClockTime(trainMin)
  
  // FIX: Handle "5" (string), 5 (number), and custom text like "12 min"
  let minDisplay = ''
  if (train.Min === 'ARR' || train.Min === 'BRD') {
    minDisplay = train.Min
  } else if (
    typeof train.Min === 'number' || 
    (!isNaN(Number(train.Min)) && String(train.Min).trim() !== '')
  ) {
    // It's a raw number (5 or "5"), so add " min"
    minDisplay = `${train.Min} min`
  } else {
    // It's already formatted text (e.g. "5 min" from TripView logic)
    minDisplay = String(train.Min)
  }

  const isArriving = train.Min === 'ARR' || train.Min === 'BRD'

  const showCatchability = isCatchableTrain(train)
  const isMissed = showCatchability && !train._canCatch

  // Determine status text
  let statusText: string
  if (customStatus) {
    statusText = customStatus
  } else if (showCatchability) {
    if (train._canCatch) {
      statusText = `${train._waitTime} min wait · Arr ${train._arrivalClock}`
    } else {
      statusText = `Miss by ${Math.abs(train._waitTime)} min`
    }
  } else {
    statusText = `${train.Car || '8'}-car train`
  }

  // Source indicator
  const SourceIcon = train._gtfs ? Satellite : train._scheduled ? null : Rss
  const sourceTitle = train._gtfs ? 'Tracked via GPS' : train._scheduled ? 'Scheduled' : 'Live at Station'

  const lineClass = getLineClass(train.Line as Line)
  const isYellow = train.Line === 'YL'

  return (
    <div
      className={`relative p-5 mb-3 rounded-lg border-l-4 cursor-pointer transition-all animate-slide-in ${lineClass} ${
        variant === 'selectable' ? 'hover:translate-x-1 hover:shadow-lg' : ''
      } ${
        isSelected ? 'border-l-[6px] scale-[1.02] shadow-lg pr-12' : ''
      } ${
        isMissed ? 'opacity-50' : ''
      }`}
      style={{ animationDelay: `${index * 0.05}s` }}
      onClick={onClick}
      role={variant === 'selectable' ? 'button' : undefined}
      tabIndex={variant === 'selectable' ? 0 : undefined}
    >
      <div className="flex items-center gap-3">
        {/* Line badge */}
        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
          isYellow ? 'bg-black/20 text-[#333]' : 'bg-white/30 text-white'
        }`}>
          {train.Line || '—'}
        </div>

        {/* Train details */}
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold flex items-center gap-1.5">
            {getDisplayName(train.DestinationName)}
            {SourceIcon && (
              <span title={sourceTitle}>
                <SourceIcon
                  className={`w-3.5 h-3.5 ${isYellow ? 'text-black/50' : 'text-white/70'}`}
                  aria-label={sourceTitle}
                />
              </span>
            )}
            {train._scheduled && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                isYellow ? 'bg-black/15 text-[#333]' : 'bg-black/30 text-white'
              }`}>
                Sched
              </span>
            )}
          </div>
          <div className={`text-sm mt-0.5 ${isYellow ? 'text-black/70' : 'text-white/90'}`}>
            {statusText}
          </div>
        </div>

        {/* Time display */}
        <div className={`text-right font-bold ${isArriving ? 'animate-pulse-slow' : ''}`}>
          <div className="text-xl whitespace-nowrap">{minDisplay}</div>
          <div className={`text-xs font-normal mt-0.5 ${isYellow ? 'text-black/70' : 'text-white/80'}`}>
            {clockTime}
          </div>
        </div>
      </div>

      {/* Selected checkmark */}
      {isSelected && (
        <div className="absolute top-1/2 right-4 -translate-y-1/2 w-8 h-8 bg-white rounded-full flex items-center justify-center shadow">
          <Check className="w-5 h-5 text-green-600" />
        </div>
      )}
    </div>
  )
}