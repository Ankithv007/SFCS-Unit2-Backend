import { Router } from 'express';
import { downloadBatchReport } from '../controllers/exportController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.get('/batch-report', authenticateToken, downloadBatchReport);

export default router;
