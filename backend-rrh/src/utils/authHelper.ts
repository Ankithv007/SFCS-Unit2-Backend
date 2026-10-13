import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from './logger';

const logger = createLogger('AuthHelper');

export interface SessionUser {
    id: number | string | null;
    username: string;
    name: string;
    role: string;
}

const getJwtSecret = (): string => {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('FATAL: JWT_SECRET must be defined in production environment.');
        }
        return 'secret';
    }
    return secret;
};

/**
 * Centrally and securely resolves the authenticated user for the session.
 * Cryptographically verifies tokens and prevents unverified header spoofing.
 */
export const getSessionUser = (req: Request): SessionUser => {
    let user = (req as any).user;

    // If req.user wasn't attached by authMiddleware, inspect Authorization header
    if (!user) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            try {
                user = jwt.verify(token, getJwtSecret()) as any;
                (req as any).user = user;
            } catch (err: any) {
                logger.warn(`Failed to verify bearer token in getSessionUser: ${err.message}`);
            }
        }
    }

    if (user) {
        const id = user.id || user.userId || null;
        const name = (user.name || user.full_name || user.username || user.employee_code || user.employeeCode || 'Operator').toString().trim();
        const username = (user.username || user.employee_code || user.employeeCode || user.email || user.id || 'operator').toString().trim();
        const role = (user.role || 'OPERATOR').toString().trim().toUpperCase();

        return { id, username, name, role };
    }

    // In development/test fallback only; in production unauthenticated requests remain Anonymous
    const isProd = process.env.NODE_ENV === 'production';
    if (!isProd) {
        const headerName = (req.headers['x-user-name'] as string)
            || (req.headers['x-username'] as string);
        if (headerName && headerName.trim().length > 0) {
            const name = headerName.trim();
            return {
                id: null,
                username: name.toLowerCase().replace(/\s+/g, '_'),
                name,
                role: 'OPERATOR'
            };
        }
    }

    return {
        id: null,
        username: 'unauthenticated',
        name: 'Unauthenticated User',
        role: 'GUEST'
    };
};
