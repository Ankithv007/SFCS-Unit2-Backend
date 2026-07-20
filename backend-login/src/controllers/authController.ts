import { Request, Response } from 'express';
import { pool } from '../config/db';

import { hashPassword, comparePassword, hashOtp, compareOtp } from '../utils/hashService';
import { generateToken } from '../utils/tokenService';
import { sendEmail } from '../utils/emailService';
import { getOtpEmailTemplate } from '../utils/emailTemplates';

// 1. Check Email
export const checkEmail = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        if (!email) throw new Error('Email is required');

        const userCheck = await pool.query('SELECT id, status FROM users WHERE email = $1', [email]);

        if (userCheck.rows.length > 0) {
            if (userCheck.rows[0].status === 'active') {
                return res.status(409).json({ exists: true, message: "Email already exists — please use 'change password' flow" });
            }
            return res.status(200).json({ exists: false, message: 'Email available' });
        }
        res.status(200).json({ exists: false, message: 'Email available' });
    } catch (error: any) {
        console.error('checkEmail error:', error);
        res.status(500).json({ message: `Server error: ${error.message}` });
    }
};

// 2. Request Signup OTP (Step 1: Create Pending User)
export const requestSignupOtp = async (req: Request, res: Response) => {
    try {
        const { name, email } = req.body;

        const userCheck = await pool.query('SELECT id, status FROM users WHERE email = $1', [email]);
        let userId;

        if (userCheck.rows.length > 0) {
            const user = userCheck.rows[0];
            if (user.status === 'active') {
                return res.status(409).json({ message: "Email already exists — please use 'change password' flow" });
            }
            userId = user.id;
            await pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
        } else {
            const newUser = await pool.query(
                "INSERT INTO users (name, email, status, is_verified) VALUES ($1, $2, 'pending_verification', FALSE) RETURNING id",
                [name, email]
            );
            userId = newUser.rows[0].id;
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await hashOtp(otp);

        await pool.query(
            "INSERT INTO email_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')",
            [userId, otpHash]
        );

        const emailHtml = getOtpEmailTemplate(otp, 'signup');
        await sendEmail(email, 'Verify Your Account', emailHtml);

        res.status(200).json({ message: 'OTP sent to email' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// 3. Verify Signup OTP (Step 2)
export const verifySignupOtp = async (req: Request, res: Response) => {
    try {
        const { email, otp } = req.body;

        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) return res.status(400).json({ message: 'User not found' });
        const userId = userResult.rows[0].id;

        const otpResult = await pool.query(
            'SELECT * FROM email_otps WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [userId]
        );

        if (otpResult.rows.length === 0) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        const otpRecord = otpResult.rows[0];

        if (otpRecord.attempts >= 10) {
            return res.status(429).json({ message: 'Too many failed attempts. Please request a new OTP.' });
        }

        const isValid = await compareOtp(otp, otpRecord.otp_hash);
        if (!isValid) {
            await pool.query('UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1', [otpRecord.id]);
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        await pool.query("UPDATE users SET is_verified = TRUE WHERE id = $1", [userId]);
        await pool.query('DELETE FROM email_otps WHERE user_id = $1', [userId]);

        res.status(200).json({ message: 'Email verified successfully' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// 4. Create Password (Step 3)
export const createPassword = async (req: Request, res: Response) => {
    try {
        const { email, password, confirmPassword } = req.body;

        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        if (password.length < 8 || !/(?=.*\d)(?=.*[a-zA-Z])/.test(password)) {
            return res.status(400).json({ message: 'Password too weak' });
        }

        const userResult = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) return res.status(404).json({ message: 'User not found' });

        const user = userResult.rows[0];
        if (!user.is_verified) {
            return res.status(400).json({ message: 'Email not verified' });
        }

        const hashedPassword = await hashPassword(password);

        await pool.query(
            "UPDATE users SET password = $1, status = 'active' WHERE id = $2",
            [hashedPassword, user.id]
        );

        res.status(200).json({ message: 'Account created successfully. Please login.' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// 5. Login
export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;
        const identifier = (email || '').trim();
        const userResult = await pool.query(
            'SELECT * FROM users WHERE email = $1 OR employee_code = $2',
            [identifier.toLowerCase(), identifier]
        );
        const user = userResult.rows[0];

        if (!user) return res.status(404).json({ message: 'Account not found' });

        if (user.status !== 'active') {
            return res.status(400).json({ message: 'Account not active. Please complete signup.' });
        }

        const isMatch = await comparePassword(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Incorrect credentials' });

        const token = generateToken({ id: user.id, email: user.email, role: user.role });
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                avatar: user.avatar
            }
        });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

import fs from 'fs';
import path from 'path';
import { getUploadsDir } from '../utils/uploads';

// 9. Update Avatar
export const updateAvatar = async (req: Request, res: Response) => {
    try {
        const { email, avatar } = req.body;

        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        let avatarPath = null;

        if (avatar) {
            const matches = avatar.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);

            if (!matches || matches.length !== 3) {
                return res.status(400).json({ message: 'Invalid image format' });
            }

            const imageBuffer = Buffer.from(matches[2], 'base64');
            const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);

            if (userResult.rows.length === 0) {
                return res.status(404).json({ message: 'User not found' });
            }

            const userId = userResult.rows[0].id;
            const filename = `avatar_${userId}_${Date.now()}.jpg`;
            const uploadDir = path.join(getUploadsDir(), 'avatars');
            const filepath = path.join(uploadDir, filename);

            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            fs.writeFileSync(filepath, imageBuffer);
            avatarPath = `/uploads/avatars/${filename}`;
        }

        await pool.query('UPDATE users SET avatar = $1 WHERE email = $2', [avatarPath, email]);

        res.status(200).json({ message: 'Avatar updated successfully', avatar: avatarPath });
    } catch (error: any) {
        console.error('updateAvatar error:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// 6. Resend OTP
export const resendOtp = async (req: Request, res: Response) => {
    try {
        const { email, purpose } = req.body;

        if (purpose === 'signup') {
            const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (userResult.rows.length === 0) return res.status(404).json({ message: 'User not found' });
            const userId = userResult.rows[0].id;

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otpHash = await hashOtp(otp);

            await pool.query(
                "INSERT INTO email_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')",
                [userId, otpHash]
            );

            const emailHtml = getOtpEmailTemplate(otp, 'signup');
            await sendEmail(email, 'Verify Your Account', emailHtml);
            return res.status(200).json({ message: 'OTP resent' });
        }

        if (purpose === 'forgot') {
            const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
            if (userResult.rows.length === 0) return res.status(404).json({ message: 'User not found' });
            const userId = userResult.rows[0].id;

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const otpHash = await hashOtp(otp);

            await pool.query(
                "INSERT INTO email_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')",
                [userId, otpHash]
            );

            const emailHtml = getOtpEmailTemplate(otp, 'forgot');
            await sendEmail(email, 'Password Reset', emailHtml);
            return res.status(200).json({ message: 'OTP resent' });
        }

        res.status(400).json({ message: 'Invalid purpose' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// 7. Request Forgot OTP (DB version)
export const requestForgotOtp = async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) return res.status(404).json({ message: 'Account not found' });
        const userId = userResult.rows[0].id;

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = await hashOtp(otp);
        await pool.query(
            "INSERT INTO email_otps (user_id, otp_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')",
            [userId, otpHash]
        );

        const emailHtml = getOtpEmailTemplate(otp, 'forgot');
        await sendEmail(email, 'Password Reset', emailHtml);
        res.status(200).json({ message: 'OTP sent' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// 8. Confirm Forgot OTP (DB version)
export const confirmForgotOtp = async (req: Request, res: Response) => {
    try {
        const { email, otp, newPassword } = req.body;

        const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (userResult.rows.length === 0) return res.status(404).json({ message: 'User not found' });
        const userId = userResult.rows[0].id;

        const otpResult = await pool.query(
            'SELECT * FROM email_otps WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [userId]
        );

        if (otpResult.rows.length === 0) return res.status(400).json({ message: 'Invalid or expired OTP' });
        const otpRecord = otpResult.rows[0];

        const isValid = await compareOtp(otp, otpRecord.otp_hash);
        if (!isValid) return res.status(400).json({ message: 'Invalid OTP' });

        const hashedPassword = await hashPassword(newPassword);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);

        await pool.query('DELETE FROM email_otps WHERE user_id = $1', [userId]);
        res.status(200).json({ message: 'Password changed successfully' });
    } catch (error: any) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
