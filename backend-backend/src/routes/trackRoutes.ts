import { Router } from 'express';
import { trackBarcode, validateScanController, trackWorkOrder, getBatchUnitDetails, downloadWorkOrderExcel, downloadSerialExcel } from '../controllers/trackController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';

const router = Router();
const canonicalRoleAccess = [authenticateToken, requireRole(['Super Admin', 'Admin', 'Manager', 'Supervisor', 'Operator', 'User'])];
const stationScanAccess = [authenticateToken, requireRole(['Super Admin', 'Admin', 'Manager', 'Supervisor', 'Operator', 'User'])];

router.post('/validate', stationScanAccess, validateScanController);
router.get('/wo/:woId/export/excel', canonicalRoleAccess, downloadWorkOrderExcel);
router.get('/wo/:woId', canonicalRoleAccess, trackWorkOrder);
router.get('/batch-units', canonicalRoleAccess, getBatchUnitDetails);
router.get('/:id/export/excel', canonicalRoleAccess, downloadSerialExcel);
router.get('/:id', canonicalRoleAccess, trackBarcode);

export default router;
