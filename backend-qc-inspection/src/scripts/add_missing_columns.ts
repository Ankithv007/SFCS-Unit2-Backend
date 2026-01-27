import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'sfcs_unit2',
    password: process.env.DB_PASSWORD || 'admin',
    port: parseInt(process.env.DB_PORT || '5432'),
});

const migrate = async () => {
    try {
        console.log('Adding good_count and bad_count columns...');
        await pool.query(`
            ALTER TABLE qc_unit_inspection 
            ADD COLUMN IF NOT EXISTS good_count INT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS bad_count INT DEFAULT 0;
        `);
        console.log('Columns added successfully.');
    } catch (error) {
        console.error('Error adding columns:', error);
    } finally {
        await pool.end();
    }
};

migrate();
