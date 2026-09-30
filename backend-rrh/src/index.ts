import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { ensureUploadDirectoriesExist } from './utils/uploads';
import { createLogger } from './utils/logger';
import masterDataRoutes from './routes/masterDataRoutes';
import inwardRoutes from './routes/inwardRoutes';
import iviRoutes from './routes/iviRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5007;
const logger = createLogger('Server');

// Middleware
app.use(cors());
app.use(express.json());

import path from 'path';
import fs from 'fs';
import { pool } from './utils/db';
import { runMigrations } from './db/runMigrations';

// Routes
app.use('/api/rrh', masterDataRoutes);
app.use('/api/rrh/inward', inwardRoutes);
app.use('/api/rrh/ivi', iviRoutes);

// Health check
app.get('/api/rrh/health', (req, res) => {
    res.status(200).json({ status: 'RRH Service is healthy.' });
});

// Initialize Database Tables from schema.sql
const initDB = async () => {
    try {
        logger.info("Initializing RRH database tables...");
        const schemaPath = path.join(__dirname, 'db/schema.sql');

        if (fs.existsSync(schemaPath)) {
            const schema = fs.readFileSync(schemaPath, 'utf8');
            await pool.query(schema);
            logger.info("RRH Database tables initialized successfully from schema.sql.");
            
            // Run enterprise migrations
            await runMigrations();
            
            logger.info("RRH migrations completed.");
        } else {
            logger.warn(`schema.sql not found at ${schemaPath}`);
        }
    } catch (err: any) {
        logger.error(`Error initializing RRH database tables: ${err.message}`);
        // Let the failure bubble up to startServer
        throw err;
    }
};

const startServer = async () => {
    try {
        ensureUploadDirectoriesExist();
        await initDB();
        
        app.listen(PORT, () => {
            logger.info(`RRH Microservice running on port ${PORT}`);
        });
    } catch (err: any) {
        logger.error(`Failed to start RRH Backend Server: ${err.message}`);
        process.exit(1);
    }
};

startServer();
