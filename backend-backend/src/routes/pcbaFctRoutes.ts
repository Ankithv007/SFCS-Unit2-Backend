import { Router } from 'express';
import { authenticateToken, authorizeSuperAdmin, requirePermission } from '../middleware/authMiddleware';
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
router.delete('/batch/:id', authenticateToken, requirePermission('backend_pcba_fct', 'can_delete'), deleteBatch);

router.post('/scan', authenticateToken, createPcbaFctScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);
router.delete('/scan/:scanId', authenticateToken, requirePermission('backend_pcba_fct', 'can_delete'), deleteScan);

// Mandatory second step after PCBA-FCT PASS: link PCB barcode → Unit Serial Number
router.post('/link-serial', authenticateToken, linkUnitSerial);

export default router;
