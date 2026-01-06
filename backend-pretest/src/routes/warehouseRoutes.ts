import express from 'express';
import { createBatch, getBatches, scanItem, getBatchScans, deleteBatch, downloadBatchReport, searchItem } from '../controllers/warehouseController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/batches', createBatch);
router.get('/batches', getBatches);
router.post('/scan', scanItem);
router.get('/batches/:batch_id/scans', getBatchScans);
router.delete('/batches/:batch_id', authenticateToken, deleteBatch);
router.get('/batches/:batch_id/download', downloadBatchReport);
router.get('/search', searchItem);

export default router;
