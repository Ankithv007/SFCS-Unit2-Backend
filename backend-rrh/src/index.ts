import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import rrhRoutes from './routes/rrhRoutes';
import pool, { ensureDatabaseExists } from './config/db';
import { createLogger } from './utils/logger';
import { runMigrations } from './db/runMigrations';
import { ensureUploadDirectoriesExist } from './utils/uploads';

const logger = createLogger('RRH');
const app = express();
const PORT = process.env.PORT || 5007;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.originalUrl}`);
    next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'healthy', service: 'backend-rrh', timestamp: new Date() });
});

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
    res.send('RRH (Remote Radio Head) Processing Service is running');
});

// Mount routes (Supports both direct and gateway-stripped paths)
app.use('/api/rrh', rrhRoutes);
app.use('/api', rrhRoutes);
app.use('/', rrhRoutes);

// Initialize Database and Directories
const initDB = async () => {
    try {
        logger.info('Initializing RRH database...');
        await ensureDatabaseExists();

        const schemaPath = path.join(__dirname, 'db/schema.sql');
        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            await pool.query(schema);
            logger.info('RRH Database baseline schema verified.');
        }

        // Run migrations
        await runMigrations();
        logger.info('RRH migrations completed successfully.');

        // Initialize uploads directories
        ensureUploadDirectoriesExist();
    } catch (err: any) {
        logger.error(`Error initializing RRH database: ${err.message}`);
        throw err;
    }
};

const startServer = async () => {
    try {
        await initDB();
        app.listen(PORT, () => {
            logger.info(`RRH Microservice running on port ${PORT}`);
        });
    } catch (err: any) {
        logger.error(`Failed to start RRH service: ${err.message}`);
        process.exit(1);
    }
};

startServer();

export default app;
