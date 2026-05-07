import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    createBatch,
    getBatches,
    completeBatch,
    deleteBatch,
    createViScan,
    getScansByBatchId,
    updateScanStatus
} from '../controllers/viController';

const router = Router();

router.post('/batch', authenticateToken, createBatch);
router.get('/batch', authenticateToken, getBatches);
router.put('/batch/:id/complete', authenticateToken, completeBatch);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createViScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.put('/scan/:id/status', authenticateToken, updateScanStatus);

export default router;
