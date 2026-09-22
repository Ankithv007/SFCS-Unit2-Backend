import { Pool, Client } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('DB');

const dbUser = process.env.DB_USER || 'postgres';
const dbHost = process.env.DB_HOST || 'localhost';
const dbPassword = process.env.DB_PASSWORD || 'root';
const dbPort = parseInt(process.env.DB_PORT || '5432', 10);
const targetDbName = process.env.DB_NAME || process.env.DB_NAME_RRH || 'rrh_db';

/**
 * Ensures the target database exists in PostgreSQL, creating it if needed.
 */
export const ensureDatabaseExists = async (): Promise<void> => {
    // Connect to the default 'postgres' database to check/create the target database
    const adminClient = new Client({
        user: dbUser,
        host: dbHost,
        database: 'postgres',
        password: dbPassword,
        port: dbPort,
    });

    try {
        await adminClient.connect();
        const checkRes = await adminClient.query(
            `SELECT 1 FROM pg_database WHERE datname = $1`,
            [targetDbName]
        );

        if (checkRes.rowCount === 0) {
            logger.info(`Database "${targetDbName}" does not exist. Creating it now...`);
            // Safe query since targetDbName is validated / internal
            await adminClient.query(`CREATE DATABASE "${targetDbName}"`);
            logger.info(`Database "${targetDbName}" created successfully.`);
        } else {
            logger.info(`Database "${targetDbName}" exists.`);
        }
    } catch (err: any) {
        logger.warn(`Could not verify/create database via admin client: ${err.message}. Proceeding with connection pool.`);
    } finally {
        try {
            await adminClient.end();
        } catch {
            // ignore close error
        }
    }
};

const pool = new Pool({
    user: dbUser,
    host: dbHost,
    database: targetDbName,
    password: dbPassword,
    port: dbPort,
});

pool.on('connect', () => {
    logger.info(`Connected to PostgreSQL database: ${targetDbName}`);
});

pool.on('error', (err) => {
    logger.error(`Unexpected PostgreSQL client error: ${err.message}`);
});

export default pool;
