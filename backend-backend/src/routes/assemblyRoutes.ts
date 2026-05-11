import { Router } from 'express';
import { 
    createBatch, 
    getBatches, 
    deleteBatch, 
    createScan, 
    getScansByBatchId, 
    updateScanStatus 
} from '../controllers/assemblyController';

const router = Router();

router.post('/batch', createBatch);
router.get('/batch', getBatches);
router.delete('/batch/:id', deleteBatch);
router.post('/scan', createScan);
router.get('/scan/:batchId', getScansByBatchId);
router.put('/scan/:id/status', updateScanStatus);

export default router;
