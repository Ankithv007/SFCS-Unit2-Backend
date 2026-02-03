import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'secret';

export const verifyToken = (token: string) => {
    return jwt.verify(token, SECRET);
};
