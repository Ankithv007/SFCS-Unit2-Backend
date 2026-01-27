import { Response } from 'express';
import { pool } from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

// Get All Users
export const getAllUsers = async (req: AuthRequest, res: Response) => {
    try {
        console.log('[ADMIN DEBUG] Fetching all users...');
        const result = await pool.query('SELECT id, name, email, role, status, created_at FROM users ORDER BY id ASC');
        console.log(`[ADMIN DEBUG] Successfully fetched ${result.rows.length} users`);
        res.json(result.rows);
    } catch (error) {
        console.error('[ADMIN DEBUG] Error fetching users:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Update User Role
export const updateUserRole = async (req: AuthRequest, res: Response) => {
    const { userId } = req.params;
    const { role } = req.body;
    const requesterRole = req.user.role;

    // Hierarchy Definition
    const hierarchy: { [key: string]: number } = {
        'Super Admin': 4,
        'Admin': 3,
        'Manager': 2,
        'Supervisor': 1,
        'User': 0
    };

    // Validate Role
    if (!hierarchy.hasOwnProperty(role)) {
        return res.status(400).json({ message: 'Invalid role' });
    }

    // Permission Check Logic
    // 1. Requester must be higher than the role they are assigning
    // 2. Requester must be higher than the user they are modifying (prevent modifying peers or superiors)

    // Exception: Super Admin can do anything
    if (requesterRole !== 'Super Admin') {
        if (hierarchy[requesterRole] <= hierarchy[role]) {
            return res.status(403).json({ message: 'You cannot assign a role equal to or higher than your own.' });
        }
    }

    try {
        // Check target user's current role
        const targetUserCheck = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
        if (targetUserCheck.rows.length === 0) return res.status(404).json({ message: 'User not found' });

        const targetUserRole = targetUserCheck.rows[0].role || 'User';

        if (requesterRole !== 'Super Admin') {
            if (hierarchy[requesterRole] <= hierarchy[targetUserRole]) {
                return res.status(403).json({ message: 'You cannot modify a user with a role equal to or higher than your own.' });
            }
        }

        // Update Role
        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
        res.json({ message: `User role updated to ${role}` });

    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
