import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
    user?: any;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        console.log('Auth Failed: No Token Provided');
        return res.status(401).json({ message: 'Access Denied: No Token Provided' });
    }

    try {
        const secret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this';
        // console.log('Verifying token with secret:', secret); // Security risk to log secret, but useful for debug if needed
        const user = jwt.verify(token, secret);
        req.user = user;
        // console.log('Token verified for user:', user);
        next();
    } catch (error: any) {
        console.error('Auth Failed: Invalid Token:', error.message);
        return res.status(403).json({ message: `Invalid Token: ${error.message}` });
    }
};
