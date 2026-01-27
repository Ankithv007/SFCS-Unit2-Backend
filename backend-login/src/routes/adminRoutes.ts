import express from 'express';
import { getAllUsers, updateUserRole } from '../controllers/adminController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';

const router = express.Router();

// Get All Users - Restricted to Admin, Super Admin, and Manager roles
router.get('/users', authenticateToken, requireRole(['Admin', 'Super Admin', 'Manager']), getAllUsers);

// Update Role - Protected by authenticateToken and internal logic in the controller
// The controller performs a hierarchy check to ensure users can only assign roles lower than their own.
router.put('/users/:userId/role', authenticateToken, updateUserRole);

export default router;
