export type Line = 'RD' | 'OR' | 'SV' | 'BL' | 'YL' | 'GR';
export interface Station {
    code: string;
    name: string;
    lines: Line[];
}
export interface Train {
    Line: Line;
    DestinationName: string;
    Min: string | number;
    Car: string;
    _gtfs?: boolean;
    _scheduled?: boolean;
}
export interface CatchableTrain extends Train {
    _waitTime: number;
    _canCatch: boolean;
    _totalTime: number;
    _arrivalClock: string;
}
export interface Transfer {
    station: string;
    name: string;
    fromPlatform: string;
    toPlatform: string;
    fromLine?: Line;
    toLine?: Line;
    direct?: boolean;
}
export interface TransferConfig {
    station: string;
    name: string;
    fromPlatform: string;
    toPlatform: string;
}
export interface EvaluatedRoute {
    transfer: Transfer;
    leg1Time: number;
    transferTime: number;
    leg2Time: number;
    totalTime: number;
}
export interface TransferResult extends Transfer {
    totalTime?: number;
    leg1Time?: number;
    leg2Time?: number;
    alternatives?: TransferAlternative[];
    line?: Line;
}
export interface TransferAlternative extends Transfer {
    totalTime: number;
    leg1Time: number;
    leg2Time: number;
    timeDiff: number;
}
export interface CarPosition {
    boardCar: number;
    exitCar: number;
    legend: string;
}
export interface Termini {
    toward_a: string[];
    toward_b: string[];
}
export * from './utils/index.js';
//# sourceMappingURL=index.d.ts.map