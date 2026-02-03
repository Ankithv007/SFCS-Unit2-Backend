import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/tokenService';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access Denied: No Token Provided' });
    }

    try {
        const user = verifyToken(token);
        req.user = user;
        next();
    } catch (error: any) {
        return res.status(401).json({ message: 'Invalid or Expired Token' });
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
