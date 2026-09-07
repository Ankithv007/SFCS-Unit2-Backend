import express from 'express';
import { createWorkOrder, getAllWorkOrders, getWorkOrderById, deleteWorkOrder } from '../controllers/workOrderController';
import { authenticateToken, requirePermission } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/', createWorkOrder);
router.get('/', getAllWorkOrders);
router.get('/:id', getWorkOrderById);
router.delete('/:id', authenticateToken, requirePermission('backend_work_order', 'can_delete'), deleteWorkOrder);

export default router;
