import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

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
        const secret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this';
        const user = jwt.verify(token, secret);
        req.user = user;
        next();
    } catch (error: any) {
        return res.status(403).json({ message: `Invalid Token: ${error.message}` });
    }
};
