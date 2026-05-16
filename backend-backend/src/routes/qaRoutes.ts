import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createQaScan,
    getScansByBatchId
} from '../controllers/qaController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createQaScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
