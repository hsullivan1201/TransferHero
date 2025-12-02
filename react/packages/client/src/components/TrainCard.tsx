// react/packages/client/src/components/TrainCard.tsx
import { useState, useEffect } from 'react'
import { Satellite, Rss, Check } from 'lucide-react'
import type { Train, CatchableTrain, Line } from '@transferhero/shared'
import { getLineClass } from '../utils/lineColors'
import { getDisplayName } from '../utils/displayNames'
import { minutesToClockTime, getTrainMinutes, formatTimeWithSeconds, millisecondsToClockTime } from '../utils/time'

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
  // Live countdown state - updates every second when showing seconds
  const [now, setNow] = useState(Date.now())

  // Use timestamp for precise display when available
  const hasTimestamp = !!train._destArrivalTimestamp && train._destArrivalTimestamp > now
  const millisRemaining = hasTimestamp && train._destArrivalTimestamp ? train._destArrivalTimestamp - now : 0
  const shouldShowSeconds = hasTimestamp && millisRemaining < 2 * 60 * 1000 // <2 minutes

  // Set up live countdown when showing seconds
  useEffect(() => {
    if (!shouldShowSeconds) {
      return // No need for interval if not showing seconds
    }

    // Update every second for smooth countdown
    const interval = setInterval(() => {
      setNow(Date.now())
    }, 1000)

    return () => clearInterval(interval)
  }, [shouldShowSeconds])

  const trainMin = getTrainMinutes(train.Min)
  
  // Detect departed trains - but NOT when selected (user is on the train, show arrival countdown)
  const isDeparted = !isSelected && (train._departed === true || (typeof trainMin === 'number' && trainMin < 0))
  const departedMinAgo = isDeparted ? Math.abs(trainMin) : 0
  
  const clockTime = shouldShowSeconds
    ? millisecondsToClockTime(millisRemaining)
    : isDeparted && train._transferArrivalTime
      ? train._transferArrivalTime // Show transfer arrival time for departed trains
      : minutesToClockTime(trainMin)

  // FIX: Handle "5" (string), 5 (number), and custom text like "12 min"
  let minDisplay = ''
  if (isDeparted) {
    // Departed train - show "Left X min ago"
    minDisplay = `Left ${departedMinAgo}m ago`
  } else if (train.Min === 'ARR' || train.Min === 'BRD') {
    minDisplay = train.Min
  } else if (shouldShowSeconds) {
    // Show seconds precision when <2 min and timestamp available
    minDisplay = formatTimeWithSeconds(millisRemaining)
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
  } else if (isDeparted) {
    // Departed train - show next stop and transfer arrival
    const nextStopPart = train._nextStop ? `Next: ${train._nextStop}` : ''
    const arrivalPart = train._transferArrivalTime ? `Arr ${train._transferArrivalTime}` : ''
    if (nextStopPart && arrivalPart) {
      statusText = `${nextStopPart} · ${arrivalPart}`
    } else if (nextStopPart) {
      statusText = nextStopPart
    } else if (arrivalPart) {
      statusText = arrivalPart
    } else {
      statusText = 'En route'
    }
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
      } ${
        isDeparted && !isSelected ? 'opacity-75' : ''
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
            {isDeparted && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                isYellow ? 'bg-black/20 text-[#333]' : 'bg-black/40 text-white'
              }`}>
                En Route
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