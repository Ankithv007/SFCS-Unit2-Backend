import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
            req.user = decoded;
            return next();
        } catch (e) {
            // invalid token - fall through to non-privileged stub
        }
    }

    // No valid token provided - use a non-privileged stub user for local/dev
    req.user = {
        id: 1,
        name: 'Dummy User',
        email: 'dummy@example.com',
        role: 'Employee'
    };
    next();
};

export const authorizeSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
            if (decoded && decoded.role && (decoded.role === 'Super Admin' || decoded.role.toLowerCase().replace(/\s/g, '') === 'superadmin')) {
                return next();
            }
        } catch (e) {
            // Token verification failed, fall through to 403
        }
    }
    // Fallback to req.user when JWT absent (e.g. local stub)
    const userRole = (req as any).user?.role;
    if (userRole) {
        const lower = userRole.toString().toLowerCase().replace(/\s/g, '');
        if (lower === 'superadmin') return next();
    }
    return res.status(403).json({ error: 'You do not have permission to delete this record.' });
};

export const authorizeAdminOrSuperAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const backendUserId = req.headers['x-backend-user-id'];
    if (backendUserId) {
        const idStr = backendUserId.toString();
        if (idStr.toUpperCase() === 'ADMIN') {
            return next();
        }
        try {
            const pool = require('../config/db').default;
            const result = await pool.query('SELECT role FROM employees WHERE user_id = $1', [idStr]);
            if (result.rows.length > 0) {
                const role = (result.rows[0].role || '').toString().toLowerCase().replace(/\s/g, '');
                if (role === 'admin' || role === 'superadmin') {
                    return next();
                } else {
                    return res.status(403).json({ error: 'You do not have permission to delete this record.' });
                }
            }
        } catch (e) {
            console.error('Error checking backend user role:', e);
        }
    }

    const authHeader = req.headers.authorization;
    // Try JWT first
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
            if (decoded && decoded.role) {
                const role = (decoded.role || '').toString().toLowerCase().replace(/\s/g, '');
                if (role === 'admin' || role === 'superadmin') return next();
            }
        } catch (e) {
            // fall through to check req.user
        }
    }

    // Fallback to req.user (useful for local/dev authenticateToken stub)
    const userRole = (req as any).user?.role;
    if (userRole) {
        const lower = userRole.toString().toLowerCase().replace(/\s/g, '');
        if (lower === 'admin' || lower === 'superadmin') return next();
    }

    return res.status(403).json({ error: 'You do not have permission to delete this record.' });
};

const permissionCache = new Map<string, any[]>();

export const requirePermission = (permissionKey: string, action: 'can_view' | 'can_create' | 'can_edit' | 'can_delete' | 'can_export') => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const user = req.user;
        if (!user || !user.id || user.name === 'Dummy User') {
            return res.status(401).json({ message: 'Unauthorized: No user session found.' });
        }

        // 1. Super Admin Bypass
        const roleLower = (user.role || '').toString().toLowerCase().replace(/\s/g, '');
        if (roleLower === 'superadmin') {
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

        let permissions: any[] | undefined = permissionCache.get(cacheKey);

        if (!permissions) {
            try {
                const authHeader = req.headers['authorization'];
                const authUrl = process.env.AUTH_SERVICE_URL || 'http://backend-login:5000';
                
                console.log(`[AUTH BACKEND CACHE MISS] Fetching permissions for user ${userId}, version ${version}`);
                const response = await fetch(`${authUrl}/api/auth/verify-token-permissions`, {
                    headers: { 'Authorization': authHeader || '' }
                });

                if (!response.ok) {
                    return res.status(response.status).json({ message: 'Authorization check failed.' });
                }

                const result: any = await response.json();
                if (result.success && Array.isArray(result.permissions)) {
                    permissions = result.permissions;
                    permissionCache.set(cacheKey, permissions || []);
                } else {
                    return res.status(403).json({ message: 'Forbidden: Unable to fetch permissions.' });
                }
            } catch (err: any) {
                console.error('[AUTH BACKEND ERROR] Failed to fetch permissions:', err.message);
                return res.status(500).json({ message: 'Internal authorization service error.' });
            }
        }

        const userPerm = (permissions || []).find((p: any) => p.permission_key === permissionKey);
        
        if (!userPerm || !userPerm[action]) {
            console.log(`[AUTH BACKEND FORBIDDEN] User ${userId} lacks permission "${permissionKey}" for action "${action}"`);
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
        }

        next();
    };
};
