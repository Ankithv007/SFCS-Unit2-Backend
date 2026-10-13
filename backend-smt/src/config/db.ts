import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'db',
    database: process.env.DB_NAME     || 'smt_db',
    password: process.env.DB_PASSWORD,          // ← no hardcoded fallback
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    // Pool limits: tuned for high-throughput SMT scanning line
    max:                    30,    // 30 connections for main SMT scanning transactions
    idleTimeoutMillis:   30000,    // release idle clients after 30 s
    connectionTimeoutMillis: 10000, // 10s connection timeout for peak burst tolerance
});

export const backendPool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'db',
    database: process.env.DB_NAME_BACKEND || 'backend_process_db',
    password: process.env.DB_PASSWORD,
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    // Secondary pool — increased max for concurrent traceability and history queries
    max:                    20,
    idleTimeoutMillis:   30000,
    connectionTimeoutMillis: 10000,
});

export const authPool = new Pool({
    user:     process.env.DB_USER     || 'postgres',
    host:     process.env.DB_HOST     || 'db',
    database: process.env.DB_NAME_AUTH || 'sfcs_auth',
    password: process.env.DB_PASSWORD,
    port:     parseInt(process.env.DB_PORT || '5432', 10),
    max:                     5,
    idleTimeoutMillis:   30000,
    connectionTimeoutMillis: 5000,
});

export default pool;
