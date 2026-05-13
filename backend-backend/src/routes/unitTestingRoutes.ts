import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createUnitTestingScan,
    getScansByBatchId
} from '../controllers/unitTestingController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createUnitTestingScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
