import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';
import { deleteScan } from '../controllers/auditController';
import {
    getBatches,
    deleteBatch,
    createViScan,
    getScansByBatchId
} from '../controllers/viController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createViScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, authorizeAdminOrSuperAdmin, deleteScan);

export default router;

