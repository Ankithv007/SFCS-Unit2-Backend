import { Router } from 'express';
import {
    checkEmail,
    requestSignupOtp,
    resendOtp,
    verifySignupOtp,
    createPassword,
    login,
    requestForgotOtp,
    confirmForgotOtp,
    updateAvatar,
    getMe,
    verifyTokenPermissions
} from '../controllers/authController';
import { otpLimiter } from '../middleware/rateLimiter';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

router.post('/check-email', checkEmail);
router.post('/request-signup-otp', otpLimiter, requestSignupOtp);
router.post('/resend-otp', otpLimiter, resendOtp);
router.post('/verify-signup-otp', verifySignupOtp);
router.post('/create-password', createPassword);
router.post('/login', login);
router.post('/request-forgot-otp', otpLimiter, requestForgotOtp);
router.post('/confirm-forgot-otp', confirmForgotOtp);
router.post('/update-avatar', updateAvatar);
router.get('/me', authenticateToken, getMe);
router.get('/verify-token-permissions', verifyTokenPermissions);

export default router;
