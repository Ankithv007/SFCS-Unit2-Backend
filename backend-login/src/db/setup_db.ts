import { pool } from '../config/db';
import fs from 'fs';
import path from 'path';

const setupDb = async () => {
    try {
        console.log('Checking database schema...');
        // Removed DROP TABLE commands for production safety
        // Tables will be created only if they don't exist (via schema.sql)

        console.log('Tables dropped. Re-creating schema...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        await pool.query(schema);
        console.log('Database schema re-created successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error setting up database:', error);
        process.exit(1);
    }
};

setupDb();
