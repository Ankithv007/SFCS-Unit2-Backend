import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { ensureUploadDirectoriesExist } from './utils/uploads';
import { createLogger } from './utils/logger';
import { pool } from './utils/db';
import { runMigrations } from './db/runMigrations';
import masterDataRoutes from './routes/masterDataRoutes';
import inwardRoutes from './routes/inwardRoutes';
import iviRoutes from './routes/iviRoutes';
import ipqcRoutes from './routes/ipqcRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5007;
const logger = createLogger('Server');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Liveness & Readiness Checks
app.get('/api/rrh/health', (req, res) => {
    res.status(200).json({ status: 'healthy', service: 'backend-rrh', uptime: process.uptime() });
});

app.get('/api/rrh/ready', async (req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1 FROM rrh_work_orders LIMIT 1');
        client.release();
        res.status(200).json({ status: 'ready', database: 'connected' });
    } catch (err: any) {
        logger.error(`Readiness check failed: ${err.message}`);
        res.status(503).json({ status: 'not_ready', error: err.message });
    }
});

// Routes
app.use('/api/rrh', masterDataRoutes);
app.use('/api/rrh/inward', inwardRoutes);
app.use('/api/rrh/ivi', iviRoutes);
app.use('/api/rrh/ipqc', ipqcRoutes);

// Central Error Handler Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(`Unhandled Exception on ${req.method} ${req.url}: ${err.message}`, err.stack || '');
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

// Initialize Database via Versioned Migration Runner
const initDB = async () => {
    try {
        logger.info("Initializing RRH database via versioned migration runner...");
        await runMigrations();
        logger.info("RRH database migrations executed successfully.");
    } catch (err: any) {
        logger.error(`Error initializing RRH database tables: ${err.message}`);
        throw err;
    }
};

let server: any;

const startServer = async () => {
    try {
        ensureUploadDirectoriesExist();
        await initDB();
        
        server = app.listen(PORT, () => {
            logger.info(`RRH Microservice running on port ${PORT}`);
        });
    } catch (err: any) {
        logger.error(`Failed to start RRH Backend Server: ${err.message}`);
        process.exit(1);
    }
};

// Graceful Shutdown Handler
const gracefulShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown of RRH service...`);
    if (server) {
        server.close(async () => {
            logger.info("HTTP server closed. Draining database connection pool...");
            try {
                await pool.end();
                logger.info("Database pool successfully closed. Process exiting cleanly.");
                process.exit(0);
            } catch (err: any) {
                logger.error(`Error closing database pool: ${err.message}`);
                process.exit(1);
            }
        });
    } else {
        process.exit(0);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

startServer();
