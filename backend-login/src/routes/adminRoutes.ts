import express from 'express';
import {
    getUsers,
    createUser,
    updateUser,
    softDeleteUser,
    restoreUser,
    setUserStatus,
    resetUserPassword,
    updateUserRole,
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    getAuditLogs
} from '../controllers/adminController';
import { authenticateToken, requireRole } from '../middleware/authMiddleware';

const router = express.Router();

// Require Super Admin, Admin, or Manager role for all Admin panel routes
const adminAuth = [authenticateToken, requireRole(['Super Admin', 'Admin', 'Manager'])];

// ----------------------------
// User Management Routes
// ----------------------------
router.get('/users', adminAuth, getUsers);
router.post('/users', adminAuth, createUser);
router.put('/users/:userId', adminAuth, updateUser);
router.delete('/users/:userId', adminAuth, softDeleteUser);
router.patch('/users/:userId/restore', adminAuth, restoreUser);
router.patch('/users/:userId/status', adminAuth, setUserStatus);
router.post('/users/:userId/reset-password', adminAuth, resetUserPassword);
router.put('/users/:userId/role', adminAuth, updateUserRole);

// ----------------------------
// Department Management Routes
// ----------------------------
router.get('/departments', adminAuth, getDepartments);
router.post('/departments', adminAuth, createDepartment);
router.put('/departments/:deptId', adminAuth, updateDepartment);
router.delete('/departments/:deptId', adminAuth, deleteDepartment);

// ----------------------------
// Audit Trail Routes
// ----------------------------
router.get('/audit-logs', adminAuth, getAuditLogs);

export default router;

