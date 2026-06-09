import { Router } from 'express';
import {
    getBatches,
    deleteBatch,
    createPthScan,
    getScansByBatchId
} from '../controllers/pthController';
import { authenticateToken, authorizeSuperAdmin, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';

const router = Router();

// Batch Management
router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteBatch);

// Scanning
router.post('/scan', authenticateToken, createPthScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, authorizeAdminOrSuperAdmin, deleteScan);

export default router;

