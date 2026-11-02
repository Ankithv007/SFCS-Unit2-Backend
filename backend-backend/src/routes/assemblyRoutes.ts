import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, requirePermission } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';
import {
    getBatches,
    deleteBatch,
    createAssemblyScan,
    getScansByBatchId
} from '../controllers/assemblyController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, requirePermission('backend_assembly', 'can_delete'), deleteBatch);

router.post('/scan', authenticateToken, createAssemblyScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, requirePermission('backend_assembly', 'can_delete'), deleteScan);

export default router;
