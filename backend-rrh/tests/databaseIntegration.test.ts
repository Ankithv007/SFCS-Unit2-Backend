import { Pool } from 'pg';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

const DB_HOST = process.env.DB_HOST || 'db';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || 'root';
const DB_NAME = process.env.DB_NAME || 'rrh_verification_db';

const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
});

describe('Real PostgreSQL Integration & Concurrency Test Suite (rrh_verification_db)', () => {

    let testWoId = 'WO-INTEG-2026';
    let testSessionId = 0;

    before(async () => {
        // Clean test harness data
        await pool.query('DELETE FROM rrh_ipqc_inspections WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_ivi_inspections WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_inward_scans WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_ipqc_sessions WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_ivi_sessions WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_work_orders WHERE work_order_id = $1', [testWoId]);

        // Seed work order
        await pool.query(
            `INSERT INTO rrh_work_orders (work_order_id, lot_quantity, status)
             VALUES ($1, 100, 'CREATED')`,
            [testWoId]
        );

        // Seed session
        const sessRes = await pool.query(
            `INSERT INTO rrh_ipqc_sessions (work_order_id, status, route)
             VALUES ($1, 'In Progress', 'ECN') RETURNING id`,
            [testWoId]
        );
        testSessionId = sessRes.rows[0].id;
    });

    after(async () => {
        await pool.end();
    });

    test('1. Database Isolation: Confirm rrh_verification_db has zero SMT tables', async () => {
        const res = await pool.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name LIKE 'smt_%'`
        );
        assert.strictEqual(res.rows.length, 0, 'rrh_verification_db must have ZERO SMT tables');
    });

    test('2. Rework ISO-9001 Lineage & supersession pointers in PostgreSQL', async () => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const serial = 'SN-INT-REWORK-01';

            // Step 1: Initial inspection FAILS
            const failRes = await client.query(
                `INSERT INTO rrh_ipqc_inspections (
                    session_id, work_order_id, serial_number, status, remarks, scanned_by, route
                 ) VALUES ($1, $2, $3, 'FAIL', 'Cold solder joint on RF shield', 'Op1', 'ECN')
                 RETURNING id`,
                [testSessionId, testWoId, serial]
            );
            const failId = failRes.rows[0].id;

            // Step 2: Unit is reworked and re-scanned as PASS
            // The earlier failure is soft-deleted to avoid active partial unique collision
            await client.query(
                `UPDATE rrh_ipqc_inspections SET is_deleted = true WHERE id = $1`,
                [failId]
            );

            // Insert new passing record
            const passRes = await client.query(
                `INSERT INTO rrh_ipqc_inspections (
                    session_id, work_order_id, serial_number, status, is_reinspected, defect_fixed, scanned_by, route
                 ) VALUES ($1, $2, $3, 'PASS', true, 'Resoldered RF shield joint', 'Op2', 'ECN')
                 RETURNING id`,
                [testSessionId, testWoId, serial]
            );
            const passId = passRes.rows[0].id;

            // Explicitly link the superseded failure to the new pass
            await client.query(
                `UPDATE rrh_ipqc_inspections
                 SET superseded_by_id = $1, superseded_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [passId, failId]
            );

            await client.query('COMMIT');

            // Verify active record (only the passing record is active)
            const activeRes = await pool.query(
                `SELECT * FROM rrh_ipqc_inspections
                 WHERE session_id = $1 AND serial_number = $2 AND is_deleted = false`,
                [testSessionId, serial]
            );
            assert.strictEqual(activeRes.rows.length, 1);
            assert.strictEqual(activeRes.rows[0].id, passId);
            assert.strictEqual(activeRes.rows[0].is_reinspected, true);
            assert.strictEqual(activeRes.rows[0].defect_fixed, 'Resoldered RF shield joint');

            // Verify superseded failure record is intact in DB with bidirectional pointer
            const supersededRes = await pool.query(
                `SELECT * FROM rrh_ipqc_inspections WHERE id = $1`,
                [failId]
            );
            assert.strictEqual(supersededRes.rows.length, 1);
            assert.strictEqual(supersededRes.rows[0].status, 'FAIL');
            assert.strictEqual(supersededRes.rows[0].remarks, 'Cold solder joint on RF shield');
            assert.strictEqual(supersededRes.rows[0].superseded_by_id, passId);
            assert.ok(supersededRes.rows[0].superseded_at !== null);

            // Querying by superseded_by_id retrieves the original defect
            const auditTraceRes = await pool.query(
                `SELECT * FROM rrh_ipqc_inspections WHERE superseded_by_id = $1`,
                [passId]
            );
            assert.strictEqual(auditTraceRes.rows.length, 1);
            assert.strictEqual(auditTraceRes.rows[0].id, failId);
        } finally {
            client.release();
        }
    });

    test('3. Duplicate Pass Prevention: Database constraint rejects duplicate pass', async () => {
        const client = await pool.connect();
        try {
            const serial = 'SN-INT-REWORK-01'; // Already passed in test 2

            let rejected = false;
            try {
                await client.query('BEGIN');
                await client.query(
                    `INSERT INTO rrh_ipqc_inspections (
                        session_id, work_order_id, serial_number, status, route
                     ) VALUES ($1, $2, $3, 'PASS', 'ECN')`,
                    [testSessionId, testWoId, serial]
                );
                await client.query('COMMIT');
            } catch (err: any) {
                await client.query('ROLLBACK');
                rejected = true;
                assert.match(err.message, /unique|uq_rrh_ipqc/i);
            }
            assert.strictEqual(rejected, true, 'Duplicate active PASS must violate uq_rrh_ipqc_wo_pass_active');
        } finally {
            client.release();
        }
    });

    test('4. Transaction Rollback Safety: Failed transaction leaves no orphaned records', async () => {
        const client = await pool.connect();
        const serial = 'SN-ROLLBACK-TEST';
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO rrh_ipqc_inspections (
                    session_id, work_order_id, serial_number, status, route
                 ) VALUES ($1, $2, $3, 'PASS', 'ECN')`,
                [testSessionId, testWoId, serial]
            );

            // Intentionally force error to trigger rollback
            await client.query('SELECT 1 / 0');
            await client.query('COMMIT');
        } catch {
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }

        // Verify that SN-ROLLBACK-TEST was NOT inserted
        const check = await pool.query(
            `SELECT id FROM rrh_ipqc_inspections WHERE serial_number = $1`,
            [serial]
        );
        assert.strictEqual(check.rows.length, 0, 'Rolled back transaction must leave 0 records');
    });

    test('5. High Concurrency: Simultaneous barcode scan submissions handled safely', async () => {
        const concurrentSerial = 'SN-CONCURRENT-RACE';

        // Spawn 5 simultaneous attempts to scan the same unit as PASS
        const scanAttempt = async (attemptId: number) => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Check pass
                const check = await client.query(
                    `SELECT id FROM rrh_ipqc_inspections
                     WHERE work_order_id = $1 AND UPPER(TRIM(serial_number)) = $2
                       AND is_deleted = false AND status IN ('PASS', 'COMPLETED')
                     LIMIT 1`,
                    [testWoId, concurrentSerial]
                );

                if (check.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return { success: false, reason: 'ALREADY_PASSED' };
                }

                await client.query(
                    `INSERT INTO rrh_ipqc_inspections (
                        session_id, work_order_id, serial_number, status, scanned_by, route
                     ) VALUES ($1, $2, $3, 'PASS', $4, 'ECN')`,
                    [testSessionId, testWoId, concurrentSerial, `Worker-${attemptId}`]
                );

                await client.query('COMMIT');
                return { success: true };
            } catch (err: any) {
                await client.query('ROLLBACK');
                return { success: false, reason: err.message };
            } finally {
                client.release();
            }
        };

        const results = await Promise.all([
            scanAttempt(1),
            scanAttempt(2),
            scanAttempt(3),
            scanAttempt(4),
            scanAttempt(5)
        ]);

        const successful = results.filter(r => r.success);
        assert.strictEqual(successful.length, 1, 'Exactly ONE concurrent scan must succeed');

        // Confirm database has exactly 1 active record for concurrentSerial
        const countRes = await pool.query(
            `SELECT COUNT(*)::int as cnt FROM rrh_ipqc_inspections
             WHERE work_order_id = $1 AND serial_number = $2 AND is_deleted = false`,
            [testWoId, concurrentSerial]
        );
        assert.strictEqual(countRes.rows[0].cnt, 1);
    });

    test('6. Performance Benchmark: 100 sequential barcode lookups & insertions', async () => {
        const durations: number[] = [];

        for (let i = 1; i <= 100; i++) {
            const sn = `SN-BENCH-${i.toString().padStart(4, '0')}`;
            const t0 = performance.now();

            // Measure lookup
            await pool.query(
                `SELECT id FROM rrh_ipqc_inspections
                 WHERE work_order_id = $1 AND UPPER(TRIM(serial_number)) = $2 AND is_deleted = false
                 LIMIT 1`,
                [testWoId, sn]
            );

            // Measure insert
            await pool.query(
                `INSERT INTO rrh_ipqc_inspections (
                    session_id, work_order_id, serial_number, status, route
                 ) VALUES ($1, $2, $3, 'PASS', 'ECN')`,
                [testSessionId, testWoId, sn]
            );

            const t1 = performance.now();
            durations.push(t1 - t0);
        }

        durations.sort((a, b) => a - b);
        const p50 = durations[Math.floor(durations.length * 0.50)];
        const p95 = durations[Math.floor(durations.length * 0.95)];

        console.log(`[PostgreSQL Latency Benchmark] 100 Operations: p50 = ${p50.toFixed(2)}ms, p95 = ${p95.toFixed(2)}ms`);
        assert.ok(p50 < 50, `p50 (${p50}ms) should be well within real-time operational thresholds`);
        assert.ok(p95 < 100, `p95 (${p95}ms) should be well within real-time operational thresholds`);
    });
});
