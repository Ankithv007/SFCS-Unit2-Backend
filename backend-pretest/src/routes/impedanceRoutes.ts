import express from 'express';
import { createBatch, getCompletedIQCBatches, scanPcb, getSessions, getSessionScans, deleteBatch, downloadBatchReport, updateScanTestResult, searchComponent } from '../controllers/impedanceController';

const router = express.Router();

router.get('/iqc-batches', getCompletedIQCBatches);
router.post('/batches', createBatch);
router.get('/batches', getSessions);
router.delete('/batches/:batch_id', deleteBatch);
router.get('/batches/:batch_id/download', downloadBatchReport);
router.post('/scan', scanPcb);
router.get('/search', searchComponent);
router.put('/scans/:scan_id/test', updateScanTestResult);
router.get('/sessions/:session_id/scans', getSessionScans);

export default router;
