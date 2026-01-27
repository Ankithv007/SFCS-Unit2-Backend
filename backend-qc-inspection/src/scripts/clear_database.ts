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

const clearDatabase = async () => {
    try {
        console.log('Clearing database tables...');

        // Truncate tables and reset identities
        await pool.query(`
            TRUNCATE TABLE 
                qc_inspection_checklist_result, 
                qc_unit_inspection, 
                qc_unit_tpns, 
                qc_unit_pns 
            RESTART IDENTITY CASCADE;
        `);

        console.log('Database cleared successfully. Ready for a fresh start.');
    } catch (error) {
        console.error('Error clearing database:', error);
    } finally {
        await pool.end();
    }
};

clearDatabase();
