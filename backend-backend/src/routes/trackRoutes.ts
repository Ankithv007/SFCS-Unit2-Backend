import { Router } from 'express';
import { trackBarcode, validateScanController, trackWorkOrder } from '../controllers/trackController';

const router = Router();

router.post('/validate', validateScanController);
router.get('/wo/:woId', trackWorkOrder);
router.get('/:id', trackBarcode);

export default router;
