import { ZodError } from 'zod';
/**
 * Custom API error class
 */
export class ApiError extends Error {
    statusCode;
    constructor(message, statusCode = 500) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ApiError';
    }
}
/**
 * Not found error
 */
export class NotFoundError extends ApiError {
    constructor(message = 'Resource not found') {
        super(message, 404);
        this.name = 'NotFoundError';
    }
}
/**
 * Validation error
 */
export class ValidationError extends ApiError {
    constructor(message = 'Validation failed') {
        super(message, 400);
        this.name = 'ValidationError';
    }
}
/**
 * Global error handler middleware
 */
export function errorHandler(err, _req, res, _next) {
    console.error('[Error]', err.message);
    // Handle Zod validation errors
    if (err instanceof ZodError) {
        res.status(400).json({
            error: 'Validation failed',
            details: err.issues.map((issue) => ({
                field: issue.path.join('.'),
                message: issue.message
            }))
        });
        return;
    }
    // Handle custom API errors
    if (err instanceof ApiError) {
        res.status(err.statusCode).json({
            error: err.message
        });
        return;
    }
    // Handle unknown errors
    res.status(500).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message
    });
}
/**
 * Async handler wrapper to catch promise rejections
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
//# sourceMappingURL=errorHandler.js.map