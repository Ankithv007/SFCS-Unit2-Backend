import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createPcbaFctScan,
    getScansByBatchId
} from '../controllers/pcbaFctController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createPcbaFctScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
