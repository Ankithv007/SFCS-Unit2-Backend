import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/tokenService';

import fetch from 'node-fetch';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    const authHeader = req.headers.authorization;

    // 1️⃣ Authorization header validation
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            message: 'Access Denied: Authorization header missing',
        });
    }

    const token = authHeader.split(' ')[1];

    // 2️⃣ Token validation (handles Bearer null / undefined)
    if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).json({
            message: 'Access Denied: No Token Provided',
        });
    }

    try {
        // 3️⃣ Verify token
        const user = verifyToken(token);

        if (!user) {
            return res.status(401).json({
                message: 'Invalid or Expired Token',
            });
        }

        // 4️⃣ Attach user to request
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid or Expired Token',
        });
    }
};

export const requireRole = (allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({
                message: 'Access Denied: User role not found',
            });
        }

        const userRole = req.user.role.toString().trim().toLowerCase();
        const normalizedAllowedRoles = allowedRoles.map(role =>
            role.trim().toLowerCase()
        );

        if (!normalizedAllowedRoles.includes(userRole)) {
            return res.status(403).json({
                message:
                    'Access Denied: You do not have permission to perform this action.',
            });
        }

        next();
    };
};

const permissionCache = new Map<string, any[]>();

export const requirePermission = (permissionKey: string, action: 'can_view' | 'can_create' | 'can_edit' | 'can_delete' | 'can_export') => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const user = req.user;
        if (!user || !user.id) {
            return res.status(401).json({ message: 'Unauthorized: No user session found.' });
        }

        // 1. Super Admin Bypass
        const roleLower = (user.role || '').toString().toLowerCase().replace(/\s/g, '');
        if (roleLower === 'superadmin' || user.role === 'Super Admin') {
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
                
                console.log(`[AUTH QC CACHE MISS] Fetching permissions for user ${userId}, version ${version}`);
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
                console.error('[AUTH QC ERROR] Failed to fetch permissions:', err.message);
                return res.status(500).json({ message: 'Internal authorization service error.' });
            }
        }

        const userPerm = (permissions || []).find((p: any) => p.permission_key === permissionKey);
        
        if (!userPerm || !userPerm[action]) {
            console.log(`[AUTH QC FORBIDDEN] User ${userId} lacks permission "${permissionKey}" for action "${action}"`);
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
        }

        next();
    };
};
