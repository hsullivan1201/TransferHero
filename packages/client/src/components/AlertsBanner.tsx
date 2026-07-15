import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react'
import type { AlertsResponse, Line } from '@transferhero/shared'

const LINE_LABELS: Record<Line, string> = {
  RD: 'Red', OR: 'Orange', SV: 'Silver', BL: 'Blue', YL: 'Yellow', GR: 'Green',
}

interface AlertsBannerProps {
  alerts: AlertsResponse | undefined
  /** Lines the current trip actually uses */
  tripLines: Line[]
  /** Platform/station codes involved in the trip (origin, destination, transfer platforms) */
  stationCodes: string[]
  /** Accessibility mode — promotes elevator outages to a prominent warning */
  accessible?: boolean
}

export function AlertsBanner({ alerts, tripLines, stationCodes, accessible = false }: AlertsBannerProps) {
  const [expanded, setExpanded] = useState(false)

  if (!alerts) return null

  const lineSet = new Set(tripLines)
  const codeSet = new Set(stationCodes)

  const relevantRail = alerts.railIncidents.filter(inc =>
    inc.linesAffected.some(line => lineSet.has(line))
  )
  const relevantUnits = alerts.elevatorIncidents.filter(inc => codeSet.has(inc.stationCode))
  const elevatorOutages = relevantUnits.filter(u => u.unitType === 'ELEVATOR')
  const escalatorOutages = relevantUnits.filter(u => u.unitType === 'ESCALATOR')

  if (relevantRail.length === 0 && relevantUnits.length === 0) return null

  // Elevator outages matter a lot in accessible mode; escalators are informational
  const severe = relevantRail.length > 0 || (accessible && elevatorOutages.length > 0)

  const summaryParts: string[] = []
  if (relevantRail.length > 0) {
    const lines = [...new Set(relevantRail.flatMap(i => i.linesAffected).filter(l => lineSet.has(l)))]
    summaryParts.push(`${lines.map(l => LINE_LABELS[l]).join(', ')} Line ${relevantRail.length === 1 ? 'alert' : 'alerts'}`)
  }
  if (elevatorOutages.length > 0) {
    summaryParts.push(`${elevatorOutages.length} elevator ${elevatorOutages.length === 1 ? 'outage' : 'outages'} on your trip`)
  }
  if (escalatorOutages.length > 0) {
    summaryParts.push(`${escalatorOutages.length} escalator ${escalatorOutages.length === 1 ? 'outage' : 'outages'}`)
  }

  const tone = severe
    ? 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200'
    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'

  return (
    <div role="alert" className={`mt-4 rounded-lg border ${tone}`} data-testid="alerts-banner" data-tone={severe ? 'severe' : 'info'}>
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-medium"
      >
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span className="flex-1">{summaryParts.join(' · ')}</span>
        {expanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2 text-sm">
          {relevantRail.map(inc => (
            <p key={inc.incidentId}>{inc.description}</p>
          ))}
          {relevantUnits.map((unit, i) => (
            <p key={`${unit.stationCode}-${i}`} className="flex items-start gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {unit.stationName}: {unit.unitType === 'ELEVATOR' ? 'Elevator' : 'Escalator'} out of service
                {unit.locationDescription ? ` (${unit.locationDescription})` : ''}
              </span>
            </p>
          ))}
          {accessible && elevatorOutages.length > 0 && (
            <p className="font-semibold">
              Accessibility mode is on — consider checking station staff assistance or an alternate route.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
