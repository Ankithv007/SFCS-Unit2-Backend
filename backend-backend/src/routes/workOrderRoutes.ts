import express from 'express';
import { createWorkOrder, getAllWorkOrders, deleteWorkOrder } from '../controllers/workOrderController';
import { authenticateToken, requirePermission } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/', createWorkOrder);
router.get('/', getAllWorkOrders);
router.delete('/:id', authenticateToken, requirePermission('backend_work_order', 'can_delete'), deleteWorkOrder);

export default router;
