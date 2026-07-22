import express from 'express';
import { createBatch, getCompletedIQCBatches, scanPcb, getSessions, getSessionScans, deleteBatch, downloadBatchReport, updateScanTestResult, searchComponent, deleteScan } from '../controllers/impedanceController';
import { authenticateToken, requirePermission } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/iqc-batches', getCompletedIQCBatches);
router.post('/batches', createBatch);
router.get('/batches', getSessions);
router.delete('/batches/:batch_id', [authenticateToken, requirePermission('pre_impedance', 'can_delete')], deleteBatch);
router.get('/batches/:batch_id/download', downloadBatchReport);
router.post('/scan', scanPcb);
router.get('/search', searchComponent);
router.put('/scans/:scan_id/test', updateScanTestResult);
router.get('/sessions/:session_id/scans', getSessionScans);
router.delete('/scan/:scan_id', [authenticateToken, requirePermission('pre_impedance', 'can_delete')], deleteScan);

export default router;
