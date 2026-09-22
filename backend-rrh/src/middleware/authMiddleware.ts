import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { createLogger } from '../utils/logger';

const logger = createLogger('Auth');

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    if (!token && req.query && req.query.token) {
        token = req.query.token as string;
    }

    if (!token) {
        return res.status(401).json({ message: 'Access Denied: No Token Provided' });
    }

    try {
        const secret = process.env.JWT_SECRET || 'sfcs_unit2_secure_jwt_secret_2026_production_grade_99';
        const user = jwt.verify(token, secret, { ignoreExpiration: true });
        req.user = user;
        next();
    } catch (error: any) {
        return res.status(403).json({ message: `Invalid Token: ${error.message}` });
    }
};

export const requireRole = (allowedRoles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        const userRole = req.user?.role?.toString().trim();
        const normalizedAllowedRoles = allowedRoles.map(r => r.trim().toLowerCase());

        if (!req.user || !userRole || !normalizedAllowedRoles.includes(userRole.toLowerCase())) {
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
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

        // 1. Super Admin Bypass (all permissions allowed)
        if (user.role === 'Super Admin') {
            return next();
        }

        // 2. Restrict delete action strictly to Super Admin
        if (action === 'can_delete') {
            return res.status(403).json({ message: 'Access Denied: Only Super Admin users are allowed to perform delete operations.' });
        }

        // 3. Admin Role Bypass (full access except delete)
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
                logger.error(`Failed to fetch permissions from auth service: ${err.message}`);
                return res.status(500).json({ message: 'Internal authorization service error.' });
            }
        }

        const userPerm = (permissions || []).find((p: any) => p.permission_key === permissionKey);

        if (!userPerm || !userPerm[action]) {
            logger.warn(`User ${userId} lacks permission "${permissionKey}" for action "${action}"`);
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
        }

        next();
    };
};
