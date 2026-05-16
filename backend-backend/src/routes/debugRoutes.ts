import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin } from '../middleware/authMiddleware';
import {
    getBatches,
    createDebugScan,
    getScans,
    deleteBatch
} from '../controllers/debugController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createDebugScan);
router.get('/scan/:batch_id', authenticateToken, getScans);

export default router;
