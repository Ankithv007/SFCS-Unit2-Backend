import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'sfcs_unit2',
    password: process.env.DB_PASSWORD || 'admin',
    port: parseInt(process.env.DB_PORT || '5432'),
});

const addColumns = async () => {
    try {
        console.log('Adding De-Assembly columns to qc_unit_inspection table...');
        await pool.query(`
            ALTER TABLE qc_unit_inspection 
            ADD COLUMN IF NOT EXISTS de_assembly_status VARCHAR(50),
            ADD COLUMN IF NOT EXISTS rework_count INT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS final_status VARCHAR(50),
            ADD COLUMN IF NOT EXISTS combined_remarks TEXT;
        `);
        console.log('Columns added successfully');
    } catch (error) {
        console.error('Error adding columns:', error);
    } finally {
        await pool.end();
    }
};

addColumns();
