import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';

const logger = createLogger('AuthMiddleware');

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            (req as any).user = decoded;
            return next();
        } catch (err) {
            logger.warn('AuthMiddleware: Invalid token provided, checking fallback headers');
        }
    }

    // Fallback: Check custom headers (X-User-Name, X-Username, X-Backend-User-Id)
    const headerName = (req.headers['x-user-name'] as string)
        || (req.headers['x-username'] as string)
        || (req.headers['x-backend-user-id'] as string);

    if (headerName && headerName.trim().length > 0) {
        (req as any).user = {
            id: req.headers['x-backend-user-id'] || null,
            name: headerName.trim(),
            username: headerName.trim(),
            role: 'OPERATOR'
        };
        return next();
    }

    logger.warn('Unauthorized access attempt: No token or user identity provided');
    return res.status(401).json({ error: 'Unauthorized: No valid session or token provided' });
};
