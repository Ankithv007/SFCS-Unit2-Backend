import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import pool from './config/db';
import { createLogger } from './utils/logger';

import workOrderRoutes from './routes/workOrderRoutes';
import pthRoutes from './routes/pthRoutes';
import viRoutes from './routes/viRoutes';
import qaRoutes from './routes/qaRoutes';
import qiRoutes from './routes/qiRoutes';
import flashingRoutes from './routes/flashingRoutes';
import pcbaFctRoutes from './routes/pcbaFctRoutes';
import assemblyRoutes from './routes/assemblyRoutes';
import unitTestingRoutes from './routes/unitTestingRoutes';
import packingRoutes from './routes/packingRoutes';
import reworkRoutes from './routes/reworkRoutes';
import debugRoutes from './routes/debugRoutes';
import trackRoutes from './routes/trackRoutes';
import backendEmployeeRoutes from './routes/backendEmployeeRoutes';
import exportRoutes from './routes/exportRoutes';
import scanRoutes from './routes/scanRoutes';

const logger = createLogger('BACKEND');
const app = express();
const PORT = process.env.PORT || 5006;

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.originalUrl}`);
    next();
});

// Mount routes
app.use('/api/backend/work-order', workOrderRoutes);
app.use('/api/backend/pth', pthRoutes);
app.use('/api/backend/vi', viRoutes);
app.use('/api/backend/qa', qaRoutes);
app.use('/api/backend/qi', qiRoutes);
app.use('/api/backend/flashing', flashingRoutes);
app.use('/api/backend/pcba-fct', pcbaFctRoutes);
app.use('/api/backend/assembly', assemblyRoutes);
app.use('/api/backend/unit-testing', unitTestingRoutes);
app.use('/api/backend/packing', packingRoutes);
app.use('/api/backend/rework', reworkRoutes);
app.use('/api/backend/debug', debugRoutes);
app.use('/api/backend/track', trackRoutes);
app.use('/api/backend/employees', backendEmployeeRoutes);
app.use('/api/backend/export', exportRoutes);
app.use('/api/backend/scans', scanRoutes);

// Root Route
app.get('/', (req: Request, res: Response) => {
    res.send('Backend Processing Service is running');
});

// Health Check
app.get('/health', (req: Request, res: Response) => {
    res.json({
        success: true,
        service: 'backend-backend',
        status: 'up',
        port: PORT,
        timestamp: new Date().toISOString()
    });
});

// 404 Handler
app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: 'Route not found in backend-backend'
    });
});

// Centralized Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`);
    
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: err.message,
            errorCode: err.errorCode,
            currentStage: err.currentStage,
            requiredStage: err.requiredStage,
            workOrder: err.workOrder,
            batch: err.batch,
            actualBatch: err.actualBatch,
            actualStage: err.actualStage,
            suggestedAction: err.suggestedAction,
            severity: err.severity
        });
    }

    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

// import { runMigrations } from './db/runMigrations';

const setupDatabase = async () => {
    try {
        logger.info('[Database] Initializing schema...');
        const schemaPath = path.join(__dirname, 'db/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);

        logger.info('[Database] Schema initialized successfully.');
        
        // Run enterprise migrations (DISABLED for Pure Centralized Architecture)
        // await runMigrations();
        
        logger.info('[Database] Ready.');
    } catch (error: any) {
        logger.error(`[Database] Failed to initialize schema: ${error.message}`);
        throw error;
    }
};

const startServer = async () => {
    try {
        await setupDatabase();
        app.listen(PORT, () => {
            logger.info(`Backend Service running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Failed to start Backend Service.');
        process.exit(1);
    }
};

startServer();
