import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, MapPin, TrainFront, X } from 'lucide-react'
import type { LiveTrackerResponse, MetroMapData, SharedTrackedTrain } from '@transferhero/shared'
import { getLiveTrains, getMetroMap } from '../api/liveTracker'
import { LINE_COLORS } from '../utils/lineColors'
import { LiveTrainMap } from './LiveTrainMap'
import {
  clockTime,
  freshnessLabel,
  LINE_NAMES,
  liveMapTrain,
  phaseLabel,
} from './liveTrackerFormat'
import '../liveTracker.css'

const POLL_INTERVAL_MS = 12_000

export interface LiveTripMapModalProps {
  trains: SharedTrackedTrain[]
  transferName: string | null
  initialTrainId?: string
  onClose: () => void
}

/** In-app live map for the rider's own selected trains — no share required. */
export function LiveTripMapModal({
  trains,
  transferName,
  initialTrainId,
  onClose,
}: LiveTripMapModalProps) {
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
    if (trains.length === 0) return
    let active = true
    let timer: number | undefined
    let request: AbortController | null = null

    const poll = async () => {
      request = new AbortController()
      try {
        const response = await getLiveTrains(trains, request.signal)
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
  }, [trains])

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

  const selectedConfig = trains.find(train => train.id === selectedId) ?? trains[0] ?? null
  const selectedStatus = snapshot?.trains.find(train => train.id === selectedConfig?.id) ?? null
  const selectedMapTrain = useMemo(() => {
    if (!selectedConfig || !mapData) return null
    return liveMapTrain(selectedConfig, selectedStatus, mapData)
  }, [mapData, selectedConfig, selectedStatus])

  if (trains.length === 0) return null

  const arrived = Boolean(selectedStatus?.ended)
  const stale = Boolean(
    liveError
    || selectedStatus?.freshness.isStale
    || (selectedStatus && now - selectedStatus.freshness.updatedAtMs > 45_000)
  )
  const etaClock = clockTime(selectedStatus?.eta?.arrivalAtMs)
  const routeFrom = trains[0]?.from.name
  const routeTo = trains.at(-1)?.to.name

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

        {trains.length > 1 ? (
          <div className="live-train-tabs" role="group" aria-label="Choose a train to follow on the map">
            {trains.map(train => {
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
            {arrived ? (
              <span className="live-map-state is-arrived"><CheckCircle2 aria-hidden="true" /> TRAIN ARRIVED</span>
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

        <footer className="live-map-modal-status" aria-live="polite">
          <span><TrainFront aria-hidden="true" /> {phaseLabel(selectedStatus)}</span>
          <span>
            {!arrived && etaClock ? `Arrives ${etaClock} · ` : ''}
            {freshnessLabel(selectedStatus?.freshness.updatedAtMs ?? snapshot?.updatedAtMs ?? null, now)}
          </span>
        </footer>
      </div>
    </div>,
    document.body
  )
}
