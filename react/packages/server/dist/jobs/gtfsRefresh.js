import cron from 'node-cron';
import { setGtfsLastUpdated } from '../routes/health.js';
import { clearAllCache } from '../middleware/cache.js';
/**
 * GTFS data refresh job
 * Downloads and processes GTFS data from WMATA
 */
async function refreshGtfs() {
    console.log('[GTFS Refresh] Starting...');
    try {
        // TODO: Implement actual GTFS download and processing
        // This would:
        // 1. Download GTFS static data from WMATA
        // 2. Process stops.txt, trips.txt, stop_times.txt
        // 3. Regenerate static-trips.ts and schedule-data.ts
        // 4. Clear caches
        // For now, just clear caches and update timestamp
        clearAllCache();
        setGtfsLastUpdated(new Date());
        console.log('[GTFS Refresh] Complete');
    }
    catch (error) {
        console.error('[GTFS Refresh] Error:', error);
    }
}
/**
 * Initialize GTFS refresh cron job
 */
export function initGtfsRefreshJob() {
    // Get cron schedule from environment or use default (3 AM daily)
    const schedule = process.env.GTFS_REFRESH_CRON || '0 3 * * *';
    console.log(`[GTFS Refresh] Scheduling job with cron: ${schedule}`);
    cron.schedule(schedule, async () => {
        await refreshGtfs();
    });
    // Set initial timestamp
    setGtfsLastUpdated(new Date());
}
/**
 * Manually trigger GTFS refresh
 */
export async function triggerGtfsRefresh() {
    await refreshGtfs();
}
//# sourceMappingURL=gtfsRefresh.js.map