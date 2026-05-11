import { Router } from 'express';
import { trackBarcode } from '../controllers/trackController';

const router = Router();

router.get('/:id', trackBarcode);

export default router;
