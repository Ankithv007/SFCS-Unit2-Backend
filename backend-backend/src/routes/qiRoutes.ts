import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createQiScan,
    getScansByBatchId
} from '../controllers/qiController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createQiScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
