import { Router } from 'express';
const router = Router();
// Track server start time
const startTime = Date.now();
// Track GTFS last update (will be set by cron job)
let gtfsLastUpdated = null;
/**
 * Update GTFS timestamp (called by cron job)
 */
export function setGtfsLastUpdated(date) {
    gtfsLastUpdated = date;
}
/**
 * GET /api/health
 * Health check endpoint for monitoring
 */
router.get('/', (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    res.json({
        status: 'ok',
        gtfsLastUpdated: gtfsLastUpdated?.toISOString() || null,
        uptime: uptime,
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development'
    });
});
export default router;
//# sourceMappingURL=health.js.map