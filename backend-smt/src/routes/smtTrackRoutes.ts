import { Router } from 'express';
import { trackSerialNumber, trackWorkOrder, getCountDetails, downloadWorkOrderExcel } from '../controllers/smtTrackController';

const router = Router();

router.get('/count-details', getCountDetails);
router.get('/export/wo/:woId', downloadWorkOrderExcel);
router.get('/wo/:woId', trackWorkOrder);
router.get('/:id', trackSerialNumber);

export default router;
