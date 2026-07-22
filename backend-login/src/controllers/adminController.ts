import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';
import { hashPassword } from '../utils/hashService';
import { logAudit } from '../services/auditService';
import { createLogger } from '../utils/logger';

const logger = createLogger('ADMIN_CTRL');

// Role hierarchy constants
const ROLE_HIERARCHY: { [key: string]: number } = {
    'Super Admin': 4,
    'Admin': 3,
    'Manager': 2,
    'Supervisor': 1,
    'Operator': 0,
    'User': 0
};

// Helper: Check hierarchy permission
function canModifyTarget(requesterRole: string, targetRole: string, desiredRole?: string): boolean {
    if (requesterRole === 'Super Admin') return true;
    const reqRank = ROLE_HIERARCHY[requesterRole] || 0;
    const targetRank = ROLE_HIERARCHY[targetRole] || 0;
    
    if (reqRank <= targetRank) return false;
    if (desiredRole) {
        const desiredRank = ROLE_HIERARCHY[desiredRole] || 0;
        if (reqRank <= desiredRank) return false;
    }
    return true;
}

// ----------------------------------------------------------------------
// USER MANAGEMENT ENDPOINTS
// ----------------------------------------------------------------------

/**
 * GET /api/auth/admin/users
 * Returns paginated, searchable, filterable user list.
 */
export const getUsers = async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;

        const q = (req.query.q as string || '').trim();
        const role = req.query.role as string;
        const status = req.query.status as string;
        const departmentId = req.query.departmentId ? parseInt(req.query.departmentId as string) : null;
        const includeDeleted = req.query.includeDeleted === 'true';
        const sortBy = ['id', 'name', 'email', 'employee_code', 'role', 'status', 'created_at', 'updated_at'].includes(req.query.sortBy as string)
            ? (req.query.sortBy as string)
            : 'id';
        const sortOrder = (req.query.sortOrder as string)?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

        const params: any[] = [];
        const whereClauses: string[] = [];

        if (!includeDeleted) {
            whereClauses.push('u.deleted_at IS NULL');
        }

        if (q) {
            params.push(`%${q}%`);
            whereClauses.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.employee_code ILIKE $${params.length})`);
        }

        if (role && role !== 'ALL') {
            params.push(role);
            whereClauses.push(`u.role = $${params.length}`);
        }

        if (status && status !== 'ALL') {
            params.push(status);
            whereClauses.push(`u.status = $${params.length}`);
        }

        if (departmentId) {
            params.push(departmentId);
            whereClauses.push(`u.id IN (SELECT user_id FROM department_users WHERE department_id = $${params.length})`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Query Total Count
        const countQuery = `SELECT COUNT(*) FROM users u ${whereSql}`;
        const countRes = await pool.query(countQuery, params);
        const total = parseInt(countRes.rows[0].count);

        // Query Users Page
        params.push(limit);
        const limitParam = params.length;
        params.push(offset);
        const offsetParam = params.length;

        const usersQuery = `
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.role, 
                u.status, 
                u.employee_code, 
                u.created_at, 
                u.updated_at, 
                u.deleted_at,
                COALESCE(
                    (
                        SELECT json_agg(json_build_object('id', d.id, 'name', d.name))
                        FROM department_users du
                        JOIN departments d ON d.id = du.department_id
                        WHERE du.user_id = u.id
                    ), '[]'::json
                ) AS departments
            FROM users u
            ${whereSql}
            ORDER BY u.${sortBy} ${sortOrder}
            LIMIT $${limitParam} OFFSET $${offsetParam}
        `;

        const usersRes = await pool.query(usersQuery, params);

        return res.json({
            success: true,
            data: usersRes.rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error(`Error in getUsers: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to fetch users' });
    }
};

/**
 * POST /api/auth/admin/users
 * Create a new user with bcrypt password and unique employee_code validation.
 */
