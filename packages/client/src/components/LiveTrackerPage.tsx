import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  MapPin,
  Radio,
  RefreshCw,
  TrainFront,
} from 'lucide-react'
import type {
  Line,
  LiveTrackedTrainStatus,
  LiveTrackerResponse,
  MetroMapData,
  MetroMapStation,
  SharedTrackedTrain,
  SharedTripPayload,
} from '@transferhero/shared'
import {
  getLiveTracker,
  getMetroMap,
  LiveTrackerRequestError,
} from '../api/liveTracker'
import { useTheme } from '../hooks/useTheme'
import { LINE_COLORS } from '../utils/lineColors'
import { LiveTrainMap, type LiveMapStation, type LiveMapTrain } from './LiveTrainMap'
import '../liveTracker.css'

const POLL_INTERVAL_MS = 12_000
const CLOCK_TICK_MS = 5_000

const LINE_NAMES: Record<Line, string> = {
  RD: 'Red',
  OR: 'Orange',
  SV: 'Silver',
  BL: 'Blue',
  YL: 'Yellow',
  GR: 'Green',
}

export interface LiveTrackerPageProps {
  token: string
  trip: SharedTripPayload
}

function stationWithPosition(code: string, mapData: MetroMapData): MetroMapStation | null {
  const station = mapData.stations.find(item => item.code === code)
  if (station) return station

  for (const path of mapData.paths) {
    const point = path.points.find(item => item.stationCode === code)
    if (point) {
      return {
        code,
        name: code,
        lines: [path.line],
        lat: point.lat,
        lon: point.lon,
      }
    }
  }
  return null
}

function mapStation(
  station: SharedTrackedTrain['from'] | LiveTrackedTrainStatus['from'],
  mapData: MetroMapData
): LiveMapStation | null {
  const positioned = stationWithPosition(station.code, mapData)
  return positioned ? {
    code: station.code,
    name: station.name,
    lat: positioned.lat,
    lon: positioned.lon,
  } : null
}

function liveMapTrain(
  selected: SharedTrackedTrain,
  status: LiveTrackedTrainStatus | null,
  mapData: MetroMapData
): LiveMapTrain | null {
  const from = mapStation(status?.from ?? selected.from, mapData)
  const to = mapStation(status?.to ?? selected.to, mapData)
  if (!from || !to) return null

  return {
    id: selected.id,
    leg: selected.leg,
    line: status?.line ?? selected.line,
    toward: status?.toward ?? selected.toward,
    from,
    to,
    routeStationCodes: status?.routeStationCodes ?? selected.stops.map(stop => stop.code),
    position: status?.position ?? null,
    nextStop: status?.nextStop
      ? { code: status.nextStop.code, name: status.nextStop.name }
      : null,
    progress: status?.progress ?? 0,
    phase: status?.phase ?? 'unknown',
    ended: status?.ended ?? false,
  }
}

