import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { ensureUploadDirectoriesExist } from './utils/uploads';
import { createLogger } from './utils/logger';
import { pool, getPoolDiagnostics, startClusterCacheSync, stopClusterCacheSync } from './utils/db';
import { runMigrations } from './db/runMigrations';
import masterDataRoutes from './routes/masterDataRoutes';
import inwardRoutes from './routes/inwardRoutes';
import iviRoutes from './routes/iviRoutes';
import ipqcRoutes from './routes/ipqcRoutes';
import programmingRoutes from './routes/programmingRoutes';
import preBurnInRoutes from './routes/preBurnInRoutes';
import hipotRoutes from './routes/hipotRoutes';
import postBurnInRoutes from './routes/postBurnInRoutes';
import { startMaintenanceJob, runMaintenanceCycle } from './jobs/maintenanceJob';
import { scannerRateLimiter } from './middleware/rateLimiter';

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

app.get('/api/rrh/diagnostics', async (req, res) => {
    try {
        const poolStats = getPoolDiagnostics();
        const mem = process.memoryUsage();
        res.status(200).json({
            status: 'operational',
            service: 'backend-rrh',
            uptimeSeconds: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            memory: {
                heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
                heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
                rssMb: Math.round(mem.rss / 1024 / 1024)
            },
            database: {
                ...poolStats,
                statementTimeoutMs: 15000
            }
        });
    } catch (err: any) {
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Admin-triggered maintenance cycle (External CronJob or SRE trigger)
app.post('/api/rrh/maintenance/run', async (req, res) => {
    try {
        const retentionDays = req.query.retentionDays !== undefined ? Number(req.query.retentionDays) : 180;
        const maxOrders = req.query.maxOrders !== undefined ? Number(req.query.maxOrders) : 10;
        const result = await runMaintenanceCycle(retentionDays, maxOrders);
        const statusCode = result.success ? 200 : (result.message.includes('lock') ? 409 : 500);
        res.status(statusCode).json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Rate Limiting Protection (Max 60 requests / 10s per terminal to stop jammed scanners)
app.use('/api/rrh', scannerRateLimiter(60, 10000));

// Routes
app.use('/api/rrh', masterDataRoutes);
app.use('/api/rrh/inward', inwardRoutes);
app.use('/api/rrh/ivi', iviRoutes);
app.use('/api/rrh/ipqc', ipqcRoutes);
app.use('/api/rrh/programming', programmingRoutes);
app.use('/api/rrh/pre-burn-in', preBurnInRoutes);
app.use('/api/rrh/hipot', hipotRoutes);
app.use('/api/rrh/post-burn-in', postBurnInRoutes);

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

const validateProductionEnvironment = () => {
    if (process.env.NODE_ENV === 'production') {
        if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret') {
            throw new Error('CRITICAL SECURITY HALT: In production mode, JWT_SECRET must be configured with a cryptographically secure key!');
        }
        if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === 'root') {
            throw new Error('CRITICAL SECURITY HALT: Default DB_PASSWORD is prohibited in production mode!');
        }
    }
};

let server: any;

const startServer = async () => {
    try {
        validateProductionEnvironment();
        ensureUploadDirectoriesExist();
        await initDB();
        await startClusterCacheSync();
        
        server = app.listen(PORT, () => {
            logger.info(`RRH Microservice running on port ${PORT}`);
            startMaintenanceJob();
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
            logger.info("HTTP server closed. Draining database connection pools...");
            try {
                await stopClusterCacheSync();
                await pool.end();
                logger.info("Database pools successfully closed. Process exiting cleanly.");
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
