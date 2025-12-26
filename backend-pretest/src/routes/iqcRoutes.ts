import express from 'express';
import {
    createBatch,
    scanComponent,
    getBatchComponents
} from '../controllers/iqcController';

const router = express.Router();

// IQC Routes
router.post('/batches', createBatch);
router.post('/scan', scanComponent);
router.get('/batches/:batch_id/components', getBatchComponents);

export default router;
