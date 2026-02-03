import rateLimit from 'express-rate-limit';

export const otpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // Limit each IP to 10 OTP requests per hour
    message: 'Too many OTP requests from this IP, please try again after an hour',
    standardHeaders: true,
    legacyHeaders: false,
});
