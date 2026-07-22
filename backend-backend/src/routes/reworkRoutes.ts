import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, requirePermission } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';
import {
    getBatches,
    createReworkScan,
    getScans,
    deleteBatch
} from '../controllers/reworkController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, requirePermission('backend_rework', 'can_delete'), deleteBatch);

router.post('/scan', authenticateToken, createReworkScan);
router.get('/scan/:batch_id', authenticateToken, getScans);
router.delete('/scan/:scanId', authenticateToken, requirePermission('backend_rework', 'can_delete'), deleteScan);

export default router;
