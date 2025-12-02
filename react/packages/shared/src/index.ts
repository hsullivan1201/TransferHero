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
}

export interface TransferAlternative extends Transfer {
  totalTime: number
  leg1Time: number
  leg2Time: number
  timeDiff: number
  defaultTransferName?: string
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
  /** Additional details about the exit */
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
