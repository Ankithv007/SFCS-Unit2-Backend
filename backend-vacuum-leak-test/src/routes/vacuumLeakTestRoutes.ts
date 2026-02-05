import { Router } from 'express';
import {
    getFormData,
    addTpn,
    addPn,
    submitVLTInspection,
    getVLTCompletedInspections,
    exportVLTExcel,
    validateVLTSerialNumber
} from '../controllers/vacuumLeakTestController';

const router = Router();

router.get('/form-data', getFormData);
router.post('/tpn', addTpn);
router.post('/pn', addPn);
router.post('/submit', submitVLTInspection);
router.get('/completed', getVLTCompletedInspections);
router.get('/export', exportVLTExcel);
router.post('/validate-serial', validateVLTSerialNumber);

export default router;
