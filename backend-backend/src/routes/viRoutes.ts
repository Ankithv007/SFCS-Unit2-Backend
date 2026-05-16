import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createViScan,
    getScansByBatchId
} from '../controllers/viController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createViScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;

