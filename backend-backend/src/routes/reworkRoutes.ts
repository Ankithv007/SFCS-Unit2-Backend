import express from 'express';
import { 
    createBatch, 
    getBatches, 
    deleteBatch, 
    createReworkScan, 
    getScansByBatchId, 
    updateScanStatus,
    getPendingReworkItems,
    getLatestResolution,
    closePendingItem
} from '../controllers/reworkController';

const router = express.Router();

router.post('/batch', createBatch);
router.get('/batches', getBatches);
router.delete('/batch/:id', deleteBatch);
router.post('/scan', createReworkScan);
router.get('/scans/:batchId', getScansByBatchId);
router.put('/scan/:id/status', updateScanStatus);
router.get('/pending-items', getPendingReworkItems);
router.get('/resolution/:barcode', getLatestResolution);
router.post('/close-item/:barcode', closePendingItem);

export default router;
