import { Router } from 'express';
import {
    getBatches,
    deleteBatch,
    createPthScan,
    getScansByBatchId
} from '../controllers/pthController';
import { authenticateToken, authorizeSuperAdmin, requirePermission } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';

const router = Router();

// Batch Management
router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, requirePermission('backend_pth', 'can_delete'), deleteBatch);

// Scanning
router.post('/scan', authenticateToken, createPthScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, requirePermission('backend_pth', 'can_delete'), deleteScan);

export default router;

