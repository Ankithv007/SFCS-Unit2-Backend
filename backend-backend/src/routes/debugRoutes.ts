import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';
import {
    getBatches,
    createDebugScan,
    getScans,
    deleteBatch
} from '../controllers/debugController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createDebugScan);
router.get('/scan/:batch_id', authenticateToken, getScans);
router.delete('/scan/:scanId', authenticateToken, authorizeAdminOrSuperAdmin, deleteScan);

export default router;
