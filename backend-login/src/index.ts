import express from 'express';
import cors from 'cors';
import path from 'path';
import authRoutes from './routes/authRoutes';
import adminRoutes from './routes/adminRoutes';
import { pool } from './config/db';
import { setupDatabase } from './db/setup_db';
import { seedDatabase } from './db/seed';
import { createLogger } from './utils/logger';

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
const startServer = async () => {
    try {
        await setupDatabase();   // Ensure schema
        await seedDatabase();    // Insert Super Admins
        app.listen(PORT, () => {
            logger.info(`Auth Service running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Failed to start Auth Service due to startup error.');
        process.exit(1);
    }
};

startServer();