export const createUser = async (req: AuthRequest, res: Response) => {
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role || 'User';

    const { name, email, password, role = 'User', employee_code, status = 'active', departmentIds = [] } = req.body;

    if (!name || !password || !employee_code || !employee_code.trim()) {
        return res.status(400).json({ success: false, message: 'Name, Employee Code, and Password are required' });
    }

    // Role Hierarchy Check
    if (!canModifyTarget(requesterRole, 'User', role)) {
        return res.status(403).json({ success: false, message: 'You cannot assign a role equal to or higher than your own' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check Email uniqueness if provided
        if (email && email.trim()) {
            const emailCheck = await client.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
            if (emailCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'A user with this email already exists' });
            }
        }

        // Check Employee Code uniqueness if provided
        if (employee_code && employee_code.trim()) {
            const empCheck = await client.query('SELECT id FROM users WHERE employee_code = $1', [employee_code.trim()]);
            if (empCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'A user with this Employee Code already exists' });
            }
        }

        const hashedPassword = await hashPassword(password);

        const insertQuery = `
            INSERT INTO users (name, email, password, role, status, employee_code, is_verified, created_by, updated_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $7, NOW(), NOW())
            RETURNING id, name, email, role, status, employee_code, created_at, updated_at
        `;

        const newReq = await client.query(insertQuery, [
            name.trim(),
            email && email.trim() ? email.toLowerCase().trim() : null,
            hashedPassword,
            role,
            status,
            employee_code.trim(),
            requesterId
        ]);

        const newUser = newReq.rows[0];

        // Link Departments if provided
        if (Array.isArray(departmentIds) && departmentIds.length > 0) {
            for (const deptId of departmentIds) {
                await client.query(
                    `INSERT INTO department_users (department_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [deptId, newUser.id]
                );
            }
        }

        // Audit Log
        await logAudit({
            performedBy: requesterId,
            action: 'USER_CREATED',
            targetType: 'USER',
            targetId: newUser.id,
            newValues: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, employee_code: newUser.employee_code, departmentIds },
            ipAddress: req.ip
        }, client);

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: newUser
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in createUser: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Internal server error while creating user' });
    } finally {
        client.release();
    }
};

/**
 * PUT /api/auth/admin/users/:userId
 * Update user with optimistic concurrency check (updated_at) and employee_code validation.
 */
export const updateUser = async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role || 'User';

    const { name, email, employee_code, role, status, password, updated_at, departmentIds } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch current record for role check & concurrency check
        const targetRes = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (targetRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const currentUser = targetRes.rows[0];

        // RBAC Hierarchy Check
        if (!canModifyTarget(requesterRole, currentUser.role, role)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ success: false, message: 'You do not have permission to modify this user or assign this role' });
        }

        // Optimistic Concurrency Control Check
        if (updated_at) {
            const dbUpdatedAt = new Date(currentUser.updated_at).getTime();
            const clientUpdatedAt = new Date(updated_at).getTime();
            if (Math.abs(dbUpdatedAt - clientUpdatedAt) > 1000) { // 1 second threshold
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    message: 'Conflict: This user record was updated by another administrator. Please refresh and try again.'
                });
            }
        }

        // Uniqueness check for email if provided
        if (email && email.trim() && email.toLowerCase().trim() !== (currentUser.email || '')) {
            const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email.toLowerCase().trim(), userId]);
            if (emailCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Email is already in use by another user' });
            }
        }

        // Validate employee_code if provided
        if (employee_code !== undefined && (!employee_code || !employee_code.trim())) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'Employee Code is required' });
        }

        // Uniqueness check for employee_code
        if (employee_code && employee_code.trim() !== (currentUser.employee_code || '')) {
            const empCheck = await client.query('SELECT id FROM users WHERE employee_code = $1 AND id != $2', [employee_code.trim(), userId]);
            if (empCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'Employee Code is already in use by another user' });
            }
        }

        const newName = name !== undefined ? name.trim() : currentUser.name;
        const newEmail = email !== undefined ? (email && email.trim() ? email.toLowerCase().trim() : null) : currentUser.email;
        const newEmpCode = employee_code !== undefined ? employee_code.trim() : currentUser.employee_code;
        const newRole = role !== undefined ? role : currentUser.role;
        const newStatus = status !== undefined ? status : currentUser.status;

        let passwordHash = currentUser.password;
        if (password && password.trim().length > 0) {
            passwordHash = await hashPassword(password.trim());
        }

        const updateQuery = `
            UPDATE users 
            SET name = $1, email = $2, employee_code = $3, role = $4, status = $5, password = $6, updated_by = $7, permission_version = COALESCE(permission_version, 1) + 1, updated_at = NOW()
            WHERE id = $8
            RETURNING id, name, email, role, status, employee_code, permission_version, created_at, updated_at
        `;

        const updateRes = await client.query(updateQuery, [
            newName,
            newEmail,
            newEmpCode,
            newRole,
            newStatus,
            passwordHash,
            requesterId,
            userId
        ]);

        const updatedUser = updateRes.rows[0];

        // Update Departments if supplied
        if (Array.isArray(departmentIds)) {
            await client.query('DELETE FROM department_users WHERE user_id = $1', [userId]);
            for (const deptId of departmentIds) {
                await client.query('INSERT INTO department_users (department_id, user_id) VALUES ($1, $2)', [deptId, userId]);
            }
        }

        // Audit Log
        await logAudit({
            performedBy: requesterId,
            action: 'USER_UPDATED',
            targetType: 'USER',
            targetId: userId,
            oldValues: { name: currentUser.name, email: currentUser.email, role: currentUser.role, status: currentUser.status, employee_code: currentUser.employee_code },
            newValues: { name: updatedUser.name, email: updatedUser.email, role: updatedUser.role, status: updatedUser.status, employee_code: updatedUser.employee_code, departmentIds },
            ipAddress: req.ip
        }, client);

        await client.query('COMMIT');

        return res.json({
            success: true,
            message: 'User updated successfully',
            data: updatedUser
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in updateUser: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to update user' });
    } finally {
        client.release();
    }
};

/**
 * DELETE /api/auth/admin/users/:userId
 * Soft delete user by setting deleted_at = NOW().
 */
export const softDeleteUser = async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role || 'User';

    if (String(userId) === String(requesterId)) {
        return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
    }

    try {
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        const targetUser = userCheck.rows[0];

        if (!canModifyTarget(requesterRole, targetUser.role)) {
            return res.status(403).json({ success: false, message: 'You do not have permission to delete this user' });
        }

        await pool.query('UPDATE users SET deleted_at = NOW(), status = $1, updated_by = $2 WHERE id = $3', [
            'inactive',
            requesterId,
            userId
        ]);

        await logAudit({
            performedBy: requesterId,
            action: 'USER_SOFT_DELETED',
            targetType: 'USER',
            targetId: userId,
            oldValues: { email: targetUser.email, role: targetUser.role },
            ipAddress: req.ip
        });

        return res.json({ success: true, message: 'User soft-deleted successfully' });
    } catch (error: any) {
        logger.error(`Error in softDeleteUser: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
};

/**
 * PATCH /api/auth/admin/users/:userId/restore
 * Restore soft-deleted user by clearing deleted_at.
 */
export const restoreUser = async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const requesterId = req.user?.id;

    try {
        const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        await pool.query('UPDATE users SET deleted_at = NULL, status = $1, updated_by = $2, updated_at = NOW() WHERE id = $3', [
            'active',
            requesterId,
            userId
        ]);

        await logAudit({
            performedBy: requesterId,
            action: 'USER_RESTORED',
            targetType: 'USER',
            targetId: userId,
            ipAddress: req.ip
        });

        return res.json({ success: true, message: 'User restored successfully' });
    } catch (error: any) {
        logger.error(`Error in restoreUser: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to restore user' });
    }
};

/**
 * PATCH /api/auth/admin/users/:userId/status
 * Toggle user status between active and inactive.
 */
export const setUserStatus = async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const { status } = req.body;
    const requesterId = req.user?.id;

    if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status must be active or inactive' });
    }

    try {
        const resUser = await pool.query('UPDATE users SET status = $1, updated_by = $2, updated_at = NOW() WHERE id = $3 RETURNING id, status', [
            status,
            requesterId,
            userId
        ]);

        if (resUser.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        await logAudit({
            performedBy: requesterId,
            action: status === 'active' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
            targetType: 'USER',
            targetId: userId,
            newValues: { status },
            ipAddress: req.ip
        });

        return res.json({ success: true, message: `User status set to ${status}` });
    } catch (error: any) {
        logger.error(`Error in setUserStatus: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to update user status' });
    }
};

/**
 * POST /api/auth/admin/users/:userId/reset-password
 * Reset password for a specific user with bcrypt hash.
 */
export const resetUserPassword = async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const { newPassword } = req.body;
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role || 'User';

    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    try {
        const userCheck = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        if (!canModifyTarget(requesterRole, userCheck.rows[0].role)) {
            return res.status(403).json({ success: false, message: 'You cannot reset password for users at or above your role' });
        }

        const hashedPassword = await hashPassword(newPassword);

        await pool.query('UPDATE users SET password = $1, updated_by = $2, updated_at = NOW() WHERE id = $3', [
            hashedPassword,
            requesterId,
            userId
        ]);

        await logAudit({
            performedBy: requesterId,
            action: 'PASSWORD_RESET_BY_ADMIN',
            targetType: 'USER',
            targetId: userId,
            ipAddress: req.ip
        });

        return res.json({ success: true, message: 'Password reset successfully' });
    } catch (error: any) {
        logger.error(`Error in resetUserPassword: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to reset password' });
    }
};

/**
 * PUT /api/auth/admin/users/:userId/role
 * Backward-compatible role update endpoint with audit logging.
 */
export const updateUserRole = async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const { role } = req.body;
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role || 'User';

    if (!ROLE_HIERARCHY.hasOwnProperty(role)) {
        return res.status(400).json({ success: false, message: 'Invalid role' });
    }

    try {
        const targetCheck = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (targetCheck.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        const oldRole = targetCheck.rows[0].role;

        if (!canModifyTarget(requesterRole, oldRole, role)) {
            return res.status(403).json({ success: false, message: 'You do not have permission to change to or from this role' });
        }

        await pool.query('UPDATE users SET role = $1, updated_by = $2, permission_version = COALESCE(permission_version, 1) + 1, updated_at = NOW() WHERE id = $3', [
            role,
            requesterId,
            userId
        ]);

        await logAudit({
            performedBy: requesterId,
            action: 'ROLE_CHANGED',
            targetType: 'USER',
            targetId: userId,
            oldValues: { role: oldRole },
            newValues: { role },
            ipAddress: req.ip
        });

        return res.json({ success: true, message: `User role updated to ${role}` });
    } catch (error: any) {
        logger.error(`Error in updateUserRole: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to update user role' });
    }
};

// ----------------------------------------------------------------------
// DEPARTMENT MANAGEMENT ENDPOINTS
// ----------------------------------------------------------------------

/**
 * GET /api/auth/admin/departments
 * Fetch all departments with member users and fine-grained page permissions.
 */
export const getDepartments = async (req: AuthRequest, res: Response) => {
    try {
        const deptQuery = `
            SELECT 
                d.id, 
                d.name, 
                d.description, 
                d.created_at, 
                d.updated_at,
                COALESCE(
                    (
                        SELECT json_agg(json_build_object(
                            'user_id', u.id, 
                            'name', u.name, 
                            'email', u.email,
                            'employee_code', u.employee_code,
                            'role', u.role
                        ))
                        FROM department_users du
                        JOIN users u ON u.id = du.user_id
                        WHERE du.department_id = d.id AND u.deleted_at IS NULL
                    ), '[]'::json
                ) AS users,
                COALESCE(
                    (
                        SELECT json_agg(json_build_object(
                            'id', dp.id,
                            'system_page_id', dp.system_page_id,
                            'module', sp.module_name,
                            'page', sp.route_path,
                            'permission_key', sp.permission_key,
                            'can_view', dp.can_view,
                            'can_create', dp.can_create,
                            'can_edit', dp.can_edit,
                            'can_delete', dp.can_delete,
                            'can_export', dp.can_export
                        ))
                        FROM department_permissions dp
                        JOIN system_pages sp ON sp.id = dp.system_page_id
                        WHERE dp.department_id = d.id AND sp.is_active = TRUE
                    ), '[]'::json
                ) AS permissions
            FROM departments d
            ORDER BY d.name ASC
        `;

        const result = await pool.query(deptQuery);
        return res.json({ success: true, data: result.rows });
    } catch (error: any) {
        logger.error(`Error in getDepartments: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to fetch departments' });
    }
};

/**
 * POST /api/auth/admin/departments
 * Create a new department with associated users (user_id FK) and permission matrix.
 */
export const createDepartment = async (req: AuthRequest, res: Response) => {
    const requesterId = req.user?.id;
    const { name, description = '', userIds = [], permissions = [] } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Department Name is required' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check uniqueness
        const check = await client.query('SELECT id FROM departments WHERE name = $1', [name.trim()]);
        if (check.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, message: 'A department with this name already exists' });
        }

        const insertDept = await client.query(
            `INSERT INTO departments (name, description, created_by, updated_by, created_at, updated_at) 
             VALUES ($1, $2, $3, $3, NOW(), NOW()) RETURNING *`,
            [name.trim(), description.trim(), requesterId]
        );

        const newDept = insertDept.rows[0];

        // Insert User Associations (user_id ONLY)
        if (Array.isArray(userIds) && userIds.length > 0) {
            for (const uid of userIds) {
                await client.query(
                    `INSERT INTO department_users (department_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [newDept.id, uid]
                );
            }
            // Increment version for all added users
            await client.query(
                `UPDATE users SET permission_version = COALESCE(permission_version, 1) + 1 WHERE id = ANY($1)`,
                [userIds]
            );
        }

        // Insert Permissions mapped by system_page_id
        if (Array.isArray(permissions) && permissions.length > 0) {
            for (const perm of permissions) {
                if (!perm.system_page_id) continue;
                await client.query(
                    `INSERT INTO department_permissions (department_id, system_page_id, can_view, can_create, can_edit, can_delete, can_export)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)
                     ON CONFLICT (department_id, system_page_id) DO UPDATE
                     SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create, can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete, can_export = EXCLUDED.can_export`,
                    [
                        newDept.id,
                        perm.system_page_id,
                        perm.can_view ?? true,
                        perm.can_create ?? false,
                        perm.can_edit ?? false,
                        perm.can_delete ?? false,
                        perm.can_export ?? false
                    ]
                );
            }
        }

        await logAudit({
            performedBy: requesterId,
            action: 'DEPARTMENT_CREATED',
            targetType: 'DEPARTMENT',
            targetId: newDept.id,
            newValues: { id: newDept.id, name: newDept.name, userIds, permissionCount: permissions.length },
            ipAddress: req.ip
        }, client);

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Department created successfully',
            data: newDept
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in createDepartment: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to create department' });
    } finally {
        client.release();
    }
};

/**
 * PUT /api/auth/admin/departments/:deptId
 * Update department metadata, user links, and permission matrix with optimistic concurrency control.
 */
export const updateDepartment = async (req: AuthRequest, res: Response) => {
    const { deptId } = req.params;
    const requesterId = req.user?.id;
    const { name, description, userIds, permissions, updated_at } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const deptCheck = await client.query('SELECT * FROM departments WHERE id = $1', [deptId]);
        if (deptCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Department not found' });
        }

        const currentDept = deptCheck.rows[0];

        // Concurrency Check
        if (updated_at) {
            const dbTime = new Date(currentDept.updated_at).getTime();
            const clientTime = new Date(updated_at).getTime();
            if (Math.abs(dbTime - clientTime) > 1000) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    message: 'Conflict: This department was updated by another administrator. Please refresh.'
                });
            }
        }

        // Name Uniqueness check
        if (name && name.trim() !== currentDept.name) {
            const nameCheck = await client.query('SELECT id FROM departments WHERE name = $1 AND id != $2', [name.trim(), deptId]);
            if (nameCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'A department with this name already exists' });
            }
        }

        const updatedName = name !== undefined ? name.trim() : currentDept.name;
        const updatedDesc = description !== undefined ? description.trim() : currentDept.description;

        const updateRes = await client.query(
            `UPDATE departments SET name = $1, description = $2, updated_by = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
            [updatedName, updatedDesc, requesterId, deptId]
        );

        const updatedDept = updateRes.rows[0];

        // Replace user links and trigger version increment
        if (Array.isArray(userIds)) {
            // Get user IDs currently in the department
            const currentUsersRes = await client.query('SELECT user_id FROM department_users WHERE department_id = $1', [deptId]);
            const currentUsers = currentUsersRes.rows.map(r => r.user_id);

            await client.query('DELETE FROM department_users WHERE department_id = $1', [deptId]);
            for (const uid of userIds) {
                await client.query('INSERT INTO department_users (department_id, user_id) VALUES ($1, $2)', [deptId, uid]);
            }

            // Union of current and new users for version update
            const allAffectedUsers = Array.from(new Set([...currentUsers, ...userIds]));
            if (allAffectedUsers.length > 0) {
                await client.query(
                    `UPDATE users SET permission_version = COALESCE(permission_version, 1) + 1 WHERE id = ANY($1)`,
                    [allAffectedUsers]
                );
            }
        } else {
            // If userIds not changed but permissions changed, increment for current members
            const currentUsersRes = await client.query('SELECT user_id FROM department_users WHERE department_id = $1', [deptId]);
            const currentUsers = currentUsersRes.rows.map(r => r.user_id);
            if (currentUsers.length > 0) {
                await client.query(
                    `UPDATE users SET permission_version = COALESCE(permission_version, 1) + 1 WHERE id = ANY($1)`,
                    [currentUsers]
                );
            }
        }

        // Update Permissions mapped by system_page_id
        if (Array.isArray(permissions)) {
            await client.query('DELETE FROM department_permissions WHERE department_id = $1', [deptId]);
            for (const perm of permissions) {
                if (!perm.system_page_id) continue;
                await client.query(
                    `INSERT INTO department_permissions (department_id, system_page_id, can_view, can_create, can_edit, can_delete, can_export)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                        deptId,
                        perm.system_page_id,
                        perm.can_view ?? true,
                        perm.can_create ?? false,
                        perm.can_edit ?? false,
                        perm.can_delete ?? false,
                        perm.can_export ?? false
                    ]
                );
            }
        }

        await logAudit({
            performedBy: requesterId,
            action: 'DEPARTMENT_UPDATED',
            targetType: 'DEPARTMENT',
            targetId: deptId,
            oldValues: { name: currentDept.name, description: currentDept.description },
            newValues: { name: updatedDept.name, description: updatedDept.description, userIds, permissionCount: permissions?.length },
            ipAddress: req.ip
        }, client);

        await client.query('COMMIT');

        return res.json({
            success: true,
            message: 'Department updated successfully',
            data: updatedDept
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in updateDepartment: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to update department' });
    } finally {
        client.release();
    }
};