function clockTime(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp)) return null
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function freshnessLabel(updatedAtMs: number | null, now: number): string {
  if (updatedAtMs == null) return 'Waiting for an update'
  const seconds = Math.max(0, Math.floor((now - updatedAtMs) / 1_000))
  if (seconds < 8) return 'Updated just now'
  if (seconds < 60) return `Updated ${seconds} sec ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes === 1) return 'Updated 1 min ago'
  return `Updated ${minutes} min ago`
}

function phaseLabel(train: LiveTrackedTrainStatus | null): string {
  if (!train) return 'Finding the train'
  switch (train.phase) {
    case 'not_started':
      return 'Waiting to depart'
    case 'at_station':
      return `At ${train.previousStop?.name ?? train.nextStop?.name ?? train.from.name}`
    case 'in_transit':
      return 'Moving between stations'
    case 'arriving':
      return train.nextStop ? `Approaching ${train.nextStop.name}` : 'Approaching the next stop'
    case 'arrived':
    case 'ended':
      return `Arrived at ${train.to.name}`
    default:
      return 'Updating location'
  }
}

function arrivalHeadline(arrivalAtMs: number | null, now: number, arrived: boolean): string {
  if (arrived) return 'They’ve arrived'
  if (arrivalAtMs == null) return 'Arrival is updating'
  const minutes = Math.max(0, Math.ceil((arrivalAtMs - now) / 60_000))
  if (minutes === 0) return 'Arriving now'
  if (minutes === 1) return 'Arrives in 1 min'
  return `Arrives in ${minutes} min`
}

function LiveTrackerBrand() {
  return (
    <header className="live-tracker-brand">
      <a href="/" className="live-tracker-brand-link" aria-label="TransferHero home">
        <span className="live-tracker-brand-mark" aria-hidden="true">T</span>
        <span>
          <strong>TransferHero</strong>
          <small>Live trip</small>
        </span>
      </a>
      <span className="live-tracker-shared-pill">
        <Radio aria-hidden="true" /> Shared with you
      </span>
    </header>
  )
}

function TrackerNotice({
  kind,
  title,
  copy,
  onRetry,
}: {
  kind: 'invalid' | 'expired' | 'unavailable'
  title: string
  copy: string
  onRetry?: () => void
}) {
  return (
    <section className={`live-tracker-notice is-${kind}`} role={kind === 'unavailable' ? 'alert' : 'status'}>
      <span className="live-tracker-notice-icon" aria-hidden="true">
        {kind === 'expired' ? <Clock3 /> : <AlertCircle />}
      </span>
      <h1>{title}</h1>
      <p>{copy}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> Try again
        </button>
      )}
    </section>
  )
}

export function LiveTrackerPage({ token, trip }: LiveTrackerPageProps) {
  useTheme()
  const tracking = trip.tracking
  const [mapData, setMapData] = useState<MetroMapData | null>(null)
  const [mapError, setMapError] = useState(false)
  const [mapRetry, setMapRetry] = useState(0)
  const [snapshot, setSnapshot] = useState<LiveTrackerResponse | null>(null)
  const [liveError, setLiveError] = useState<Error | null>(null)
  const [initialLiveLoading, setInitialLiveLoading] = useState(true)
  const [liveRetry, setLiveRetry] = useState(0)
  const [selectedId, setSelectedId] = useState(() => tracking?.trains[0]?.id ?? '')
  const [hasManuallyFocusedTrain, setHasManuallyFocusedTrain] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const requestStatus = liveError instanceof LiveTrackerRequestError ? liveError.status : null
  const finalTrackedConfig = tracking
    ? [...tracking.trains].sort((a, b) => b.leg - a.leg)[0] ?? null
    : null
  const trackedThroughDestination = finalTrackedConfig?.to.code === trip.destination.code
  const hardExpiry = snapshot?.expiresAtMs ?? tracking?.expiresAtMs ?? null
  const expired = Boolean(
    requestStatus === 410
    || snapshot?.expired
    || (hardExpiry != null && now >= hardExpiry)
  )
  const trackingEnded = Boolean(snapshot?.ended)
  const reachedFinalMetroStation = trackingEnded && trackedThroughDestination
  const arrived = reachedFinalMetroStation && !trip.destPlaceContext
  const partialTrackingEnded = trackingEnded && !trackedThroughDestination
  const terminal = expired || trackingEnded

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!tracking) return
    const abortController = new AbortController()
    setMapError(false)
    getMetroMap(abortController.signal)
      .then(setMapData)
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setMapError(true)
      })
    return () => abortController.abort()
  }, [tracking, mapRetry])

  useEffect(() => {
    if (!tracking || !token || terminal) {
      setInitialLiveLoading(false)
      return
    }

    let active = true
    let timer: number | undefined
    let request: AbortController | null = null

    const poll = async () => {
      request = new AbortController()
      try {
        const response = await getLiveTracker(token, request.signal)
        if (!active) return
        setSnapshot(response)
        setLiveError(null)
        setNow(Date.now())
        if (!response.expired && !response.ended) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
        setLiveError(error instanceof Error ? error : new Error('Live tracking is unavailable.'))
        const status = error instanceof LiveTrackerRequestError ? error.status : null
        if (status !== 404 && status !== 410) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS)
        }
      } finally {
        if (active) setInitialLiveLoading(false)
      }
    }

    void poll()
    return () => {
      active = false
      if (timer != null) window.clearTimeout(timer)
      request?.abort()
    }
  }, [liveRetry, terminal, token, tracking])

  useEffect(() => {
    if (!tracking || tracking.trains.some(train => train.id === selectedId)) return
    setSelectedId(tracking.trains[0]?.id ?? '')
  }, [selectedId, tracking])

  useEffect(() => {
    if (!snapshot || hasManuallyFocusedTrain) return
    const current = snapshot.trains.find(train => train.id === selectedId)
    if (current && !current.ended) return
    const activeTrain = snapshot.trains.find(train => !train.ended && train.phase !== 'not_started')
      ?? snapshot.trains.find(train => !train.ended)
    if (activeTrain) setSelectedId(activeTrain.id)
  }, [hasManuallyFocusedTrain, selectedId, snapshot])

  const selectedConfig = tracking?.trains.find(train => train.id === selectedId)
    ?? tracking?.trains[0]
    ?? null
  const selectedStatus = snapshot?.trains.find(train => train.id === selectedConfig?.id) ?? null
  const finalStatus = useMemo(() => {
    if (!snapshot) return null
    return [...snapshot.trains].sort((a, b) => b.leg - a.leg)[0] ?? null
  }, [snapshot])
  const selectedMapTrain = useMemo(() => {
    if (!selectedConfig || !mapData) return null
    return liveMapTrain(selectedConfig, selectedStatus, mapData)
  }, [mapData, selectedConfig, selectedStatus])

  const retryLive = useCallback(() => {
    setInitialLiveLoading(true)
    setLiveError(null)
    setLiveRetry(value => value + 1)
  }, [])
  const retryMap = useCallback(() => {
    setMapError(false)
    setMapRetry(value => value + 1)
  }, [])

  if (!tracking || !token) {
    return (
      <main className="live-tracker-page">
        <div className="live-tracker-wrap">
          <LiveTrackerBrand />
          <TrackerNotice
            kind="invalid"
            title="This isn’t a live trip"
            copy="Ask your friend for a new TransferHero live tracking link."
          />
        </div>
      </main>
    )
  }

  if (!snapshot && !initialLiveLoading && requestStatus === 404) {
    return (
      <main className="live-tracker-page">
        <div className="live-tracker-wrap">
          <LiveTrackerBrand />
          <TrackerNotice
            kind="invalid"
            title="This live link isn’t valid"
            copy="It may have been replaced. Ask your friend to share their train again."
          />
        </div>
      </main>
    )
  }

  if (!snapshot && !initialLiveLoading && requestStatus !== 410 && liveError) {
    return (
      <main className="live-tracker-page">
        <div className="live-tracker-wrap">
          <LiveTrackerBrand />
          <TrackerNotice
            kind="unavailable"
            title="We lost the train for a moment"
            copy="The live feed isn’t responding right now. You can try reconnecting."
            onRetry={retryLive}
          />
        </div>
      </main>
    )
  }

  const arrivalAtMs = finalStatus?.eta?.arrivalAtMs
    ?? finalTrackedConfig?.arrivalAtMs
    ?? trip.timing.arrivalAtMs
  const arrivalTime = clockTime(arrivalAtMs)
  const nextExpectedTime = clockTime(selectedStatus?.nextStop?.expectedAtMs)
  const stale = Boolean(
    liveError
    || selectedStatus?.freshness.isStale
    || (selectedStatus && now - selectedStatus.freshness.updatedAtMs > 45_000)
  )
  const estimatedPosition = selectedStatus?.position?.source != null
    && selectedStatus.position.source !== 'vehicle'
  const destinationName = trip.destPlaceContext?.place.name ?? trip.destination.name
  const trackedEndpointName = finalTrackedConfig?.to.name ?? trip.destination.name
  const introHeadline = arrived
    ? `Made it to ${destinationName}`
    : reachedFinalMetroStation
      ? `Train arrived at ${trip.destination.name}`
      : partialTrackingEnded
        ? `Train arrived at ${trackedEndpointName}`
        : `On the way to ${destinationName}`
  const arrivalLabel = trackedThroughDestination
    ? trip.destPlaceContext ? 'METRO ARRIVAL' : 'FINAL ARRIVAL'
    : 'TRACKED TRAIN ARRIVAL'

  return (
    <main className={arrived ? 'live-tracker-page is-arrived' : 'live-tracker-page'}>
      <div className="live-tracker-wrap">
        <LiveTrackerBrand />

        <section className="live-tracker-intro">
          <span className="live-tracker-eyebrow">LIVE RIDE</span>
          <h1>{introHeadline}</h1>
          <p>
            {trip.origin.name} <span aria-hidden="true">→</span> {trip.destination.name}
          </p>
        </section>

        {tracking.trains.length > 1 ? (
          <div className="live-train-tabs" role="group" aria-label="Choose a train to follow on the map">
            {tracking.trains.map(train => {
              const status = snapshot?.trains.find(item => item.id === train.id)
              const isActive = train.id === selectedConfig?.id
              return (
                <button
                  type="button"
                  className={isActive ? 'live-train-chip is-active' : 'live-train-chip'}
                  key={train.id}
                  onClick={() => {
                    setSelectedId(train.id)
                    setHasManuallyFocusedTrain(true)
                  }}
                  aria-pressed={isActive}
                >
                  <span
                    className="live-train-chip-line"
                    style={{ backgroundColor: LINE_COLORS[train.line].bg, color: LINE_COLORS[train.line].text }}
                  >
                    {train.line}
                  </span>
                  <span>
                    <small>{train.leg === 1 ? 'First train' : 'Connecting train'}</small>
                    <strong>{LINE_NAMES[train.line]} toward {train.toward}</strong>
                  </span>
                  {status?.ended && <CheckCircle2 className="live-train-chip-check" aria-label="Completed" />}
                </button>
              )
            })}
          </div>
        ) : selectedConfig ? (
          <div className="live-train-single-label">
            <span style={{ backgroundColor: LINE_COLORS[selectedConfig.line].bg }} aria-hidden="true" />
            {LINE_NAMES[selectedConfig.line]} Line toward {selectedConfig.toward}
          </div>
        ) : null}

        <section className="live-tracker-map-card" aria-label="Live train status">
          <div className="live-map-card-header">
            <span>
              <MapPin aria-hidden="true" /> Train location
            </span>
            {reachedFinalMetroStation ? (
              <span className="live-map-state is-arrived"><CheckCircle2 aria-hidden="true" /> TRAIN ARRIVED</span>
            ) : expired || trackingEnded ? (
              <span className="live-map-state is-offline">TRACKING ENDED</span>
            ) : (
              <span className={stale ? 'live-map-state is-stale' : 'live-map-state'}>
                <i aria-hidden="true" /> {stale ? 'UPDATING' : 'LIVE'}
              </span>
            )}
          </div>

          {mapData && selectedMapTrain ? (
            <LiveTrainMap
              mapData={mapData}
              train={selectedMapTrain}
              transferName={trip.transferName}
              positionUnavailable={Boolean(!selectedStatus?.position || stale)}
            />
          ) : mapError ? (
            <div className="live-map-error">
              <MapPin aria-hidden="true" />
              <strong>The map couldn’t load</strong>
              <button type="button" onClick={retryMap}>Try the map again</button>
            </div>
          ) : (
            <div className="live-map-loading" role="status">
              <div className="live-map-loading-lines" aria-hidden="true"><i /><i /><i /></div>
              <span>Drawing the Metro map…</span>
            </div>
          )}
        </section>

        {expired || partialTrackingEnded ? (
          <TrackerNotice
            kind="expired"
            title={expired ? 'Live tracking has ended' : `Shared train arrived at ${trackedEndpointName}`}
            copy={expired
              ? 'For privacy, live links stop updating shortly after the shared ride.'
              : 'That was the last train selected for this link. No later connection was shared.'}
          />
        ) : (
          <section className={reachedFinalMetroStation ? 'live-tracker-status-panel is-arrived' : 'live-tracker-status-panel'} aria-live="polite">
            <div className="live-arrival-summary">
              <span>{reachedFinalMetroStation ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}</span>
              <div>
                <small>{arrived ? 'TRIP COMPLETE' : reachedFinalMetroStation ? 'METRO LEG COMPLETE' : arrivalLabel}</small>
                <strong>{reachedFinalMetroStation
                  ? `Arrived at ${trip.destination.name}`
                  : arrivalHeadline(arrivalAtMs, now, false)}</strong>
                {arrivalTime && !reachedFinalMetroStation && <p>Expected around {arrivalTime}</p>}
                {reachedFinalMetroStation && trip.destPlaceContext && <p>Live train tracking ends at the station.</p>}
              </div>
            </div>
            <div className="live-next-summary">
              <small>NEXT</small>
              <strong>{reachedFinalMetroStation && trip.destPlaceContext
                ? destinationName
                : selectedStatus?.nextStop?.name ?? phaseLabel(selectedStatus)}</strong>
              {reachedFinalMetroStation && trip.destPlaceContext ? (
                <p>{trip.destPlaceContext.walkTimeMinutes} min walk from Metro</p>
              ) : selectedStatus?.nextStop && (
                <p>{nextExpectedTime ? `Expected ${nextExpectedTime}` : phaseLabel(selectedStatus)}</p>
              )}
            </div>
            <div className={stale ? 'live-status-strip is-stale' : 'live-status-strip'}>
              <span><TrainFront aria-hidden="true" /> {phaseLabel(selectedStatus)}</span>
              <span>
                {estimatedPosition ? 'Estimated position · ' : ''}
                {freshnessLabel(selectedStatus?.freshness.updatedAtMs ?? snapshot?.updatedAtMs ?? null, now)}
              </span>
            </div>
          </section>
        )}

        <footer className="live-tracker-footer">
          <span aria-hidden="true">T</span>
          Train locations update automatically from Metro live data.
        </footer>
      </div>
    </main>
  )
}
