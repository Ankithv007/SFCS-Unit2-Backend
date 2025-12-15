import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const SECRET = process.env.JWT_SECRET || 'secret';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

export const generateToken = (payload: object) => {
    return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN } as jwt.SignOptions);
};

export const verifyToken = (token: string) => {
    return jwt.verify(token, SECRET);
};
