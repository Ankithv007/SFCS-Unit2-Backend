import { Router } from 'express';
import { trackBarcode, validateScanController } from '../controllers/trackController';

const router = Router();

router.post('/validate', validateScanController);
router.get('/:id', trackBarcode);

export default router;
