import { Router } from 'express';
import { 
    getPthDetailsByWoId,
    createPthScan, 
    getPthScansByWoId 
} from '../controllers/pthController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

// PTH Data Routes
router.get('/details/:id', authenticateToken, getPthDetailsByWoId);
router.post('/scan', authenticateToken, createPthScan);
router.get('/scans/:woId', authenticateToken, getPthScansByWoId);

export default router;
