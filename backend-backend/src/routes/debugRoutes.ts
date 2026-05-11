import express from 'express';
import { 
    createBatch, 
    getBatches, 
    deleteBatch, 
    createDebugScan, 
    getScansByBatchId, 
    updateScanStatus,
    getPendingDebugItems,
    closePendingItem
} from '../controllers/debugController';

const router = express.Router();

router.post('/batch', createBatch);
router.get('/batches', getBatches);
router.delete('/batch/:id', deleteBatch);
router.post('/scan', createDebugScan);
router.get('/scans/:batchId', getScansByBatchId);
router.put('/scan/:id/status', updateScanStatus);
router.get('/pending-items', getPendingDebugItems);
router.post('/close-item/:barcode', closePendingItem);

export default router;
