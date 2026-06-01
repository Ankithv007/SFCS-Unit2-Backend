import { Router } from 'express';
import { trackSerialNumber, trackWorkOrder, getCountDetails } from '../controllers/smtTrackController';

const router = Router();

router.get('/count-details', getCountDetails);
router.get('/wo/:woId', trackWorkOrder);
router.get('/:id', trackSerialNumber);

export default router;
