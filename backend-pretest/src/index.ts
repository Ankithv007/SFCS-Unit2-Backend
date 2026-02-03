import express from 'express';
import cors from 'cors';
import iqcRoutes from './routes/iqcRoutes';
import impedanceRoutes from './routes/impedanceRoutes';
import warehouseRoutes from './routes/warehouseRoutes';
import { setupDatabase } from './db/setup_db';
import { createLogger } from './utils/logger';

const logger = createLogger('PRETEST');
const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

app.use('/api/pretest/iqc', iqcRoutes);
app.use('/api/pretest/impedance', impedanceRoutes);
app.use('/api/pretest/warehouse', warehouseRoutes);

// Health Check
app.get('/health', async (req, res) => {
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

// Centralized Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error(`Unhandled error: ${err.message}`);
    res.status(err.status || 500).json({
        success: false,
        error: err.message || 'Internal Server Error'
    });
});

app.get('/', (req, res) => {
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
