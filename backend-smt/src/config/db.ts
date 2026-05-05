import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'db',
    database: process.env.DB_NAME     || 'smt_db',
    password: process.env.DB_PASSWORD,          // ← no hardcoded fallback
    port:     parseInt(process.env.DB_PORT || '5432', 10),
});

export default pool;
