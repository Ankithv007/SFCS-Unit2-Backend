import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    getBatches,
    createDebugScan,
    getPendingDebugItems,
    getScansByBatchId,
    deleteBatch
} from '../controllers/debugController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createDebugScan);
router.get('/pending', authenticateToken, getPendingDebugItems);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
