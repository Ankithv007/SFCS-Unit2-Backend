import express from 'express';
import cors from 'cors';
import qcInspectionRoutes from './routes/qcInspectionRoutes';
import { setupDatabase } from './db/setup_db';
import { createLogger } from './utils/logger';
import { pool } from './config/database';

const logger = createLogger('QC');
const app = express();
const PORT = process.env.PORT || 5003;

app.use(cors());
app.use(express.json());

// Log all requests
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    next();
});

app.use('/api/qc-inspection', qcInspectionRoutes);

// Health Check
app.get('/health', async (req, res) => {
    try {
        const dbRes = await pool.query('SELECT NOW()');
        res.json({
            success: true,
            service: 'backend-qc-inspection',
            database: 'connected',
            timestamp: dbRes.rows[0].now
        });
    } catch (error: any) {
        logger.error(`Health check failed: ${error.message}`);
        res.status(500).json({
            success: false,
            service: 'backend-qc-inspection',
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
    res.send('QC Inspection Service is running');
});

const startServer = async () => {
    try {
        await setupDatabase();
        app.listen(PORT, () => {
            logger.info(`QC Service running on port ${PORT}`);
        });
    } catch (error) {
        logger.error('Failed to start QC Inspection Service.');
        process.exit(1);
    }
};

startServer();
