import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    getBatches,
    createReworkScan,
    getPendingReworkItems,
    getScansByBatchId,
    deleteBatch
} from '../controllers/reworkController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createReworkScan);
router.get('/pending', authenticateToken, getPendingReworkItems);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
