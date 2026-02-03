import express from 'express';
import {
    getShifts,
    createShift,
    updateShift,
    deleteShift,
    addTpn,
    addPn,
    validateSerialNumber,
    validatePam,
    validateRanBarcode,
    getCompletedInspections,
    exportInspectionsExcel,
    getFormData,
    submitInspection
} from '../controllers/qcInspectionController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';
import { ROLES } from '../constants/roles';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken as any);

// Form Data Route
router.get('/form-data', getFormData as any);
router.post('/submit', submitInspection as any);

// Shift Management Routes
// CRUD visibility for Super Admin; Read-only for Admin & Manager; Restricted for others
router.get('/shifts', requireRole([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER]), getShifts as any);
router.post('/shifts', requireRole([ROLES.SUPER_ADMIN]), createShift as any);
router.put('/shifts/:id', requireRole([ROLES.SUPER_ADMIN]), updateShift as any);
router.delete('/shifts/:id', requireRole([ROLES.SUPER_ADMIN]), deleteShift as any);

// TPN/PN Management Routes
router.post('/tpn', addTpn as any);
router.post('/pn', addPn as any);
router.post('/validate-sn', validateSerialNumber as any);
router.post('/validate-pam', validatePam as any);
router.post('/validate-ran', validateRanBarcode as any);
router.get('/completed', getCompletedInspections as any);
router.get('/export', exportInspectionsExcel as any);

export default router;
