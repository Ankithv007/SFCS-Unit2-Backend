import { Pool } from 'pg';
import { createLogger } from './logger';

const logger = createLogger('Database');

const rrhDbName = process.env.DB_NAME || process.env.DB_NAME_RRH || 'rrh_db';

// Strict Safety Guard: Block any accidental connection to production SMT or Backend databases
if (rrhDbName === 'smt_db' || rrhDbName === 'backend_process_db') {
    throw new Error(`CRITICAL SECURITY VIOLATION: backend-rrh is strictly isolated and prohibited from connecting to '${rrhDbName}'! It must connect only to 'rrh_db'.`);
}

export const pool = new Pool({
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'root',
    database: rrhDbName,
    max: Number(process.env.DB_POOL_MAX || 20),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONN_TIMEOUT_MS || 5000),
});

pool.on('connect', () => {
    logger.info(`Connected to dedicated RRH PostgreSQL database: ${rrhDbName}`);
});

pool.on('error', (err) => {
    // Log the error but do NOT crash the process. The pg pool automatically
    // recovers from transient idle-client errors by creating new connections.
    logger.error(`Unexpected error on idle pool client (pool will recover): ${err.message}`);
});

export const getClient = () => pool.connect();
