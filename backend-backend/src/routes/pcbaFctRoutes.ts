import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createPcbaFctScan,
    getScansByBatchId,
    linkUnitSerial
} from '../controllers/pcbaFctController';
import { deleteScan } from '../controllers/auditController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteBatch);

router.post('/scan', authenticateToken, createPcbaFctScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, authorizeAdminOrSuperAdmin, deleteScan);

// Mandatory second step after PCBA-FCT PASS: link PCB barcode → Unit Serial Number
router.post('/link-serial', authenticateToken, linkUnitSerial);

export default router;
