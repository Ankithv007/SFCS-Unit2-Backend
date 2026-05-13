import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createPackingScan,
    getScansByBatchId
} from '../controllers/packingController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createPackingScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
