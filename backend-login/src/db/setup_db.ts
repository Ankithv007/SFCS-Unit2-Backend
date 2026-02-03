import { pool } from '../config/db';
import fs from 'fs';
import path from 'path';

export const setupDatabase = async () => {
    try {
        console.log('[Database] Checking schema for Auth Service...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        // Execute schema.sql (contains IF NOT EXISTS)
        await pool.query(schema);
        console.log('[Database] Schema initialized successfully.');
    } catch (error) {
        console.error('[Database] Failed to initialize schema:', error);
        throw error; // Re-throw to prevent server startup
    }
};
