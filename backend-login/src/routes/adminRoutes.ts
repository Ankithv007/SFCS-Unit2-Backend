import express from 'express';
import { getAllUsers, updateUserRole } from '../controllers/adminController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';

const router = express.Router();

// Get All Users - Accessible by Admin, Super Admin, Manager (to see who they can manage)
// For simplicity, let's allow all authenticated users to see the list, but only higher roles to edit.
// Or restrict view to Admin/Manager/Supervisor.
router.get('/users', authenticateToken, getAllUsers);

// Update Role - Protected by middleware logic inside controller, but we can also add a broad check here
router.put('/users/:userId/role', authenticateToken, updateUserRole);

export default router;
