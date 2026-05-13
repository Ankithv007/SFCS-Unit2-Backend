import { Router } from 'express';
import {
    getBatches,
    deleteBatch,
    createPthScan,
    getScansByBatchId
} from '../controllers/pthController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Batch Management
router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

// Scanning
router.post('/scan', authenticateToken, createPthScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;

