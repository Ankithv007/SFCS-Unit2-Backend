import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pool } from '../utils/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('Migrations');
const MIGRATION_LOCK_ID = 223456789; // Unique advisory lock ID for RRH migrations

const LEGACY_MIGRATIONS = [
    '001_create_rrh_work_orders.sql',
    '001_initial_rrh_schema.sql',
    '001b_create_rrh_inward_tables.sql',
    '002_enhance_rrh_inward_scans_and_consumption.sql',
    '003_create_rrh_ivi_tables.sql',
    '004_add_inward_scan_id_to_rrh_ivi_inspections.sql',
    '005_add_band_serial_no_to_rrh_ivi_inspections.sql',
    '006_add_sl_no_to_scans_and_inspections.sql',
    '007_add_defect_fixed_to_rrh_ivi_inspections.sql',
    '008_add_checkpoints_and_reinspected.sql',
    '009_add_missing_indexes.sql'
];

function calculateChecksum(content: string): string {
    return crypto.createHash('sha256').update(content.trim().replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export const runMigrations = async (externalClient?: any): Promise<void> => {
    const client = externalClient || await pool.connect();
    const shouldRelease = !externalClient;

    try {
        const expectedDb = process.env.DB_NAME || 'rrh_db';
        const dbCheck = await client.query('SELECT current_database()');
        const currentDb = dbCheck.rows[0]?.current_database;
        logger.info(`Target database verified for RRH migrations: ${currentDb}`);

        // Strict DB Guard: production must be 'rrh_db'. 'rrh_restore_db' is allowed ONLY with explicit ALLOW_RESTORE_DB=true flag.
        const isLiveRrh = currentDb === 'rrh_db';
        const isRestoreAllowed = currentDb === 'rrh_restore_db' && process.env.ALLOW_RESTORE_DB === 'true';
        const isTestAllowed = currentDb.startsWith('rrh_') && (process.env.NODE_ENV === 'test' || process.env.ALLOW_RESTORE_DB === 'true');

        if (!isLiveRrh && !isRestoreAllowed && !isTestAllowed) {
            throw new Error(`CRITICAL SAFETY ERROR: Migration targeted unauthorized database '${currentDb}'. Target must be 'rrh_db', or set ALLOW_RESTORE_DB=true for 'rrh_restore_db'. Aborting!`);
        }

        logger.info('Acquiring migration advisory lock...');
        await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
        logger.info('Migration advisory lock acquired.');

        // Ensure schema_migrations table exists with checksum tracking
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id SERIAL PRIMARY KEY,
                migration_name VARCHAR(255) UNIQUE NOT NULL,
                checksum VARCHAR(64),
                execution_time_ms INTEGER,
                run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
            ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;
        `);

        // Check already executed migrations
        const { rows } = await client.query('SELECT migration_name, checksum FROM schema_migrations');
        const executedMap = new Map<string, string | null>(rows.map((r: any) => [r.migration_name, r.checksum]));

        let migrationsDir = path.join(__dirname, 'migrations');
        if (!fs.existsSync(migrationsDir) || !fs.readdirSync(migrationsDir).some(f => f.endsWith('.sql'))) {
            const srcDir = path.join(__dirname, '../../src/db/migrations');
            if (fs.existsSync(srcDir)) {
                migrationsDir = srcDir;
            }
        }
        if (!fs.existsSync(migrationsDir)) {
            logger.info('No migrations directory found. Skipping migrations.');
            return;
        }

        const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

        let executedCount = 0;

        for (const file of files) {
            const filePath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(filePath, 'utf8');
            const fileChecksum = calculateChecksum(sql);
            const isNoTransaction = sql.includes('-- no-transaction');

            if (executedMap.has(file)) {
                const recordedChecksum = executedMap.get(file);
                if (recordedChecksum && recordedChecksum !== 'SUPERSEDED_BY_001_BASELINE' && recordedChecksum !== fileChecksum) {
                    throw new Error(`CRITICAL CHECKSUM MISMATCH in migration '${file}': Recorded '${recordedChecksum}', File '${fileChecksum}'. Migrations must never be modified after application!`);
                }
                continue;
            }

            logger.info(`Running migration: ${file} (no-transaction: ${isNoTransaction})...`);
            const startTime = Date.now();

            if (isNoTransaction) {
                // Execute without BEGIN...COMMIT. Each CREATE INDEX CONCURRENTLY must be sent as an individual command.
                try {
                    const cleanSql = sql.replace(/--.*$/gm, '');
                    const statements = cleanSql
                        .split(';')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);

                    for (const stmt of statements) {
                        await client.query(stmt);
                    }
                    const duration = Date.now() - startTime;
                    await client.query(
                        'INSERT INTO schema_migrations (migration_name, checksum, execution_time_ms) VALUES ($1, $2, $3) ON CONFLICT (migration_name) DO UPDATE SET checksum = EXCLUDED.checksum, execution_time_ms = EXCLUDED.execution_time_ms',
                        [file, fileChecksum, duration]
                    );
                    logger.info(`Successfully applied migration: ${file} in ${duration}ms`);
                    executedCount++;
                } catch (error) {
                    logger.error(`Failed to apply non-transaction migration: ${file} - ${error}`);
                    throw error;
                }
            } else {
                try {
                    await client.query('BEGIN');
                    await client.query(sql);
                    const duration = Date.now() - startTime;

                    await client.query(
                        'INSERT INTO schema_migrations (migration_name, checksum, execution_time_ms) VALUES ($1, $2, $3) ON CONFLICT (migration_name) DO UPDATE SET checksum = EXCLUDED.checksum, execution_time_ms = EXCLUDED.execution_time_ms',
                        [file, fileChecksum, duration]
                    );

                    // If applying 001_baseline.sql, supersede all legacy migration names
                    if (file === '001_baseline.sql') {
                        for (const legacy of LEGACY_MIGRATIONS) {
                            await client.query(
                                'INSERT INTO schema_migrations (migration_name, checksum, execution_time_ms) VALUES ($1, $2, $3) ON CONFLICT (migration_name) DO NOTHING',
                                [legacy, 'SUPERSEDED_BY_001_BASELINE', 0]
                            );
                        }
                    }

                    await client.query('COMMIT');
                    logger.info(`Successfully applied migration: ${file} in ${duration}ms`);
                    executedCount++;
                } catch (error) {
                    await client.query('ROLLBACK');
                    logger.error(`Failed to apply migration: ${file} - ${error}`);
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
        throw error;
    } finally {
        logger.info('Releasing migration advisory lock...');
        try {
            await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
        } catch (unlockError) {
            logger.error(`Failed to release advisory lock: ${unlockError}`);
        }
        if (shouldRelease && typeof client.release === 'function') {
            client.release();
        }
    }
};

if (require.main === module) {
    runMigrations()
        .then(() => {
            logger.info('Migrations execution finished.');
            process.exit(0);
        })
        .catch(err => {
            logger.error(`Migration execution failed: ${err}`);
            process.exit(1);
        });
}
