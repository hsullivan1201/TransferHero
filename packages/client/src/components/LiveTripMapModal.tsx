import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRightLeft, CheckCircle2, MapPin, TrainFront, X } from 'lucide-react'
import type { LiveTrackerResponse, MetroMapData, SharedTrackedTrain } from '@transferhero/shared'
import { getLiveTrains, getMetroMap } from '../api/liveTracker'
import { LINE_COLORS } from '../utils/lineColors'
import { LiveTrainMap, type LiveMapInset } from './LiveTrainMap'
import {
  clockTime,
  connectionOutlook,
  freshnessLabel,
  LINE_NAMES,
  liveMapTrain,
  phaseLabel,
} from './liveTrackerFormat'
import '../liveTracker.css'

const POLL_INTERVAL_MS = 12_000

export interface LiveTripMapModalProps {
  trains: SharedTrackedTrain[]
  /**
   * The connection the app currently projects for leg 2, used when the rider
   * has not picked a connecting train yet: its line still lights up live.
   */
  projectedConnection?: SharedTrackedTrain | null
  transferName: string | null
  transferWalkMinutes?: number | null
  transferLevelInstruction?: string | null
  initialTrainId?: string
  onClose: () => void
}

/** In-app live map for the rider's own selected trains — no share required. */
export function LiveTripMapModal({
  trains,
  projectedConnection = null,
  transferName,
  transferWalkMinutes = null,
  transferLevelInstruction = null,
  initialTrainId,
  onClose,
}: LiveTripMapModalProps) {
  // The projection is pinned when the modal opens; live updates keep flowing
  // through polling, and reopening picks up a newer candidate.
  const [pinnedProjected] = useState(projectedConnection)
  const allTrains = useMemo(() => (
    pinnedProjected && !trains.some(train => train.leg === 2)
      ? [...trains, pinnedProjected]
      : trains
  ), [pinnedProjected, trains])
  const [mapData, setMapData] = useState<MetroMapData | null>(null)
  const [mapError, setMapError] = useState(false)
  const [mapRetry, setMapRetry] = useState(0)
  const [snapshot, setSnapshot] = useState<LiveTrackerResponse | null>(null)
  const [liveError, setLiveError] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [selectedId, setSelectedId] = useState(() => (
    initialTrainId ?? trains[0]?.id ?? ''
  ))

  useEffect(() => {
    const abortController = new AbortController()
    setMapError(false)
    getMetroMap(abortController.signal)
      .then(setMapData)
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setMapError(true)
      })
    return () => abortController.abort()
  }, [mapRetry])

  useEffect(() => {
    if (allTrains.length === 0) return
    let active = true
    let timer: number | undefined
    let request: AbortController | null = null

    const poll = async () => {
      request = new AbortController()
      try {
        const response = await getLiveTrains(allTrains, request.signal)
        if (!active) return
        setSnapshot(response)
        setLiveError(false)
        setNow(Date.now())
        if (!response.ended && !response.expired) {
          timer = window.setTimeout(poll, POLL_INTERVAL_MS)
        }
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === 'AbortError')) return
        setLiveError(true)
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
      }
    }

    void poll()
    return () => {
      active = false
      if (timer != null) window.clearTimeout(timer)
      request?.abort()
    }
  }, [allTrains])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const selectedConfig = allTrains.find(train => train.id === selectedId) ?? allTrains[0] ?? null
  const selectedStatus = snapshot?.trains.find(train => train.id === selectedConfig?.id) ?? null
  const selectedMapTrain = useMemo(() => {
    if (!selectedConfig || !mapData) return null
    return liveMapTrain(selectedConfig, selectedStatus, mapData)
  }, [mapData, selectedConfig, selectedStatus])

  // The trip's other leg stays on the map as a lit companion, whether the
  // rider picked that train or the app projected it.
  const companionConfig = allTrains.length > 1 && selectedConfig
    ? allTrains.find(train => train.id !== selectedConfig.id) ?? null
    : null
  const companionStatus = snapshot?.trains.find(train => train.id === companionConfig?.id) ?? null
  const companionIsProjected = companionConfig != null && companionConfig.id === pinnedProjected?.id
  const companionMapTrain = useMemo(() => {
    if (!companionConfig || !mapData) return null
    return liveMapTrain(companionConfig, companionStatus, mapData, { projected: companionIsProjected })
  }, [companionConfig, companionIsProjected, companionStatus, mapData])

  if (trains.length === 0) return null

  const arrived = Boolean(selectedStatus?.ended)
  const stale = Boolean(
    liveError
    || selectedStatus?.freshness.isStale
    || (snapshot && now - snapshot.updatedAtMs > 45_000)
  )
  const estimatedPosition = selectedStatus?.position?.source != null
    && selectedStatus.position.source !== 'vehicle'
  const etaClock = clockTime(selectedStatus?.eta?.arrivalAtMs)
  const boardClock = selectedStatus?.phase === 'not_started'
    ? clockTime(selectedStatus.nextStop?.expectedAtMs)
    : null
  const routeFrom = allTrains[0]?.from.name
  const routeTo = allTrains.at(-1)?.to.name

  const outlook = connectionOutlook(snapshot?.connection, transferWalkMinutes, now)

  // Arriving at the transfer, the map grows a small change-trains inset.
  let inset: LiveMapInset | null = null
  const approachingEndpoint = Boolean(
    selectedStatus
    && !selectedStatus.ended
    && selectedStatus.phase !== 'not_started'
    && selectedStatus.nextStop?.code === selectedStatus.to.code
  )
  if (approachingEndpoint && selectedStatus && selectedStatus.leg === 1 && transferName) {
    const second = allTrains.find(train => train.leg === 2)
    if (second) {
      const boardsClock = clockTime(snapshot?.connection?.boardsAtMs)
      inset = {
        kicker: 'ARRIVING · CHANGE TRAINS',
        title: selectedStatus.to.name,
        rows: [
          `${LINE_NAMES[second.line]} toward ${second.toward}${boardsClock ? ` · boards ${boardsClock}` : ''}`,
          ...(transferLevelInstruction
            ? [`Platform is ${transferLevelInstruction}${transferWalkMinutes ? ` · about ${transferWalkMinutes} min` : ''}`]
            : transferWalkMinutes
              ? [`About ${transferWalkMinutes} min transfer walk`]
              : []),
        ],
        line: second.line,
      }
    }
  }

  return createPortal(
    <div
      className="live-map-modal-overlay"
      role="presentation"
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="live-map-modal" role="dialog" aria-modal="true" aria-label="Live train map">
        <header className="live-map-modal-head">
          <div>
            <strong>Live train map</strong>
            <small>{routeFrom} <span aria-hidden="true">→</span> {routeTo}</small>
          </div>
          <button type="button" className="live-map-modal-close" onClick={onClose} aria-label="Close the live map">
            <X aria-hidden="true" />
          </button>
        </header>

        {allTrains.length > 1 ? (
          <div className="live-train-tabs" role="group" aria-label="Choose a train to follow on the map">
            {allTrains.map(train => {
              const status = snapshot?.trains.find(item => item.id === train.id)
              const isActive = train.id === selectedConfig?.id
              return (
                <button
                  type="button"
                  className={isActive ? 'live-train-chip is-active' : 'live-train-chip'}
                  key={train.id}
                  onClick={() => setSelectedId(train.id)}
                  aria-pressed={isActive}
                >
                  <span
                    className="live-train-chip-line"
                    style={{ backgroundColor: LINE_COLORS[train.line].bg, color: LINE_COLORS[train.line].text }}
                  >
                    {train.line}
                  </span>
                  <span>
                    <small>{train.leg === 1
                      ? 'First train'
                      : train.id === pinnedProjected?.id ? 'Projected connection' : 'Connecting train'}</small>
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
            {arrived ? (
              <span className="live-map-state is-arrived"><CheckCircle2 aria-hidden="true" /> TRAIN ARRIVED</span>
            ) : (
              <span className={stale
                ? 'live-map-state is-stale'
                : estimatedPosition ? 'live-map-state is-estimated' : 'live-map-state'}>
                <i aria-hidden="true" /> {stale ? 'UPDATING' : estimatedPosition ? 'ESTIMATED' : 'LIVE'}
              </span>
            )}
          </div>

          {mapData && selectedMapTrain ? (
            <LiveTrainMap
              mapData={mapData}
              train={selectedMapTrain}
              companion={companionMapTrain}
              inset={inset}
              transferName={transferName}
              positionUnavailable={Boolean(snapshot && !selectedStatus?.position && !arrived)}
            />
          ) : mapError ? (
            <div className="live-map-error">
              <MapPin aria-hidden="true" />
              <strong>The map couldn’t load</strong>
              <button type="button" onClick={() => setMapRetry(value => value + 1)}>
                Try the map again
              </button>
            </div>
          ) : (
            <div className="live-map-loading" role="status">
              <div className="live-map-loading-lines" aria-hidden="true"><i /><i /><i /></div>
              <span>Drawing the Metro map…</span>
            </div>
          )}
        </section>

        {outlook && (
          <div className={`live-connection-strip is-${outlook.state}`}>
            <span>
              <ArrowRightLeft aria-hidden="true" /> {outlook.headline}
            </span>
            {outlook.detail && <span>{outlook.detail}</span>}
          </div>
        )}

        <footer className="live-map-modal-status" aria-live="polite">
          <span><TrainFront aria-hidden="true" /> {phaseLabel(selectedStatus)}</span>
          <span>
            {!arrived && boardClock ? `Boards ${boardClock} · ` : !arrived && etaClock ? `Arrives ${etaClock} · ` : ''}
            {freshnessLabel(selectedStatus?.freshness.updatedAtMs ?? snapshot?.updatedAtMs ?? null, now)}
          </span>
        </footer>
      </div>
    </div>,
    document.body
  )
}
