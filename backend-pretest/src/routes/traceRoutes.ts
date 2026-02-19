import { Router } from 'express';
import { getBarcodeHistory, getBatchSummary } from '../controllers/traceController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Endpoint to trace a barcode's history
// Use GET /api/trace/:barcode
router.get('/:barcode', authenticateToken, getBarcodeHistory);

// Endpoint to get batch-wise summary
router.get('/batch-summary/:batchInput', authenticateToken, getBatchSummary);

export default router;