/**
 * DELETE /api/auth/admin/departments/:deptId
 * Delete department and cascade permissions/user assignments.
 */
export const deleteDepartment = async (req: AuthRequest, res: Response) => {
    const { deptId } = req.params;
    const requesterId = req.user?.id;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const deptCheck = await client.query('SELECT * FROM departments WHERE id = $1', [deptId]);
        if (deptCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: 'Department not found' });
        }

        const targetDept = deptCheck.rows[0];

        // Fetch users in the department before deletion
        const userRes = await client.query('SELECT user_id FROM department_users WHERE department_id = $1', [deptId]);
        const userIds = userRes.rows.map(r => r.user_id);

        await client.query('DELETE FROM departments WHERE id = $1', [deptId]);

        // Increment version for affected users so their tokens refresh
        if (userIds.length > 0) {
            await client.query(
                `UPDATE users SET permission_version = COALESCE(permission_version, 1) + 1 WHERE id = ANY($1)`,
                [userIds]
            );
        }

        await logAudit({
            performedBy: requesterId,
            action: 'DEPARTMENT_DELETED',
            targetType: 'DEPARTMENT',
            targetId: deptId,
            oldValues: { name: targetDept.name },
            ipAddress: req.ip
        }, client);

        await client.query('COMMIT');
        return res.json({ success: true, message: 'Department deleted successfully' });
    } catch (error: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in deleteDepartment: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to delete department' });
    } finally {
        client.release();
    }
};

