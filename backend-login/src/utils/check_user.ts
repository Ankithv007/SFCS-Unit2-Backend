import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
});

async function checkUser() {
    try {
        const email = 'ankithbvsrvm@gmail.com'; // From update_admin_roles.ts
        const res = await pool.query('SELECT id, email, role FROM users WHERE email = $1', [email]);
        console.log('User found:', res.rows[0]);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

checkUser();
