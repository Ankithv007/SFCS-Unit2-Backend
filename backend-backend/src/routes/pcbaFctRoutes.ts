import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import {
    getBatches,
    deleteBatch,
    createPcbaFctScan,
    getScansByBatchId,
    linkUnitSerial
} from '../controllers/pcbaFctController';

const router = Router();

router.get('/batch', authenticateToken, getBatches);
router.delete('/batch/:id', authenticateToken, deleteBatch);

router.post('/scan', authenticateToken, createPcbaFctScan);
router.get('/scan/:batchId', authenticateToken, getScansByBatchId);

// Mandatory second step after PCBA-FCT PASS: link PCB barcode → Unit Serial Number
router.post('/link-serial', authenticateToken, linkUnitSerial);

export default router;
