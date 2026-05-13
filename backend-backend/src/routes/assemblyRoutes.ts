import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createAssemblyScan,
    getScansByBatchId
} from '../controllers/assemblyController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createAssemblyScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

export default router;
