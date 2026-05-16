import { Router } from 'express';
import {
    getBatches,
    deleteBatch,
    createPthScan,
    getScansByBatchId
} from '../controllers/pthController';
import { authenticateToken, authorizeSuperAdmin } from '../middleware/authMiddleware';

const router = Router();

// Batch Management
router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeSuperAdmin, deleteBatch);

// Scanning
router.post('/scan', authenticateToken, createPthScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;

