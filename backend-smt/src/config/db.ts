import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'db',
    database: process.env.DB_NAME     || 'smt_db',
    password: process.env.DB_PASSWORD,          // ← no hardcoded fallback
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    // Pool limits: keeps default max connections, adds timeouts to prevent exhaustion
    max:                    10,    // same as node-postgres default — no change in headroom
    idleTimeoutMillis:   30000,    // release idle clients after 30 s
    connectionTimeoutMillis: 5000, // fail fast (5 s) instead of hanging on pool saturation
});

export const backendPool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'db',
    database: process.env.DB_NAME_BACKEND || 'backend_process_db',
    password: process.env.DB_PASSWORD,
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    // Secondary pool — lower max since this is read-only backend history queries
    max:                     5,    // conservative for secondary read pool
    idleTimeoutMillis:   30000,
    connectionTimeoutMillis: 5000,
});

export default pool;
