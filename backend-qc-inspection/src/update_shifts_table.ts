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

const updateShiftsTable = async () => {
    try {
        console.log('Connecting to DB...');
        const client = await pool.connect();

        console.log('Adding missing columns to shifts table...');

        await client.query(`
            ALTER TABLE shifts 
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS created_by VARCHAR(255),
            ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        `);

        console.log('Columns added successfully.');
        client.release();
    } catch (error) {
        console.error('Error updating table:', error);
    } finally {
        await pool.end();
    }
};

updateShiftsTable();
