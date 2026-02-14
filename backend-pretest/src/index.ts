import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import iqcRoutes from './routes/iqcRoutes';
import impedanceRoutes from './routes/impedanceRoutes';
import warehouseRoutes from './routes/warehouseRoutes';
import preCalibrationRoutes from './routes/preCalibrationRoutes';
import preAclrRoutes from './routes/preAclrRoutes';
import { setupDatabase } from './db/setup_db';
import { createLogger } from './utils/logger';

const logger = createLogger('PRETEST');
const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors({
    exposedHeaders: ['Content-Disposition', 'X-Suggested-Filename']
}));
app.use(express.json());

// Log all requests
app.use((req: Request, res: Response, next: NextFunction) => {
    logger.info(`${req.method} ${req.originalUrl} (Internal: ${req.url})`);
    next();
});

// Mount routes with multiple possible prefixes for resilience
app.use('/api/iqc', iqcRoutes);
app.use('/api/pretest/iqc', iqcRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/pretest/warehouse', warehouseRoutes);
app.use('/api/impedance', impedanceRoutes);
app.use('/api/pretest/impedance', impedanceRoutes);
app.use('/api/pre-calibration', preCalibrationRoutes);
app.use('/api/pretest/pre-calibration', preCalibrationRoutes);
app.use('/api/pre-aclr', preAclrRoutes);
app.use('/api/pretest/pre-aclr', preAclrRoutes);

// Health Check
app.get('/health', async (req: Request, res: Response) => {
    try {
        // Since pool isn't imported here, let's just return true for now 
        // OR import it from config
        res.json({
            success: true,
            service: 'backend-pretest',
            status: 'up'
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            service: 'backend-pretest',
            error: error.message
        });
    }
});

// 404 Handler - Explicit JSON to distinguish from Nginx
app.use((req: Request, res: Response) => {
    const errorBody = {
        success: false,
        error: 'Route not found in backend-pretest',
        method: req.method,
        path: req.originalUrl,
        internalPath: req.url,
        timestamp: new Date().toISOString()
    };
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl} -> ${JSON.stringify(errorBody)}`);
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

app.get('/', (req: Request, res: Response) => {
    res.send('Pre-test Service is running');
});

const startServer = async () => {
    try {
        await setupDatabase();
        app.listen(PORT, () => {
            logger.info(`Pre-test Service running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Failed to start Pre-test Service.');
        process.exit(1);
    }
};

startServer();
