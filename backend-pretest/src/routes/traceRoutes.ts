import { Router } from 'express';
import { getBarcodeHistory } from '../controllers/traceController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// Endpoint to trace a barcode's history
// Use GET /api/trace/:barcode
router.get('/:barcode', authenticateToken, getBarcodeHistory);

export default router;
