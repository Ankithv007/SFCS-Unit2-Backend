import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import vacuumLeakTestRoutes from './routes/vacuumLeakTestRoutes';
import pool from './config/db';
import { createLogger } from './utils/logger';

const logger = createLogger('VLT');
const app = express();
const PORT = process.env.PORT || 5004;

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

app.use('/api/vacuum-leak-test', vacuumLeakTestRoutes);

// Health Check
app.get('/health', async (req, res) => {
    try {
        const dbRes = await pool.query('SELECT NOW()');
        res.json({
            success: true,
            service: 'backend-vacuum-leak-test',
            database: 'connected',
            timestamp: dbRes.rows[0].now
        });
    } catch (error: any) {
        logger.error(`Health check failed: ${error.message}`);
        res.status(500).json({
            success: false,
            service: 'backend-vacuum-leak-test',
            database: 'disconnected',
            error: error.message
        });
    }
});

// Centralized Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

app.get('/', (req, res) => {
    res.send('Vacuum Leak Test Service is running');
});

import { runMigrations } from './db/runMigrations';

const setupDatabase = async () => {
    try {
        logger.info('[Database] Checking schema for VLT Service...');
        const schemaPath = path.join(__dirname, 'db/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);
        logger.info('[Database] Schema initialized successfully.');
        
        // Run enterprise migrations
        await runMigrations();
        
        logger.info('[Database] Migrations completed successfully.');
    } catch (error) {
        logger.error(`[Database] Failed to initialize schema: ${error}`);
        throw error;
    }
};

const startServer = async () => {
    try {
        await setupDatabase();
        app.listen(PORT, () => {
            logger.info(`Vacuum Leak Test Service running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Failed to start Vacuum Leak Test Service.');
        process.exit(1);
    }
};

startServer();
