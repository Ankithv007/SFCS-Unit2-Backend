import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import pool from '../config/db';

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
        const secret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this';
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

        console.log(`[AUTH DEBUG SMT] Checking role. User role: "${userRole}", Normalized Allowed roles: ${JSON.stringify(normalizedAllowedRoles)}`);

        if (!req.user || !userRole || !normalizedAllowedRoles.includes(userRole.toLowerCase())) {
            console.log('[AUTH DEBUG SMT] Role check failed. User role not in allowed roles.');
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
        }
        console.log('[AUTH DEBUG SMT] Role check passed');
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
        if (user.role === 'Super Admin') {
            return next();
        }

        // Restrict 'can_delete' action exclusively to Super Admin users
        if (action === 'can_delete') {
            try {
                const sessionUser = {
                    id: user?.id || null,
                    name: user?.name || user?.email || 'Unknown User',
                    role: user?.role || 'OPERATOR',
                    employee_code: user?.employee_code || 'OP-UNKNOWN',
                    department: user?.department || 'SMT'
                };
                const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown') as string;
                const details = `Unauthorized Delete Rack Attempt - User: ${sessionUser.name} (${sessionUser.employee_code}, Role: ${sessionUser.role}), Permission Key: ${permissionKey}, Action: ${action}, Module: Stencil Rack Management, Endpoint: ${req.originalUrl}, Method: ${req.method}, IP: ${ip}, Reason: Unauthorized Delete Rack Attempt`;
                
                await pool.query(`
                    INSERT INTO audit_log (event_type, entity_type, entity_id, actor, old_value, new_value, description)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `, [
                    'DELETE',
                    'STENCIL_RACK',
                    req.params.id || 'N/A',
                    sessionUser.name,
                    null,
                    null,
                    details
                ]);
            } catch (auditErr: any) {
                console.error('[AUTH SMT ERROR] Failed to log unauthorized delete:', auditErr.message);
            }
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
                
                console.log(`[AUTH SMT CACHE MISS] Fetching permissions for user ${userId}, version ${version}`);
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
                console.error('[AUTH SMT ERROR] Failed to fetch permissions:', err.message);
                return res.status(500).json({ message: 'Internal authorization service error.' });
            }
        }

        const userPerm = (permissions || []).find((p: any) => p.permission_key === permissionKey);
        
        if (!userPerm || !userPerm[action]) {
            console.log(`[AUTH SMT FORBIDDEN] User ${userId} lacks permission "${permissionKey}" for action "${action}"`);
            return res.status(403).json({ message: 'Access Denied: You do not have permission to perform this action.' });
        }

        next();
    };
};

