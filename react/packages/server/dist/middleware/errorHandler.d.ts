import type { Request, Response, NextFunction } from 'express';
/**
 * Custom API error class
 */
export declare class ApiError extends Error {
    statusCode: number;
    constructor(message: string, statusCode?: number);
}
/**
 * Not found error
 */
export declare class NotFoundError extends ApiError {
    constructor(message?: string);
}
/**
 * Validation error
 */
export declare class ValidationError extends ApiError {
    constructor(message?: string);
}
/**
 * Global error handler middleware
 */
export declare function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void;
/**
 * Async handler wrapper to catch promise rejections
 */
export declare function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): (req: Request, res: Response, next: NextFunction) => void;
//# sourceMappingURL=errorHandler.d.ts.map