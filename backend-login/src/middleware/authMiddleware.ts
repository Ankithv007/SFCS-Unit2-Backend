import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/tokenService';

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
