import { Request, Response, NextFunction } from 'express';

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
