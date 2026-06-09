import express from 'express';
import { createWorkOrder, getAllWorkOrders, deleteWorkOrder } from '../controllers/workOrderController';
import { authenticateToken, authorizeAdminOrSuperAdmin } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/', createWorkOrder);
router.get('/', getAllWorkOrders);
router.delete('/:id', authenticateToken, authorizeAdminOrSuperAdmin, deleteWorkOrder);

export default router;
