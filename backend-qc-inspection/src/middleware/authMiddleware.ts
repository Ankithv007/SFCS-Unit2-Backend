import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/tokenService';

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
