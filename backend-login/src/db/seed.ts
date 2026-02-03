import { pool } from '../config/db';
import { hashPassword } from '../utils/hashService';
import { createLogger } from '../utils/logger';

const logger = createLogger('AUTH-SEED');

export const seedDatabase = async () => {
    logger.info('Starting database seeding...');

    const admins = [
        {
            email: process.env.SEED_ADMIN_1_EMAIL,
            password: process.env.SEED_ADMIN_1_PASSWORD,
            name: 'System Admin'
        },
        {
            email: process.env.SEED_ADMIN_2_EMAIL,
            password: process.env.SEED_ADMIN_2_PASSWORD,
            name: 'Ankith'
        }
    ];

    for (const admin of admins) {
        if (!admin.email || !admin.password) {
            throw new Error('Super Admin environment variables are missing');
        }

        const hashedPassword = await hashPassword(admin.password);

        const existing = await pool.query(
            'SELECT id FROM users WHERE email = $1',
            [admin.email]
        );

        if (existing.rows.length > 0) {
            logger.info(`Updating Super Admin: ${admin.email}`);

            await pool.query(
                `
                UPDATE users
                SET
                    password = $1,
                    role = 'Super Admin',
                    status = 'active',
                    is_verified = TRUE,
                    name = $2
                WHERE email = $3
                `,
                [hashedPassword, admin.name, admin.email]
            );
        } else {
            logger.info(`Creating Super Admin: ${admin.email}`);

            await pool.query(
                `
                INSERT INTO users (name, email, password, role, status, is_verified)
                VALUES ($1, $2, $3, 'Super Admin', 'active', TRUE)
                `,
                [admin.name, admin.email, hashedPassword]
            );
        }
    }

    logger.info('Database seeding completed successfully.');
};
