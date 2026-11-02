import { Router } from 'express';
import { updateScan } from '../controllers/scanController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.put('/:id', authenticateToken, updateScan);

export default router;
