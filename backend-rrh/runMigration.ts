import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import { pool } from './src/utils/db';
import fs from 'fs';
import path from 'path';

async function run() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, '../backend-login/src/db/migrations/009_create_rrh_inward_tables.sql'), 'utf-8');
        await pool.query(sql);
        console.log('Migration applied successfully.');
    } catch (e) {
        console.error('Error applying migration', e);
    } finally {
        await pool.end();
    }
}
run();
