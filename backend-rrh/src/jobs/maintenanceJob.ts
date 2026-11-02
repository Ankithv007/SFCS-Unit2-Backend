import { pool } from '../utils/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('MaintenanceJob');

const MAINTENANCE_LOCK_ID = 987654321; // Cluster-wide advisory lock for distributed maintenance

/**
 * Executes automated archiving of closed work orders and purges orphaned master data.
 * Safe for horizontally scaled multi-replica deployments via PostgreSQL advisory locks.
 */
export const runMaintenanceCycle = async (retentionDays = 180, maxOrders = 10): Promise<{ success: boolean; archivedOrders: number; purgedRecords: number; message: string }> => {
    let client;
    try {
        client = await pool.connect();
        
        // Attempt cluster-wide lock; if another replica is already running, skip cleanly
        const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired;', [MAINTENANCE_LOCK_ID]);
        const acquired = lockRes.rows[0]?.acquired;
        
        if (!acquired) {
            logger.info('[Maintenance] Another server instance is currently executing the maintenance cycle. Yielding lock.');
            return { success: false, archivedOrders: 0, purgedRecords: 0, message: 'Maintenance lock held by another cluster instance.' };
        }

        logger.info('[Maintenance] Acquired cluster lock. Starting automated database maintenance cycle...');

        // 1. Archive closed work orders older than retention days (micro-batched)
        const archiveRes = await client.query('SELECT archive_closed_work_orders_history($1, $2) AS archived_orders;', [retentionDays, maxOrders]);
        const archivedCount = archiveRes.rows[0]?.archived_orders || 0;
        logger.info(`[Maintenance] Archived closed work orders: ${archivedCount}`);

        // 2. Batch-purge orphaned/unconfirmed Excel master data
        const purgeRes = await client.query('SELECT purge_orphaned_excel_master_data(5000) AS purged_count;');
        const purgedCount = purgeRes.rows[0]?.purged_count || 0;
        logger.info(`[Maintenance] Purged orphaned Excel master data records: ${purgedCount}`);

        logger.info('[Maintenance] Database maintenance cycle completed successfully.');
        return { success: true, archivedOrders: archivedCount, purgedRecords: purgedCount, message: 'Maintenance cycle completed successfully.' };
    } catch (err: any) {
        logger.error(`[Maintenance] Error during automated maintenance cycle: ${err.message}`);
        return { success: false, archivedOrders: 0, purgedRecords: 0, message: err.message };
    } finally {
        if (client) {
            try {
                await client.query('SELECT pg_advisory_unlock($1);', [MAINTENANCE_LOCK_ID]);
            } catch {}
            client.release();
        }
    }
};

/**
 * Initializes recurring 24-hour maintenance job unless disabled by environment configuration.
 */
export const startMaintenanceJob = (): void => {
    if (process.env.DISABLE_INTERNAL_CRON === 'true') {
        logger.info('[Maintenance] Internal cron disabled via DISABLE_INTERNAL_CRON=true. Delegating to external orchestrator.');
        return;
    }

    // Run initial maintenance check 60 seconds after server boot
    setTimeout(() => {
        runMaintenanceCycle().catch(err => {
            logger.warn(`Initial maintenance run error: ${err.message}`);
        });
    }, 60 * 1000).unref();

    // Schedule to execute every 24 hours
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setInterval(() => {
        runMaintenanceCycle().catch(err => {
            logger.warn(`Recurring maintenance run error: ${err.message}`);
        });
    }, TWENTY_FOUR_HOURS).unref();

    logger.info('[Maintenance] Scheduled 24-hour automated database maintenance worker.');
};

