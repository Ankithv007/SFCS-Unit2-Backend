import { Router } from 'express';
import { trackSerialNumber } from '../controllers/smtTrackController';

const router = Router();

router.get('/:id', trackSerialNumber);

export default router;
