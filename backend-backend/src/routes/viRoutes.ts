import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, requirePermission } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';
import {
    getBatches,
    deleteBatch,
    createViScan,
    getScansByBatchId
} from '../controllers/viController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, requirePermission('backend_vi', 'can_delete'), deleteBatch);

router.post('/scan', authenticateToken, createViScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, requirePermission('backend_vi', 'can_delete'), deleteScan);

export default router;

