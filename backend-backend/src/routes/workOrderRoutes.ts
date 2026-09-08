import express from 'express';
import { createWorkOrder, getAllWorkOrders, getWorkOrderById, deleteWorkOrder } from '../controllers/workOrderController';
import { authenticateToken, requirePermission } from '../middleware/authMiddleware';
import { syncSmtWorkOrders } from '../services/workOrderSyncService';

const router = express.Router();

router.post('/sync', async (_req, res) => {
    try {
        await syncSmtWorkOrders({ force: true });
        res.status(200).json({ success: true, message: 'Work orders synchronized successfully' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});
router.post('/', createWorkOrder);
router.get('/', getAllWorkOrders);
router.get('/:id', getWorkOrderById);
router.delete('/:id', authenticateToken, requirePermission('backend_work_order', 'can_delete'), deleteWorkOrder);

export default router;
