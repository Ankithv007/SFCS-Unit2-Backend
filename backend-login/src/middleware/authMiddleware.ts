import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/tokenService';
import { pool } from '../config/db';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // If no token is provided, return 401 Unauthorized
    if (!token) {
        console.log('[AUTH DEBUG] No token provided');
        return res.status(401).json({ message: 'Access Denied: No Token Provided' });
    }

    try {
        // Verify the JWT token
        const user = verifyToken(token);
        console.log('[AUTH DEBUG] Token verified successfully for user:', (user as any).email, 'Role:', (user as any).role);
        req.user = user;
        next();
    } catch (error: any) {
        // If token is invalid or expired, return 401 Unauthorized (standard practice)
        console.error('[AUTH DEBUG] Token verification failed:', error.message);
        return res.status(401).json({ message: 'Invalid or Expired Token' });
    }
};

export const requireRole = (allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        const userRole = req.user?.role?.toString().trim();
        const normalizedAllowedRoles = allowedRoles.map(r => r.trim().toLowerCase());

        console.log(`[AUTH DEBUG] Checking role. User role: "${userRole}", Normalized Allowed roles: ${JSON.stringify(normalizedAllowedRoles)}`);

        if (!req.user || !userRole || !normalizedAllowedRoles.includes(userRole.toLowerCase())) {
            console.log('[AUTH DEBUG] Role check failed. User role not in allowed roles.');
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
        }
        console.log('[AUTH DEBUG] Role check passed');
        next();
    };
};

// In-memory cache for local validation
const permissionCache = new Map<string, any[]>();

export const requirePermission = (permissionKey: string, action: 'can_view' | 'can_create' | 'can_edit' | 'can_delete' | 'can_export') => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const user = req.user;
        if (!user || !user.id) {
            return res.status(401).json({ message: 'Unauthorized: No user session found.' });
        }

        // 1. Super Admin Bypass
        if (user.role === 'Super Admin') {
            return next();
        }

        // Restrict 'can_delete' action exclusively to Super Admin users
        if (action === 'can_delete') {
            return res.status(403).json({ message: 'Access Denied: Only Super Admin users are allowed to perform delete operations.' });
        }

        // 2. Admin Role Bypass (Full access except Delete)
        if (user.role === 'Admin' || (user.role || '').toString().toLowerCase().replace(/\s/g, '') === 'admin') {
            return next();
        }

        const userId = user.id;
        const version = user.permission_version || 1;
        const cacheKey = `${userId}:${version}`;

        let permissions = permissionCache.get(cacheKey);

        if (!permissions) {
            try {
                // Fetch directly from DB as this is the login service itself
                const permQuery = `
                    SELECT 
                        sp.permission_key,
                        bool_or(dp.can_view) AS can_view,
                        bool_or(dp.can_create) AS can_create,
                        bool_or(dp.can_edit) AS can_edit,
                        bool_or(dp.can_delete) AS can_delete,
                        bool_or(dp.can_export) AS can_export
                    FROM department_users du
                    JOIN department_permissions dp ON dp.department_id = du.department_id
                    JOIN system_pages sp ON sp.id = dp.system_page_id
                    WHERE du.user_id = $1 AND sp.is_active = TRUE
                    GROUP BY sp.permission_key
                `;
                const permResult = await pool.query(permQuery, [userId]);
                permissions = permResult.rows;
                permissionCache.set(cacheKey, permissions || []);
            } catch (err: any) {
                console.error('[AUTH ERROR] Local permissions lookup failed:', err.message);
                return res.status(500).json({ message: 'Internal authorization lookup error.' });
            }
        }

        const userPerm = permissions.find((p: any) => p.permission_key === permissionKey);
        
        if (!userPerm || !userPerm[action]) {
            console.log(`[AUTH FORBIDDEN] User ${userId} lacks permission "${permissionKey}" for action "${action}"`);
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
        }

        next();
    };
};
