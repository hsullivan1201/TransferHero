import type { Station, Transfer, EvaluatedRoute, TransferResult } from '@transferhero/shared';
/**
 * Find all possible transfer stations between origin and destination
 */
export declare function findAllPossibleTransfers(fromCode: string, toCode: string, transferWalkTime?: number): Transfer[];
/**
 * Evaluate the total journey time for a specific transfer route
 */
export declare function evaluateTransferRoute(fromCode: string, toCode: string, transfer: Transfer, transferWalkTime?: number): EvaluatedRoute;
/**
 * Find the optimal transfer point between two stations
 * Returns the fastest option with alternatives
 */
export declare function findTransfer(fromCode: string, toCode: string, transferWalkTime?: number): TransferResult | null;
/**
 * Get all termini for a station based on which lines serve it
 */
export declare function getAllTerminiForStation(station: Station, fromPlatform: string, toStationCode: string): string[];
//# sourceMappingURL=pathfinding.d.ts.map