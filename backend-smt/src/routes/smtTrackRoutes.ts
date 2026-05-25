import { Router } from 'express';
import { trackSerialNumber, trackWorkOrder } from '../controllers/smtTrackController';

const router = Router();

router.get('/wo/:woId', trackWorkOrder);
router.get('/:id', trackSerialNumber);

export default router;
