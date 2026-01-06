import express from 'express';
import { createBatch, getBatches, scanComponent, getBatchComponents, deleteBatch, downloadBatchReport, searchComponent, updateComponentStatus } from '../controllers/iqcController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/batches', createBatch);
router.get('/batches', getBatches);
router.post('/scan', scanComponent);
router.get('/batches/:batch_id/components', getBatchComponents);
router.delete('/batches/:batch_id', authenticateToken, deleteBatch);
router.get('/batches/:batch_id/download', downloadBatchReport);
router.get('/search', searchComponent);
router.put('/components/:id/status', updateComponentStatus);

export default router;
