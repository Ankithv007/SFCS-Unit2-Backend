import { Router } from 'express';
import {
    createDowntimeRecord,
    getDowntimeRecords,
    updateDowntimeRecord,
    deleteDowntimeRecord,
    getDowntimeDashboard
} from '../controllers/smtDowntimeController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createDowntimeRecord);
router.get('/', authenticateToken, getDowntimeRecords);
router.put('/:id', authenticateToken, updateDowntimeRecord);
router.delete('/:id', authenticateToken, deleteDowntimeRecord);
router.get('/dashboard', authenticateToken, getDowntimeDashboard);

export default router;
