import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin } from '../middleware/authMiddleware';
import {
    getBatches,
    createReworkScan,
    getScans,
    deleteBatch
} from '../controllers/reworkController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createReworkScan);
router.get('/scan/:batch_id', authenticateToken, getScans);

export default router;
