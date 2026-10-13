import { Router } from 'express';
import { trackSerialNumber, trackWorkOrder, getCountDetails, downloadWorkOrderExcel, downloadSerialNumberExcel } from '../controllers/smtTrackController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.get('/count-details', authenticateToken, getCountDetails);
router.get('/export/wo/:woId', authenticateToken, downloadWorkOrderExcel);
router.get('/export/serial/:id', authenticateToken, downloadSerialNumberExcel);
router.get('/wo/:woId', authenticateToken, trackWorkOrder);
router.get('/:id', authenticateToken, trackSerialNumber);

export default router;
