import { Router } from 'express';
import { updateScan } from '../controllers/scanController';
import { authenticateToken, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';

const router = Router();

router.put('/:id', authenticateToken, authorizeAdminOrSuperAdmin, updateScan);

export default router;
