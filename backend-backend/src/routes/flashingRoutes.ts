import { Router } from 'express';
import { 
    createBatch, 
    getBatches, 
    deleteBatch, 
    createScan, 
    getScansByBatchId, 
    updateScanStatus 
} from '../controllers/flashingController';

const router = Router();

router.post('/batch', createBatch);
router.get('/batch', getBatches);
router.delete('/batch/:id', deleteBatch);
router.post('/scan', createScan);
router.get('/batch/:batchId/scans', getScansByBatchId);
router.put('/scan/:id', updateScanStatus);

export default router;
