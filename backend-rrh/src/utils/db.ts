import { Pool } from 'pg';
import { createLogger } from './logger';

const logger = createLogger('Database');

export const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME, // Usually SMT for RRH as per env
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

pool.on('error', (err, client) => {
    logger.error(`Unexpected error on idle client: ${err.message}`);
    process.exit(-1);
});

export const getClient = () => pool.connect();
