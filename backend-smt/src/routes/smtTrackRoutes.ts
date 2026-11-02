import { Router } from 'express';
import { trackSerialNumber, trackWorkOrder, getCountDetails, downloadWorkOrderExcel, downloadSerialNumberExcel } from '../controllers/smtTrackController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';

const router = Router();
const canonicalRoleAccess = [authenticateToken, requireRole(['Super Admin', 'Admin', 'Manager', 'Supervisor', 'Operator', 'User'])];

router.get('/count-details', canonicalRoleAccess, getCountDetails);
router.get('/export/wo/:woId', canonicalRoleAccess, downloadWorkOrderExcel);
router.get('/export/serial/:id', canonicalRoleAccess, downloadSerialNumberExcel);
router.get('/wo/:woId', canonicalRoleAccess, trackWorkOrder);
router.get('/:id', canonicalRoleAccess, trackSerialNumber);

export default router;
