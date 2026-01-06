import { pool } from '../config/db';
import { hashPassword } from './hashService';

const resetPassword = async () => {
    const email = 'test@example.com';
    const newPassword = 'password123';

    try {
        const hashedPassword = await hashPassword(newPassword);

        const result = await pool.query(
            'UPDATE users SET password = $1 WHERE email = $2 RETURNING *',
            [hashedPassword, email]
        );

        if (result.rows.length > 0) {
            console.log(`Password for ${email} has been reset to: ${newPassword}`);
        } else {
            console.log(`User with email ${email} not found.`);
        }
    } catch (error) {
        console.error('Error resetting password:', error);
    } finally {
        pool.end();
    }
};

resetPassword();
