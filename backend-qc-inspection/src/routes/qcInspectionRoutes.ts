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

const router = express.Router();

// Form Data Route
router.get('/form-data', getFormData as any);
router.post('/submit', submitInspection as any);

// Shift Management Routes
router.get('/shifts', getShifts as any);
router.post('/shifts', createShift as any);
router.put('/shifts/:id', updateShift as any);
router.delete('/shifts/:id', deleteShift as any);

// TPN/PN Management Routes
router.post('/tpn', addTpn as any);
router.post('/pn', addPn as any);
router.post('/validate-sn', validateSerialNumber as any);
router.post('/validate-pam', validatePam as any);
router.post('/validate-ran', validateRanBarcode as any);
router.get('/completed', getCompletedInspections as any);
router.get('/export', exportInspectionsExcel as any);

export default router;
