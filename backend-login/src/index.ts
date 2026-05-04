import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import { pool } from './config/db';
import { createLogger } from './utils/logger';
import { hashPassword } from './utils/hashService';
import fs from 'fs';

const logger = createLogger('AUTH');
const app = express();
const PORT = process.env.PORT || 5000;

// ======================
// Middleware
// ======================
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../../../uploads')));

// Request logging
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

// ======================
// Routes
// ======================
app.use('/api/auth', authRoutes);
app.use('/api/auth/admin', adminRoutes); // 🔥 FIXED PREFIX

// ======================
// Health Check
// ======================
app.get('/health', async (req, res) => {
    try {
        const dbRes = await pool.query('SELECT NOW()');
        res.json({
            success: true,
            service: 'backend-login',
            database: 'connected',
            timestamp: dbRes.rows[0].now
        });
    } catch (error: any) {
        logger.error(`Health check failed: ${error.message}`);
        res.status(500).json({
            success: false,
            service: 'backend-login',
            database: 'disconnected',
            error: error.message
        });
    }
});

// ======================
// Error Handler
// ======================
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

// ======================
// Startup
// ======================
const setupDatabase = async () => {
    try {
        logger.info('[Database] Checking schema for Auth Service...');
        const schemaPath = path.join(__dirname, 'db/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);
        logger.info('[Database] Schema initialized successfully.');
    } catch (error) {
        logger.error('[Database] Failed to initialize schema:', error);
        throw error;
    }
};

const seedDatabase = async () => {
    logger.info('[Database] Starting seeding...');
    const usersToSeed = [
        {
            email: process.env.SEED_ADMIN_1_EMAIL,
            password: process.env.SEED_ADMIN_1_PASSWORD,
            name: 'System Admin',
            role: 'Super Admin'
        },
        {
            email: process.env.SEED_ADMIN_2_EMAIL,
            password: process.env.SEED_ADMIN_2_PASSWORD,
            name: 'Ankith',
            role: 'Super Admin'
        },
        {
            email: process.env.SEED_MANAGER_EMAIL,
            password: process.env.SEED_MANAGER_PASSWORD,
            name: 'System Manager',
            role: 'Manager'
        }
    ];

    for (const user of usersToSeed) {
        if (!user.email || !user.password) {
            logger.warn(`[Database] Skipping seeding for ${user.role} as environment variables are missing`);
            continue;
        }
        const hashedPassword = await hashPassword(user.password);
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [user.email]);

        if (existing.rows.length > 0) {
            logger.info(`[Database] Updating ${user.role}: ${user.email}`);
            await pool.query(
                `UPDATE users SET password = $1, role = $2, status = 'active', is_verified = TRUE, name = $3 WHERE email = $4`,
                [hashedPassword, user.role, user.name, user.email]
            );
        } else {
            logger.info(`[Database] Creating ${user.role}: ${user.email}`);
            await pool.query(
                `INSERT INTO users (name, email, password, role, status, is_verified) VALUES ($1, $2, $3, $4, 'active', TRUE)`,
                [user.name, user.email, hashedPassword, user.role]
            );
        }
    }
    logger.info('[Database] Seeding completed.');
};

const startServer = async () => {
    try {
        await setupDatabase();
        await seedDatabase();
        app.listen(PORT, () => {
            logger.info(`Auth Service running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Failed to start Auth Service due to startup error.');
        process.exit(1);
    }
};

startServer();
