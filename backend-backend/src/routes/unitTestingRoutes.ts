import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, requirePermission } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';
import {
    getBatches,
    deleteBatch,
    createUnitTestingScan,
    getScansByBatchId
} from '../controllers/unitTestingController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, requirePermission('backend_unit_testing', 'can_delete'), deleteBatch);

router.post('/scan', authenticateToken, createUnitTestingScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, requirePermission('backend_unit_testing', 'can_delete'), deleteScan);

export default router;
