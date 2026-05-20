import fs from 'fs';
import path from 'path';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('Migrations');
const MIGRATION_LOCK_ID = 123456789;

export const runMigrations = async (): Promise<void> => {
    const client = await pool.connect();
    
    try {
        logger.info('Acquiring migration advisory lock...');
        // 1. Prevent concurrent migration execution across multiple containers
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        logger.info('Migration advisory lock acquired.');

        // 2. Ensure the migration state table exists (never deletes data)
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                migration_name VARCHAR(255) UNIQUE NOT NULL,
                run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 3. Read all migration files from the migrations directory
        const migrationsDir = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsDir)) {
            logger.info('No migrations directory found. Skipping migrations.');
            return;
        }

        // Safe alphanumeric sorting to ensure 001 runs before 002
        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        // 4. Fetch already executed migrations
        const { rows } = await client.query('SELECT migration_name FROM schema_migrations');
        const executedMigrations = new Set(rows.map(row => row.migration_name));

        let executedCount = 0;

        // 5. Run pending migrations atomically
        for (const file of files) {
            if (!executedMigrations.has(file)) {
                logger.info(`Running migration: ${file}...`);
                const startTime = Date.now();
                
                const filePath = path.join(migrationsDir, file);
                const sql = fs.readFileSync(filePath, 'utf8');

                try {
                    await client.query('BEGIN'); // Start Transaction
                    
                    await client.query(sql); // Execute the migration script
                    
                    await client.query(
                        'INSERT INTO schema_migrations (migration_name) VALUES ($1)', 
                        [file]
                    );
                    
                    await client.query('COMMIT'); // Save Transaction
                    const duration = Date.now() - startTime;
                    logger.info(`Successfully applied migration: ${file} in ${duration}ms`);
                    executedCount++;
                } catch (error) {
                    await client.query('ROLLBACK'); // Revert on failure
                    logger.error(`Failed to apply migration: ${file}`, error);
                    // Throw the error so index.ts handles it gracefully (No process.exit here)
                    throw error; 
                }
            }
        }
        
        if (executedCount === 0) {
            logger.info('Database schema is already up to date.');
        } else {
            logger.info(`Successfully applied ${executedCount} database migrations.`);
        }
    } catch (error) {
        logger.error(`Critical failure during migration execution: ${error}`);
        throw error; // Re-throw to index.ts
    } finally {
        // Always unlock regardless of success or failure
        logger.info('Releasing migration advisory lock...');
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
        } catch (unlockError) {
            logger.error(`Failed to release advisory lock: ${unlockError}`);
        }
        client.release();
    }
};