// ----------------------------------------------------------------------
// AUDIT LOGS & MIGRATION ENDPOINTS
// ----------------------------------------------------------------------

/**
 * GET /api/auth/admin/audit-logs
 * Paginated audit trail viewer with search, action, and date filters.
 */
export const getAuditLogs = async (req: AuthRequest, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 15;
        const offset = (page - 1) * limit;

        const q = (req.query.q as string || '').trim();
        const action = req.query.action as string;
        const startDate = req.query.startDate as string;
        const endDate = req.query.endDate as string;

        const params: any[] = [];
        const whereClauses: string[] = [];

        if (q) {
            params.push(`%${q}%`);
            whereClauses.push(`(l.action ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR l.target_id ILIKE $${params.length})`);
        }

        if (action && action !== 'ALL') {
            params.push(action);
            whereClauses.push(`l.action = $${params.length}`);
        }

        if (startDate) {
            params.push(startDate);
            whereClauses.push(`l.created_at >= $${params.length}`);
        }

        if (endDate) {
            params.push(endDate);
            whereClauses.push(`l.created_at <= $${params.length}`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const countRes = await pool.query(
            `SELECT COUNT(*) FROM admin_audit_logs l LEFT JOIN users u ON u.id = l.performed_by ${whereSql}`,
            params
        );
        const total = parseInt(countRes.rows[0].count);

        params.push(limit);
        const limitParam = params.length;
        params.push(offset);
        const offsetParam = params.length;

        const query = `
            SELECT 
                l.id,
                l.performed_by,
                u.name AS performer_name,
                u.email AS performer_email,
                l.action,
                l.target_type,
                l.target_id,
                l.old_values,
                l.new_values,
                l.ip_address,
                l.user_agent,
                l.success,
                l.error_message,
                l.created_at
            FROM admin_audit_logs l
            LEFT JOIN users u ON u.id = l.performed_by
            ${whereSql}
            ORDER BY l.created_at DESC
            LIMIT $${limitParam} OFFSET $${offsetParam}
        `;

        const logsRes = await pool.query(query, params);

        return res.json({
            success: true,
            data: logsRes.rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error(`Error in getAuditLogs: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to fetch audit logs' });
    }
};

/**
 * GET /api/auth/admin/system-pages
 * Retrieve list of all system pages.
 */
export const getSystemPages = async (req: AuthRequest, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM system_pages ORDER BY module_name ASC, display_order ASC, page_name ASC');
        return res.json({ success: true, data: result.rows });
    } catch (error: any) {
        logger.error(`Error in getSystemPages: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to fetch system pages' });
    }
};

/**
 * POST /api/auth/admin/system-pages/sync
 * Idempotent synchronization of routes from frontend routesConfig.
 * Strictly restricted to Super Admin role.
 */
export const syncSystemPages = async (req: AuthRequest, res: Response) => {
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;
    const { routes } = req.body;
    
    const startTime = Date.now();

    if (requesterRole !== 'Super Admin') {
        return res.status(403).json({ success: false, message: 'Only Super Admin can execute system page synchronization' });
    }

    if (!Array.isArray(routes)) {
        return res.status(400).json({ success: false, message: 'Routes payload must be an array' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Fetch existing system pages
        const existingRes = await client.query('SELECT id, permission_key, is_active FROM system_pages');
        const existingMap = new Map(existingRes.rows.map(r => [r.permission_key, r]));

        let added = 0;
        let updated = 0;
        let inactive = 0;
        let unchanged = 0;
        const processedKeys = new Set<string>();

        // Validate and Process incoming routes
        for (const route of routes) {
            const {
                permission_key,
                module_name,
                page_name,
                route_path,
                parent_module,
                display_order = 0,
                icon,
                page_type = 'PAGE'
            } = route;

            // Validation
            if (!permission_key || !permission_key.trim() || !module_name || !module_name.trim() || !page_name || !page_name.trim() || !route_path || !route_path.trim()) {
                console.warn('[SYNC WARNING] Skipping malformed route entry:', route);
                continue;
            }

            if (processedKeys.has(permission_key)) {
                console.warn('[SYNC WARNING] Duplicate permission_key detected in payload:', permission_key);
                continue;
            }
            processedKeys.add(permission_key);

            const existing = existingMap.get(permission_key);
            if (existing) {
                // Update
                const updateRes = await client.query(
                    `UPDATE system_pages
                     SET module_name = $1, page_name = $2, route_path = $3, parent_module = $4, display_order = $5, icon = $6, page_type = $7, is_active = TRUE, last_synced_at = NOW(), updated_by = $8, updated_at = NOW()
                     WHERE permission_key = $9
                     RETURNING (module_name != $1 OR page_name != $2 OR route_path != $3 OR parent_module IS DISTINCT FROM $4 OR display_order != $5 OR icon IS DISTINCT FROM $6 OR page_type != $7 OR is_active = FALSE) AS changed`,
                    [module_name.trim(), page_name.trim(), route_path.trim(), parent_module || null, display_order, icon || null, page_type, requesterId, permission_key]
                );
                
                if (updateRes.rows[0]?.changed) {
                    updated++;
                } else {
                    unchanged++;
                }
            } else {
                // Insert
                await client.query(
                    `INSERT INTO system_pages (module_name, page_name, permission_key, route_path, parent_module, display_order, icon, page_type, is_active, last_synced_at, updated_by, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW(), $9, NOW(), NOW())`,
                    [module_name.trim(), page_name.trim(), permission_key.trim(), route_path.trim(), parent_module || null, display_order, icon || null, page_type, requesterId]
                );
                added++;
            }
        }

        // Soft delete / mark inactive routes not in the payload
        for (const [key, record] of existingMap.entries()) {
            if (!processedKeys.has(key) && record.is_active) {
                await client.query(
                    `UPDATE system_pages SET is_active = FALSE, last_synced_at = NOW(), updated_by = $1, updated_at = NOW() WHERE permission_key = $2`,
                    [requesterId, key]
                );
                inactive++;
            }
        }

        const executionTimeMs = Date.now() - startTime;
        const summary = {
            added,
            updated,
            inactive,
            unchanged,
            executionTimeMs
        };

        // Log audit trail for sync
        await logAudit({
            performedBy: requesterId,
            action: 'SYSTEM_PAGES_SYNCED',
            targetType: 'SYSTEM_PAGES',
            targetId: 'ALL',
            newValues: { summary },
            ipAddress: req.ip
        }, client);

        await client.query('COMMIT');
        
        return res.json({
            success: true,
            message: 'System pages synchronized successfully',
            summary
        });
    } catch (error: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in syncSystemPages: ${error.message}`, error);
        return res.status(500).json({ success: false, message: 'Failed to synchronize system pages: ' + error.message });
    } finally {
        client.release();
    }
};


