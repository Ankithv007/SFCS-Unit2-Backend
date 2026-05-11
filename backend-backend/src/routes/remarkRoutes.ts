import express from 'express';
import { 
    createBatch, 
    getBatches, 
    deleteBatch, 
    createRemarkScan, 
    getScansByBatchId, 
    updateScanStatus,
    getPendingRemarkItems,
    getLatestResolution,
    closePendingItem
} from '../controllers/remarkController';

const router = express.Router();

router.post('/batch', createBatch);
router.get('/batches', getBatches);
router.delete('/batch/:id', deleteBatch);
router.post('/scan', createRemarkScan);
router.get('/scans/:batchId', getScansByBatchId);
router.put('/scan/:id/status', updateScanStatus);
router.get('/pending-items', getPendingRemarkItems);
router.get('/resolution/:barcode', getLatestResolution);
router.post('/close-item/:barcode', closePendingItem);

export default router;
