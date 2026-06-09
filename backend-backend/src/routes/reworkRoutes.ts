import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';
import {
    getBatches,
    createReworkScan,
    getScans,
    deleteBatch
} from '../controllers/reworkController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createReworkScan);
router.get('/scan/:batch_id', authenticateToken, getScans);
router.delete('/scan/:scanId', authenticateToken, authorizeAdminOrSuperAdmin, deleteScan);

export default router;
