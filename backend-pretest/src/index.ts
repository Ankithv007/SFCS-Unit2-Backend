import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import iqcRoutes from './routes/iqcRoutes';
import impedanceRoutes from './routes/impedanceRoutes';
import warehouseRoutes from './routes/warehouseRoutes';
import preCalibrationRoutes from './routes/preCalibrationRoutes';
import preAclrRoutes from './routes/preAclrRoutes';
import traceRoutes from './routes/traceRoutes';
import path from 'path';
import fs from 'fs';
import pool from './config/db';
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
app.use('/api/trace', traceRoutes);
app.use('/api/pretest/trace', traceRoutes);

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

const setupDatabase = async () => {
    try {
        logger.info('[Database] Checking schema for Pretest Service...');
        const schemaPath = path.join(__dirname, 'db/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schema);
        logger.info('[Database] Schema initialized successfully.');

        await seedTestCaseMaster();
        await seedAclrTestCaseMaster();
    } catch (error: any) {
        logger.error(`[Database] Failed to initialize schema: ${error.message}`);
        throw error;
    }
};

const seedTestCaseMaster = async () => {
    const testCases = [
        { id: 53, name: 'pam-adc-access', reason: 'ADC access failure' },
        { id: 54, name: 'rf-detector-test', reason: 'RF detector failure' },
        { id: 358, name: 'pam_bl_input_voltage_read_at_adc', reason: 'Voltage reading failure' },
        { id: 51, name: 'pam_bl_calibration_default', reason: 'Default calibration failure' },
        { id: 50, name: 'pam_eeprom', reason: 'EEPROM failure' }
    ];

    try {
        for (const tc of testCases) {
            await pool.query(`
                INSERT INTO test_case_master (test_case_number, test_case_name, reason)
                VALUES ($1, $2, $3)
                ON CONFLICT (test_case_number) DO UPDATE 
                SET test_case_name = EXCLUDED.test_case_name, reason = EXCLUDED.reason
            `, [tc.id, tc.name, tc.reason]);
        }
        logger.info('[Database] Test Case Master seeded successfully.');
    } catch (error: any) {
        logger.error(`[Database] Failed to seed Test Case Master: ${error.message}`);
    }
};

const seedAclrTestCaseMaster = async () => {
    const testCases = [
        { id: 1, name: 'PAM Fixture power Control', reason: 'Group header(D)' },
        { id: 2, name: 'Visa Interface - PAM_fixture - Establish connection', reason: '-' },
        { id: 3, name: 'Delay - 2sec', reason: '-' },
        { id: 4, name: 'Visa Interface - PAM_fixture - Disconnect', reason: '-' },
        { id: 5, name: 'Visa Interface - PAM_fixture - Connect', reason: '-' },
        { id: 6, name: 'HTTP - Connect', reason: '-' },
        { id: 7, name: 'HTTP - read diag version number', reason: '-' },
        { id: 8, name: 'HTTP-read+pam_eeprom', reason: '-' },
        { id: 9, name: 'Database - Start bit', reason: '-' },
        { id: 10, name: 'HTTP - Check CTM enable status', reason: '-' },
        { id: 11, name: 'HTTP - pam_b1_htswp_callib', reason: '-' },
        { id: 12, name: 'frequency - 2.1125GHz', reason: 'Group header' },
        { id: 13, name: 'R&S Interface - (W) Select tab 1', reason: '-' },
        { id: 14, name: 'R&S Interface - (W) Configure Center frequency - 2.1125GHz', reason: '-' },
        { id: 15, name: 'R&S Interface - (R) Read the Center frequency', reason: '-' },
        { id: 16, name: 'HTTP - lo_shift_2112500000', reason: '-' },
        { id: 17, name: 'R&S - Verify default Power', reason: '-' },
        { id: 18, name: 'R&S - Verify default ACLR', reason: '-' },
        { id: 19, name: 'Power output regularize - raw power', reason: '-' },
        { id: 20, name: 'R&S - Read RAW ACLR', reason: '-' },
        { id: 21, name: 'HTTP - tracking_calibration', reason: '-' },
        { id: 22, name: 'HTTP - reset_dpd', reason: '-' },
        { id: 23, name: 'HTTP - Get_dpd_status', reason: '-' },
        { id: 24, name: 'R&S - Read dpd Power', reason: '-' },
        { id: 25, name: 'R&S - Read dpd ACLR', reason: '-' },
        { id: 26, name: 'R&S Interface - (W) Select tab 2', reason: '-' },
        { id: 27, name: 'R&S Interface - (W) Configure Center frequency - 2.1125GHz', reason: '-' },
        { id: 28, name: 'R&S Interface - (R) Read the Center frequency', reason: '-' },
        { id: 29, name: 'R&S Interface - (W) Auto adjust settings CCDF', reason: '-' },
        { id: 30, name: 'Wait time - 3 sec', reason: '-' },
        { id: 31, name: 'R&S - Read Peak power', reason: '-' },
        { id: 32, name: 'R&S - Read the level value for 0.01% probability', reason: '-' },
        { id: 33, name: 'frequency - 2.1675GHz', reason: 'Group header' },
        { id: 34, name: 'R&S Interface - (W) Select tab 1', reason: '-' },
        { id: 35, name: 'R&S Interface - (W) Configure Center frequency - 2.1675GHz', reason: '-' },
        { id: 36, name: 'R&S Interface - (R) Read the Center frequency', reason: '-' },
        { id: 37, name: 'HTTP - lo_shift_2167500000', reason: '-' },
        { id: 38, name: 'R&S - Verify default Power', reason: '-' },
        { id: 39, name: 'R&S - Verify default ACLR', reason: '-' },
        { id: 40, name: 'Power output regularize - raw power', reason: '-' },
        { id: 41, name: 'R&S - Read RAW ACLR', reason: '-' },
        { id: 42, name: 'HTTP - tracking_calibration', reason: '-' },
        { id: 44, name: 'HTTP - Get dpd status', reason: '-' },
        { id: 45, name: 'R&S - Read dpd Power', reason: '-' },
        { id: 46, name: 'R&S - Read dpd ACLR', reason: '-' },
        { id: 47, name: 'R&S Interface - (W) Select tab 2', reason: '-' },
        { id: 48, name: 'R&S Interface - (W) Configure Center frequency - 2.1675GHz', reason: '-' },
        { id: 49, name: 'R&S Interface - (R) Read the Center frequency', reason: '-' },
        { id: 50, name: 'R&S Interface - (W) Auto adjust settings CCDF', reason: '-' },
        { id: 51, name: 'Wait time - 3 sec', reason: '-' },
        { id: 52, name: 'R&S - Read Peak power', reason: '-' },
        { id: 53, name: 'R&S - Read the level value for 0.01% probability', reason: '-' },
        { id: 54, name: 'HTTP - pam_b1_current_read', reason: '-' },
        { id: 55, name: 'HTTP - pam_b1_fwd_minus_rev_pwr_read', reason: '-' },
        { id: 56, name: 'Resetting', reason: 'Group header' },
        { id: 57, name: 'HTTP - disable_pam', reason: '-' },
        { id: 58, name: 'HTTP - Disconnect', reason: '-' },
        { id: 59, name: 'Visa Interface - PAM_fixture - Disconnect', reason: '-' },
        { id: 60, name: 'Visa Interface - PAM_fixture - Close connection', reason: '-' },
        { id: 61, name: 'Database - Start bit', reason: '-' },
        { id: 62, name: 'End of sequence', reason: '-' }
    ];

    try {
        for (const tc of testCases) {
            await pool.query(`
                INSERT INTO aclr_test_case_master (test_case_number, test_case_name, reason)
                VALUES ($1, $2, $3)
                ON CONFLICT (test_case_number) DO UPDATE 
                SET test_case_name = EXCLUDED.test_case_name, reason = EXCLUDED.reason
            `, [tc.id, tc.name, tc.reason]);
        }
        logger.info('[Database] ACLR Test Case Master seeded successfully.');
    } catch (error: any) {
        logger.error(`[Database] Failed to seed ACLR Test Case Master: ${error.message}`);
    }
};

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
