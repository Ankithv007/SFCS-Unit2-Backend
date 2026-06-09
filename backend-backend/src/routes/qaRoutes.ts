import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createQaScan,
    getScansByBatchId
} from '../controllers/qaController';
import { deleteScan } from '../controllers/auditController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createQaScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, authorizeAdminOrSuperAdmin, deleteScan);

export default router;
