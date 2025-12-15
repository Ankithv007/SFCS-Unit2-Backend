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
    updateAvatar
} from '../controllers/authController';
import { otpLimiter } from '../middleware/rateLimiter';

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

export default router;
