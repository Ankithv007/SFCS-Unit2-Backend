import { Router } from 'express';
import {
    createDowntimeRecord,
    getDowntimeRecords,
    updateDowntimeRecord,
    deleteDowntimeRecord,
    getDowntimeDashboard,
    getPendingWorkOrders
} from '../controllers/smtDowntimeController';
import { authenticateToken, requirePermission } from '../middleware/authMiddleware';

const router = Router();

router.post('/', authenticateToken, createDowntimeRecord);
router.get('/', authenticateToken, getDowntimeRecords);
router.get('/pending-wos', authenticateToken, getPendingWorkOrders);
router.put('/:id', authenticateToken, updateDowntimeRecord);
router.delete('/:id', [authenticateToken, requirePermission('smt_downtime', 'can_delete')], deleteDowntimeRecord);
router.get('/dashboard', authenticateToken, getDowntimeDashboard);

export default router;
