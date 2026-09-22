import fs from 'fs';
import path from 'path';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('Migrations');
const MIGRATION_LOCK_ID = 987654321;

export const runMigrations = async (): Promise<void> => {
    const client = await pool.connect();

    try {
        logger.info('Acquiring migration advisory lock...');
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        logger.info('Migration advisory lock acquired.');

        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                migration_name VARCHAR(255) UNIQUE NOT NULL,
                run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const migrationsDir = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsDir)) {
            logger.info('No migrations directory found. Skipping migrations.');
            return;
        }

        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        const { rows } = await client.query('SELECT migration_name FROM schema_migrations');
        const executedMigrations = new Set(rows.map(row => row.migration_name));

        let executedCount = 0;

        for (const file of files) {
            if (!executedMigrations.has(file)) {
                logger.info(`Running migration: ${file}...`);
                const startTime = Date.now();

                const filePath = path.join(migrationsDir, file);
                const sql = fs.readFileSync(filePath, 'utf8');

                try {
                    await client.query('BEGIN');
                    await client.query(sql);
                    await client.query(
                        'INSERT INTO schema_migrations (migration_name) VALUES ($1)',
                        [file]
                    );
                    await client.query('COMMIT');
                    executedCount++;
                    logger.info(`Migration ${file} executed successfully in ${Date.now() - startTime}ms`);
                } catch (migrationErr: any) {
                    await client.query('ROLLBACK');
                    logger.error(`Migration ${file} failed: ${migrationErr.message}`);
                    throw migrationErr;
                }
            }
        }

        if (executedCount === 0) {
            logger.info('Database schema is up to date. No pending migrations.');
        } else {
            logger.info(`Successfully executed ${executedCount} migration(s).`);
        }
    } catch (err: any) {
        logger.error(`Migration run failed: ${err.message}`);
        throw err;
    } finally {
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
            logger.info('Migration advisory lock released.');
        } catch (unlockErr: any) {
            logger.warn(`Failed to release advisory lock: ${unlockErr.message}`);
        }
        client.release();
    }
};
