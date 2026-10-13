import { Router } from 'express';
import { trackBarcode, validateScanController, trackWorkOrder, getBatchUnitDetails, downloadWorkOrderExcel, downloadSerialExcel } from '../controllers/trackController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/validate', validateScanController);
router.get('/wo/:woId/export/excel', authenticateToken, downloadWorkOrderExcel);
router.get('/wo/:woId', authenticateToken, trackWorkOrder);
router.get('/batch-units', authenticateToken, getBatchUnitDetails);
router.get('/:id/export/excel', authenticateToken, downloadSerialExcel);
router.get('/:id', authenticateToken, trackBarcode);

export default router;
