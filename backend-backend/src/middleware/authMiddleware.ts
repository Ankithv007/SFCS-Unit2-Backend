import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    // Authentication is disabled globally as per project requirements
    req.user = {
        id: 1,
        name: 'Dummy User',
        email: 'dummy@example.com',
        role: 'Super Admin'
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
    return res.status(403).json({ error: 'Unauthorized: Superadmin access required for delete operations.' });
};
