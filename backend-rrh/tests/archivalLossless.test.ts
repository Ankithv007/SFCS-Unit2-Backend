import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { pool } from '../src/utils/db';

describe('Lossless Archival and Restoration Lifecycle Tests', () => {
    const archiveWo = `TEST_ARCH_${Date.now()}`;
    let woDbId: number;

    after(async () => {
        // Clean up any remaining records
        if (woDbId) {
            await pool.query('DELETE FROM rrh_inward_scans WHERE work_order_internal_id = $1;', [woDbId]);
            await pool.query('DELETE FROM rrh_inward_scans_archive WHERE work_order_internal_id = $1;', [woDbId]);
            await pool.query('DELETE FROM rrh_inward_sessions WHERE work_order_internal_id = $1;', [woDbId]);
            await pool.query('DELETE FROM rrh_work_orders WHERE id = $1;', [woDbId]);
        }
        await pool.end();
    });

    test('Work order setup with child scan for archival', async () => {
        const woRes = await pool.query(
            `INSERT INTO rrh_work_orders (work_order_id, lot_quantity, status)
             VALUES ($1, 5, 'CREATED')
             RETURNING id, work_order_id;`,
            [archiveWo]
        );
        woDbId = woRes.rows[0].id;

        const sessionRes = await pool.query(
            `INSERT INTO rrh_inward_sessions (work_order_id, status, created_by, created_by_name)
             VALUES ($1, 'Completed', 'tester', 'tester')
             RETURNING id;`,
            [archiveWo]
        );

        await pool.query(
            `INSERT INTO rrh_inward_scans (rrh_inward_session_id, work_order_id, serial_number, scanned_by)
             VALUES ($1, $2, 'SN-ARCH-TEST-001', 'tester');`,
            [sessionRes.rows[0].id, archiveWo]
        );

        // Mark work order completed
        await pool.query(
            `UPDATE rrh_work_orders 
             SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP - INTERVAL '10 days'
             WHERE id = $1;`,
            [woDbId]
        );
    });

    test('archive_closed_work_orders_history preserves scans in archive and removes from live', async () => {
        // Run archival with 0 retention days
        await pool.query('SELECT archive_closed_work_orders_history(0, 50);');

        const woCheck = await pool.query('SELECT status, archived_at FROM rrh_work_orders WHERE id = $1;', [woDbId]);
        assert.strictEqual(woCheck.rows[0].status, 'ARCHIVED');
        assert.ok(woCheck.rows[0].archived_at !== null);

        const liveScans = await pool.query('SELECT count(*) as cnt FROM rrh_inward_scans WHERE work_order_internal_id = $1;', [woDbId]);
        assert.strictEqual(Number(liveScans.rows[0].cnt), 0);

        const archiveScans = await pool.query('SELECT count(*) as cnt FROM rrh_inward_scans_archive WHERE work_order_internal_id = $1;', [woDbId]);
        assert.strictEqual(Number(archiveScans.rows[0].cnt), 1);
    });

    test('restore_archived_work_order restores child records and clears archive copies', async () => {
        const restoreRes = await pool.query('SELECT restore_archived_work_order($1) as restored;', [archiveWo]);
        assert.ok(Number(restoreRes.rows[0].restored) >= 1);

        const woCheck = await pool.query('SELECT status, archived_at FROM rrh_work_orders WHERE id = $1;', [woDbId]);
        assert.strictEqual(woCheck.rows[0].status, 'COMPLETED');
        assert.strictEqual(woCheck.rows[0].archived_at, null);

        const liveScans = await pool.query('SELECT count(*) as cnt FROM rrh_inward_scans WHERE work_order_internal_id = $1;', [woDbId]);
        assert.strictEqual(Number(liveScans.rows[0].cnt), 1);

        const archiveScans = await pool.query('SELECT count(*) as cnt FROM rrh_inward_scans_archive WHERE work_order_internal_id = $1;', [woDbId]);
        assert.strictEqual(Number(archiveScans.rows[0].cnt), 0);
    });
});
