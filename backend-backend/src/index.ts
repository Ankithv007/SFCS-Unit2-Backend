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
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

const setupDatabase = async () => {
    try {
        logger.info('[Database] Initializing schema...');
        const schemaPath = path.join(__dirname, 'db/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);

        // Seed Production Stages
        logger.info('[Database] Seeding production stages...');
        const stages = [
            { name: 'PTH', order: 1 },
            { name: 'VI', order: 2 },
            { name: 'QA', order: 3 },
            { name: 'Flashing', order: 4 },
            { name: 'PCBA-FCT', order: 5 },
            { name: 'Assembly', order: 6 },
            { name: 'Unit Testing', order: 7 },
            { name: 'QI', order: 8 },
            { name: 'Packing', order: 9 },
            { name: 'Rework', order: 10 },
            { name: 'Debug', order: 11 }
        ];

        for (const stage of stages) {
            await pool.query(
                `INSERT INTO production_stages (stage_name, stage_order) 
                 VALUES ($1, $2) ON CONFLICT (stage_name) DO NOTHING`,
                [stage.name, stage.order]
            );
        }

        // Rename Remark Tables if they exist and target names don't
        logger.info('[Database] Checking for remark table renames...');
        await pool.query(`
            DO $$ 
            BEGIN 
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'remark_batches') 
                   AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'rework_batches') THEN
                    ALTER TABLE IF EXISTS remark_batches RENAME TO rework_batches;
                END IF;
                
                IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'remark_scans') 
                   AND NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'rework_scans') THEN
                    ALTER TABLE IF EXISTS remark_scans RENAME TO rework_scans;
                END IF;
            END $$;
        `);

        logger.info('[Database] Schema and seeding completed successfully.');
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
