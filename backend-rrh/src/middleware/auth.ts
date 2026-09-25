import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from '../utils/logger';

const logger = createLogger('AuthMiddleware');

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

    if (!token) {
        logger.warn('Unauthorized access attempt: No token provided');
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        (req as any).user = decoded;
        return next();
    } catch (err) {
        logger.warn('Unauthorized access attempt: Invalid token provided');
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
};
