import pool from '../config/db';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('VLT');

export const setupDatabase = async () => {
    try {
        logger.info('Checking database schema...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        if (schema.trim()) {
            await pool.query(schema);
        }
        logger.info('Schema initialized successfully.');
    } catch (error: any) {
        logger.error(`Failed to initialize schema: ${error.message}`);
        throw error;
    }
};
