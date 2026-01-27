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
        console.log('Starting migration...');

        // Update qc_unit_inspection
        await pool.query(`
            ALTER TABLE qc_unit_inspection 
            ADD COLUMN IF NOT EXISTS de_assembly_status VARCHAR(50),
            ADD COLUMN IF NOT EXISTS rework_count INT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS final_status VARCHAR(50),
            ADD COLUMN IF NOT EXISTS combined_remarks TEXT;
        `);
        console.log('Updated qc_unit_inspection table');

        // Update qc_inspection_checklist_result
        await pool.query(`
            ALTER TABLE qc_inspection_checklist_result 
            ADD COLUMN IF NOT EXISTS rework_count INT DEFAULT 0,
            ADD COLUMN IF NOT EXISTS history JSONB DEFAULT '[]'::jsonb;
        `);
        console.log('Updated qc_inspection_checklist_result table');

        console.log('Migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await pool.end();
    }
};

migrate();
