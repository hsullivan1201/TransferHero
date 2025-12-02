// Shared types for TransferHero

export type Line = 'RD' | 'OR' | 'SV' | 'BL' | 'YL' | 'GR'

export interface Station {
  code: string
  name: string
  lines: Line[]
}

export interface Train {
  Line: Line
  DestinationName: string
  Min: string | number
  Car: string
  _gtfs?: boolean
  _scheduled?: boolean
  /** Trip ID from GTFS-RT for tracking across stations */
  _tripId?: string
  /** Real-time arrival at destination station (minutes from now) */
  _destArrivalMin?: number
  /** Formatted clock time of destination arrival (e.g., "8:57 PM") */
  _destArrivalTime?: string
  /** Exact Unix timestamp (ms) of destination arrival for precise calculations */
  _destArrivalTimestamp?: number
  /** Real-time arrival at transfer station (minutes from now) */
  _transferArrivalMin?: number
  /** Formatted clock time of transfer station arrival (e.g., "9:20 PM") */
  _transferArrivalTime?: string
  /** Exact Unix timestamp (ms) of transfer station arrival for precise calculations */
  _transferArrivalTimestamp?: number
  /** Source of realtime data: 'wmata' or 'gtfs-rt' */
  _realtimeSource?: 'wmata' | 'gtfs-rt'
}

export interface CatchableTrain extends Train {
  _waitTime: number
  _canCatch: boolean
  _totalTime: number
  _arrivalClock: string
}

export interface Transfer {
  station: string
  name: string
  fromPlatform: string
  toPlatform: string
  fromLine?: Line
  toLine?: Line
  direct?: boolean
}

export interface TransferConfig {
  station: string
  name: string
  fromPlatform: string
  toPlatform: string
}

export interface EvaluatedRoute {
  transfer: Transfer
  leg1Time: number
  transferTime: number
  leg2Time: number
  totalTime: number
}

export interface TransferResult extends Transfer {
  totalTime?: number
  leg1Time?: number
  leg2Time?: number
  alternatives?: TransferAlternative[]
  line?: Line
  // Added this missing property
  defaultTransferName?: string
}

export interface TransferAlternative extends Transfer {
  totalTime: number
  leg1Time: number
  leg2Time: number
  timeDiff: number
}

/**
 * Individual exit option at a station
 */
export interface ExitOption {
  /** Which car to exit from (1-8) */
  car: number
  /** Position in train (front/middle/back) */
  position: 'front' | 'middle' | 'back'
  /** Type of exit */
  type: 'escalator' | 'elevator' | 'stairs' | 'exit'
  /** Human-readable label (e.g., "Exit 1: Q St" or "12th & G") */
  label: string
  /** Optional additional description */
  description?: string
  /** Platform x-position for reference */
  xPosition?: number
  /** Whether this is the preferred/recommended exit */
  preferred?: boolean
}

/**
 * Car position recommendation for optimal boarding/exiting
 * Based on real platform exit data from DCMetroStationExits dataset
 */
export interface CarPosition {
  /** Which car to board (1-8, front to back) */
  boardCar: number
  /** Which car to exit from (1-8) */
  exitCar: number
  /** Position in train (front/middle/back) */
  boardPosition?: 'front' | 'middle' | 'back'
  /** Human-readable description */
  legend: string
  /** Confidence level of the recommendation */
  confidence?: 'high' | 'medium' | 'low'
  /** All valid exits at destination (for direct trips and leg2 only) */
  exits?: ExitOption[]
  /** Additional details about the primary exit */
  details?: {
    exitType?: 'escalator' | 'elevator' | 'stairs' | 'exit'
    exitDescription?: string
    xPosition?: number
  }
}

export interface Termini {
  toward_a: string[]
  toward_b: string[]
}

// Re-export utilities
export * from './utils/index.js'