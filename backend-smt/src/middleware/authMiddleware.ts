import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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

