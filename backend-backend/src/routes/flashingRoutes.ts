import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, requirePermission } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createFlashingScan,
    getScansByBatchId
} from '../controllers/flashingController';
import { deleteScan } from '../controllers/auditController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, requirePermission('backend_flashing', 'can_delete'), deleteBatch);

router.post('/scan', authenticateToken, createFlashingScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, requirePermission('backend_flashing', 'can_delete'), deleteScan);

export default router;
