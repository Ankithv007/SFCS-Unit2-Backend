import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import smtRoutes from './routes/smtRoutes';
import workorderHistoryRoutes from './routes/workorderHistory.routes';
import pool from './config/db';
import { createLogger } from './utils/logger';
import { runMigrations } from './db/runMigrations';

const logger = createLogger('SMT');
const app = express();
const PORT = process.env.PORT || 5005;

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.originalUrl}`);
    next();
});

// Initialize Database Tables from schema.sql
const initDB = async () => {
    try {
        logger.info("Initializing SMT database tables...");
        const schemaPath = path.join(__dirname, 'db/schema.sql');

        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            await pool.query(schema);
            logger.info("SMT Database tables initialized successfully from schema.sql.");
            
            // Run enterprise migrations
            await runMigrations();
            
            logger.info("SMT migrations completed.");
        } else {
            logger.warn(`schema.sql not found at ${schemaPath}`);
        }
    } catch (err: any) {
        logger.error(`Error initializing SMT database tables: ${err.message}`);
        // Let the failure bubble up to startServer
        throw err;
    }
};

// Mount routes with multiple possible prefixes for resilience
app.use('/api', smtRoutes);
app.use('/api/smt', smtRoutes);
app.use('/api', workorderHistoryRoutes);
app.use('/api/smt', workorderHistoryRoutes);

// Health Check
app.get('/health', (req: Request, res: Response) => {
    res.status(200).json({ 
        success: true, 
        service: 'backend-smt', 
        status: 'up',
        timestamp: new Date().toISOString()
    });
});

// 404 Handler
app.use((req: Request, res: Response) => {
    const errorBody = {
        success: false,
        error: 'Route not found in backend-smt',
        method: req.method,
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    };
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json(errorBody);
});

// Centralized Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

const startServer = async () => {
    try {
        await initDB();
        app.listen(PORT, () => {
            logger.info(`SMT Backend Server running on port ${PORT}`);
        });
    } catch (err: any) {
        logger.error(`Failed to start SMT Backend Server: ${err.message}`);
        process.exit(1);
    }
};

startServer();
