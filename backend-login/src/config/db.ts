import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
});

pool.on('connect', async (client) => {
    console.log('Connected to PostgreSQL database');
    try {
        await client.query("SET TIMEZONE = 'Asia/Kolkata'");
        console.log('Timezone set to Asia/Kolkata (IST)');
    } catch (err) {
        console.error('Error setting timezone:', err);
    }
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});
