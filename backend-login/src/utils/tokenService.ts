import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'secret';
// Use 24h as default for better parsing consistency across different JWT libraries
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export const generateToken = (payload: { id: number; email: string; role: string; permission_version?: number; employee_code?: string | null }) => {
    console.log(`[TOKEN DEBUG] Generating token for ${payload.email} with expiration: ${EXPIRES_IN}`);
    return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN } as jwt.SignOptions);
};

export const verifyToken = (token: string) => {
    // Verify the token using the secret
    return jwt.verify(token, SECRET);
};
