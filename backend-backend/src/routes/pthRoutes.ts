import { Router } from 'express';
import { 
    getPthDetailsByWoId,
    createBatch,
    getBatches,
    completeBatch,
    deleteBatch,
    createPthScan, 
    getScansByBatchId
} from '../controllers/pthController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Batch Management (Exact path names like /pth/batch as requested)
router.post('/batch', authenticateToken, createBatch);
router.get('/batch', authenticateToken, getBatches); // Changed from /batches to /batch
router.put('/batch/:id/complete', authenticateToken, completeBatch);
router.delete('/batch/:id', authenticateToken, deleteBatch);

// Scanning
router.post('/scan', authenticateToken, createPthScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId); // Changed from /scans to /scan
router.get('/details/:id', authenticateToken, getPthDetailsByWoId);

export default router;
