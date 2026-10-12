import { Router } from 'express';
import { trackBarcode, validateScanController, trackWorkOrder, getBatchUnitDetails, downloadWorkOrderExcel, downloadSerialExcel } from '../controllers/trackController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/validate', validateScanController);
router.get('/wo/:woId/export/excel', downloadWorkOrderExcel);
router.get('/wo/:woId', trackWorkOrder);
router.get('/batch-units', authenticateToken, getBatchUnitDetails);
router.get('/:id/export/excel', downloadSerialExcel);
router.get('/:id', trackBarcode);

export default router;
