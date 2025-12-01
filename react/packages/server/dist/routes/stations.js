import { Router } from 'express';
import { ALL_STATIONS } from '../data/stations.js';
import { cacheMiddleware, CACHE_CONFIG } from '../middleware/cache.js';
const router = Router();
/**
 * GET /api/stations
 * Returns all stations for typeahead
 */
router.get('/', cacheMiddleware(CACHE_CONFIG.stations), (_req, res) => {
    res.json({
        stations: ALL_STATIONS
    });
});
export default router;
//# sourceMappingURL=stations.js.map