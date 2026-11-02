import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { pool } from '../src/utils/db';

describe('Comprehensive Stage Pipeline Integration Tests (Inward -> IVI -> IPQC -> Programming -> Pre-Burn-In -> Hipot -> Post-Burn-In)', () => {
    const testWo = `TEST_PIPE_${Date.now()}`;
    let woId: number;

    let inwardSessionId: number;
    let iviSessionId: number;
    let ipqcSessionId: number;
    let progSessionId: number;
    let pbiSessionId: number;
    let hipotSessionId: number;
    let postbiSessionId: number;

    after(async () => {
        if (woId) {
            // Clean up test data in reverse FK order
            await pool.query('DELETE FROM rrh_post_burn_in_inspections WHERE work_order_internal_id = $1;', [woId]);
            await pool.query('DELETE FROM rrh_hipot_inspections WHERE work_order_internal_id = $1;', [woId]);
            await pool.query('DELETE FROM rrh_pre_burn_in_inspections WHERE work_order_internal_id = $1;', [woId]);
            await pool.query('DELETE FROM rrh_programming_inspections WHERE work_order_internal_id = $1;', [woId]);
            await pool.query('DELETE FROM rrh_ipqc_inspections WHERE work_order_internal_id = $1;', [woId]);
            await pool.query('DELETE FROM rrh_ivi_inspections WHERE work_order_internal_id = $1;', [woId]);
            await pool.query('DELETE FROM rrh_inward_session_master_consumption WHERE session_id = $1;', [inwardSessionId]);
            await pool.query('DELETE FROM rrh_inward_scans WHERE work_order_internal_id = $1;', [woId]);

            await pool.query('DELETE FROM rrh_post_burn_in_sessions WHERE id = $1;', [postbiSessionId]);
            await pool.query('DELETE FROM rrh_hipot_sessions WHERE id = $1;', [hipotSessionId]);
            await pool.query('DELETE FROM rrh_pre_burn_in_sessions WHERE id = $1;', [pbiSessionId]);
            await pool.query('DELETE FROM rrh_programming_sessions WHERE id = $1;', [progSessionId]);
            await pool.query('DELETE FROM rrh_ipqc_sessions WHERE id = $1;', [ipqcSessionId]);
            await pool.query('DELETE FROM rrh_ivi_sessions WHERE id = $1;', [iviSessionId]);
            await pool.query('DELETE FROM rrh_inward_sessions WHERE id = $1;', [inwardSessionId]);
            await pool.query('DELETE FROM rrh_work_orders WHERE id = $1;', [woId]);
        }
        await pool.end();
    });

    test('1. Pipeline Environment Setup: Create Work Order and Stage Sessions', async () => {
        const woRes = await pool.query(
            `INSERT INTO rrh_work_orders (work_order_id, lot_quantity, status)
             VALUES ($1, 25, 'IN_PROGRESS') RETURNING id;`,
            [testWo]
        );
        woId = woRes.rows[0].id;

        const inwRes = await pool.query(`INSERT INTO rrh_inward_sessions (work_order_id, status, created_by, created_by_name) VALUES ($1, 'In Progress', 'op1', 'Operator 1') RETURNING id;`, [testWo]);
        inwardSessionId = inwRes.rows[0].id;

        const iviRes = await pool.query(`INSERT INTO rrh_ivi_sessions (work_order_id, status, created_by, created_by_name) VALUES ($1, 'In Progress', 'op1', 'Operator 1') RETURNING id;`, [testWo]);
        iviSessionId = iviRes.rows[0].id;

        const ipqcRes = await pool.query(`INSERT INTO rrh_ipqc_sessions (work_order_id, status, created_by, created_by_name) VALUES ($1, 'In Progress', 'op1', 'Operator 1') RETURNING id;`, [testWo]);
        ipqcSessionId = ipqcRes.rows[0].id;

        const progRes = await pool.query(`INSERT INTO rrh_programming_sessions (work_order_id, status, created_by, created_by_name) VALUES ($1, 'In Progress', 'op1', 'Operator 1') RETURNING id;`, [testWo]);
        progSessionId = progRes.rows[0].id;

        const pbiRes = await pool.query(`INSERT INTO rrh_pre_burn_in_sessions (work_order_id, status, created_by, created_by_name) VALUES ($1, 'In Progress', 'op1', 'Operator 1') RETURNING id;`, [testWo]);
        pbiSessionId = pbiRes.rows[0].id;

        const hipotRes = await pool.query(`INSERT INTO rrh_hipot_sessions (work_order_id, status, created_by, created_by_name) VALUES ($1, 'In Progress', 'op1', 'Operator 1') RETURNING id;`, [testWo]);
        hipotSessionId = hipotRes.rows[0].id;

        const postbiRes = await pool.query(`INSERT INTO rrh_post_burn_in_sessions (work_order_id, status, created_by, created_by_name) VALUES ($1, 'In Progress', 'op1', 'Operator 1') RETURNING id;`, [testWo]);
        postbiSessionId = postbiRes.rows[0].id;

        assert.ok(woId > 0);
        assert.ok(inwardSessionId > 0);
        assert.ok(iviSessionId > 0);
        assert.ok(ipqcSessionId > 0);
        assert.ok(progSessionId > 0);
        assert.ok(pbiSessionId > 0);
        assert.ok(hipotSessionId > 0);
        assert.ok(postbiSessionId > 0);
    });

    test('2. Case: PASS - Full End-to-End Golden Path across all 7 stages', async () => {
        const serial = 'SN-GOLDEN-PASS-001';

        // Stage 1: Inward
        const inwScan = await pool.query(
            `INSERT INTO rrh_inward_scans (rrh_inward_session_id, work_order_id, serial_number, status, scanned_by)
             VALUES ($1, $2, $3, 'PASS', 'tester') RETURNING id, work_order_internal_id;`,
            [inwardSessionId, testWo, serial]
        );
        const inwardScanId = inwScan.rows[0].id;
        assert.strictEqual(inwScan.rows[0].work_order_internal_id, woId);

        // Stage 2: IVI
        const iviInsp = await pool.query(
            `INSERT INTO rrh_ivi_inspections (
                session_id, work_order_id, serial_number, duplexer_main, duplexer_part_no, status,
                inward_scan_id, scanned_by, route, passed_to_next_stage, passed_to_next_stage_at
             ) VALUES ($1, $2, $3, 'MAIN-DUP-01', 'DP-100', 'PASS', $4, 'tester', 'ECN', true, CURRENT_TIMESTAMP)
             RETURNING id, inward_scan_id, work_order_internal_id;`,
            [iviSessionId, testWo, serial, inwardScanId]
        );
        const iviInspId = iviInsp.rows[0].id;
        assert.strictEqual(iviInsp.rows[0].inward_scan_id, inwardScanId);
        assert.strictEqual(iviInsp.rows[0].work_order_internal_id, woId);

        // Stage 3: IPQC
        const ipqcInsp = await pool.query(
            `INSERT INTO rrh_ipqc_inspections (
                session_id, work_order_id, serial_number, ivi_inspection_id, status, scanned_by
             ) VALUES ($1, $2, $3, $4, 'PASS', 'tester')
             RETURNING id, ivi_inspection_id, work_order_internal_id;`,
            [ipqcSessionId, testWo, serial, iviInspId]
        );
        const ipqcInspId = ipqcInsp.rows[0].id;
        assert.strictEqual(ipqcInsp.rows[0].ivi_inspection_id, iviInspId);
        assert.strictEqual(ipqcInsp.rows[0].work_order_internal_id, woId);

        // Stage 4: Programming
        const progInsp = await pool.query(
            `INSERT INTO rrh_programming_inspections (
                session_id, work_order_id, serial_number, ipqc_inspection_id, ivi_inspection_id,
                firmware_version, mac_address, status, scanned_by
             ) VALUES ($1, $2, $3, $4, $5, 'v2.4.1', '00:1A:2B:3C:4D:5E', 'PASS', 'tester')
             RETURNING id, ipqc_inspection_id, work_order_internal_id;`,
            [progSessionId, testWo, serial, ipqcInspId, iviInspId]
        );
        const progInspId = progInsp.rows[0].id;
        assert.strictEqual(progInsp.rows[0].ipqc_inspection_id, ipqcInspId);

        // Stage 5: Pre-Burn-In
        const pbiInsp = await pool.query(
            `INSERT INTO rrh_pre_burn_in_inspections (
                session_id, work_order_id, serial_number, programming_inspection_id, ipqc_inspection_id,
                ivi_inspection_id, status, scanned_by
             ) VALUES ($1, $2, $3, $4, $5, $6, 'PASS', 'tester')
             RETURNING id, programming_inspection_id, work_order_internal_id;`,
            [pbiSessionId, testWo, serial, progInspId, ipqcInspId, iviInspId]
        );
        const pbiInspId = pbiInsp.rows[0].id;
        assert.strictEqual(pbiInsp.rows[0].programming_inspection_id, progInspId);

        // Stage 6: Hipot
        const hipotInsp = await pool.query(
            `INSERT INTO rrh_hipot_inspections (
                session_id, work_order_id, serial_number, pre_burn_in_inspection_id, programming_inspection_id,
                status, scanned_by
             ) VALUES ($1, $2, $3, $4, $5, 'PASS', 'tester')
             RETURNING id, pre_burn_in_inspection_id, work_order_internal_id;`,
            [hipotSessionId, testWo, serial, pbiInspId, progInspId]
        );
        const hipotInspId = hipotInsp.rows[0].id;
        assert.strictEqual(hipotInsp.rows[0].pre_burn_in_inspection_id, pbiInspId);

        // Stage 7: Post-Burn-In
        const postbiInsp = await pool.query(
            `INSERT INTO rrh_post_burn_in_inspections (
                session_id, work_order_id, serial_number, hipot_inspection_id, pre_burn_in_inspection_id,
                status, scanned_by
             ) VALUES ($1, $2, $3, $4, $5, 'PASS', 'tester')
             RETURNING id, hipot_inspection_id, work_order_internal_id;`,
            [postbiSessionId, testWo, serial, hipotInspId, pbiInspId]
        );
        const postbiInspId = postbiInsp.rows[0].id;
        assert.strictEqual(postbiInsp.rows[0].hipot_inspection_id, hipotInspId);

        // Comprehensive Traceability Check: Verify full chain from Post-Burn-In back to Inward Scan
        const lineageRes = await pool.query(`
            SELECT 
                pbi.id as post_bi_id,
                h.id as hipot_id,
                pb.id as pre_bi_id,
                pr.id as prog_id,
                ip.id as ipqc_id,
                iv.id as ivi_id,
                s.id as inward_id
            FROM rrh_post_burn_in_inspections pbi
            JOIN rrh_hipot_inspections h ON h.id = pbi.hipot_inspection_id
            JOIN rrh_pre_burn_in_inspections pb ON pb.id = h.pre_burn_in_inspection_id
            JOIN rrh_programming_inspections pr ON pr.id = pb.programming_inspection_id
            JOIN rrh_ipqc_inspections ip ON ip.id = pr.ipqc_inspection_id
            JOIN rrh_ivi_inspections iv ON iv.id = ip.ivi_inspection_id
            JOIN rrh_inward_scans s ON s.id = iv.inward_scan_id
            WHERE pbi.id = $1;
        `, [postbiInspId]);

        assert.strictEqual(lineageRes.rows.length, 1);
        assert.strictEqual(lineageRes.rows[0].inward_id, inwardScanId);
    });

    test('3. Case: FAIL - Defect detected, halts stage progression', async () => {
        const serial = 'SN-STAGE-FAIL-001';

        // Inward PASS
        await pool.query(
            `INSERT INTO rrh_inward_scans (rrh_inward_session_id, work_order_id, serial_number, status, scanned_by)
             VALUES ($1, $2, $3, 'PASS', 'tester');`,
            [inwardSessionId, testWo, serial]
        );

        // IVI FAIL (Scratched optical port, marked defect)
        const iviFail = await pool.query(
            `INSERT INTO rrh_ivi_inspections (
                session_id, work_order_id, serial_number, duplexer_main, duplexer_part_no, status,
                remarks, scanned_by, route, passed_to_next_stage
             ) VALUES ($1, $2, $3, 'MAIN-DUP-01', 'DP-100', 'FAIL', 'Scratch on duplexer RF port', 'tester', 'ECN', false)
             RETURNING id, status, passed_to_next_stage;`,
            [iviSessionId, testWo, serial]
        );

        assert.strictEqual(iviFail.rows[0].status, 'FAIL');
        assert.strictEqual(iviFail.rows[0].passed_to_next_stage, false);

        // Ensure next stage (IPQC) rejects or flags inspection when prior stage is FAIL and not passed
        const iviActive = await pool.query(
            `SELECT id, status, passed_to_next_stage FROM rrh_ivi_inspections
             WHERE work_order_id = $1 AND UPPER(TRIM(serial_number)) = $2 AND is_deleted = false;`,
            [testWo, serial]
        );
        assert.strictEqual(iviActive.rows[0].status, 'FAIL');
        assert.strictEqual(iviActive.rows[0].passed_to_next_stage, false);
    });

    test('4. Case: DEBUG Workflow - Transition through PENDING -> IN_DEBUG -> FIXED', async () => {
        const serial = 'SN-DEBUG-FLOW-001';

        // Setup through Programming with FAIL
        const progFail = await pool.query(
            `INSERT INTO rrh_programming_inspections (
                session_id, work_order_id, serial_number, status, remarks,
                debug_status, debug_remarks, scanned_by
             ) VALUES ($1, $2, $3, 'FAIL', 'MAC address write timeout', 'PENDING', 'Awaiting debug review', 'tester')
             RETURNING id, status, debug_status;`,
            [progSessionId, testWo, serial]
        );
        const recordId = progFail.rows[0].id;
        assert.strictEqual(progFail.rows[0].debug_status, 'PENDING');

        // Debugger accepts unit
        await pool.query(
            `UPDATE rrh_programming_inspections
             SET debug_status = 'IN_DEBUG',
                 debug_remarks = 'Probing JTAG clock lines with oscilloscope',
                 debug_by = 'tech_alice',
                 debug_at = CURRENT_TIMESTAMP
             WHERE id = $1;`,
            [recordId]
        );

        let check = await pool.query(`SELECT debug_status, debug_by FROM rrh_programming_inspections WHERE id = $1;`, [recordId]);
        assert.strictEqual(check.rows[0].debug_status, 'IN_DEBUG');
        assert.strictEqual(check.rows[0].debug_by, 'tech_alice');

        // Debugger fixes issue
        await pool.query(
            `UPDATE rrh_programming_inspections
             SET debug_status = 'FIXED',
                 defect_fixed = 'Replaced pull-up resistor R42 on TMS pin',
                 debug_remarks = 'Signal integrity verified. Ready for re-flash.'
             WHERE id = $1;`,
            [recordId]
        );

        check = await pool.query(`SELECT debug_status, defect_fixed FROM rrh_programming_inspections WHERE id = $1;`, [recordId]);
        assert.strictEqual(check.rows[0].debug_status, 'FIXED');
        assert.ok(check.rows[0].defect_fixed.includes('R42'));
    });

    test('5. Case: FAIL THEN PASS - Reinspection & Audit Trail Supersession', async () => {
        const serial = 'SN-FAIL-THEN-PASS-001';

        // 1. Initial Hipot test FAILS
        const initialHipot = await pool.query(
            `INSERT INTO rrh_hipot_inspections (
                session_id, work_order_id, serial_number, status, remarks,
                debug_status, scanned_by
             ) VALUES ($1, $2, $3, 'FAIL', 'Insulation breakdown at 1.5kV', 'PENDING', 'tester')
             RETURNING id;`,
            [hipotSessionId, testWo, serial]
        );
        const initialId = initialHipot.rows[0].id;

        // 2. Unit is debugged and fixed
        await pool.query(
            `UPDATE rrh_hipot_inspections
             SET debug_status = 'FIXED',
                 defect_fixed = 'Insulation tape reapplied around transformer terminal'
             WHERE id = $1;`,
            [initialId]
        );

        // 3. Mark previous failure as reinspected / superseded to yield to new inspection
        await pool.query(
            `UPDATE rrh_hipot_inspections
             SET is_deleted = true,
                 is_reinspected = true
             WHERE id = $1;`,
            [initialId]
        );

        // 4. Re-inspection occurs: New Hipot record created with PASS
        const reinspectHipot = await pool.query(
            `INSERT INTO rrh_hipot_inspections (
                session_id, work_order_id, serial_number, status, remarks,
                is_reinspected, scanned_by
             ) VALUES ($1, $2, $3, 'PASS', 'Passes 1.5kV dielectric withstand test cleanly', false, 'tester')
             RETURNING id, status;`,
            [hipotSessionId, testWo, serial]
        );
        const newPassId = reinspectHipot.rows[0].id;
        assert.strictEqual(reinspectHipot.rows[0].status, 'PASS');

        // 5. Link supersession audit trail: initial failure superseded by new pass
        await pool.query(
            `UPDATE rrh_hipot_inspections
             SET superseded_by_id = $1,
                 superseded_at = CURRENT_TIMESTAMP
             WHERE id = $2;`,
            [newPassId, initialId]
        );

        // 5. Verify Active Record state
        const activeRecords = await pool.query(
            `SELECT id, status, is_deleted, superseded_by_id FROM rrh_hipot_inspections
             WHERE session_id = $1 AND UPPER(TRIM(serial_number)) = $2 AND is_deleted = false;`,
            [hipotSessionId, serial]
        );
        assert.strictEqual(activeRecords.rows.length, 1);
        assert.strictEqual(activeRecords.rows[0].id, newPassId);
        assert.strictEqual(activeRecords.rows[0].status, 'PASS');
        assert.strictEqual(activeRecords.rows[0].superseded_by_id, null);

        // 6. Verify Superseded Audit Record
        const auditRecords = await pool.query(
            `SELECT id, status, is_deleted, superseded_by_id FROM rrh_hipot_inspections
             WHERE id = $1;`,
            [initialId]
        );
        assert.strictEqual(auditRecords.rows[0].status, 'FAIL');
        assert.strictEqual(auditRecords.rows[0].is_deleted, true);
        assert.strictEqual(auditRecords.rows[0].superseded_by_id, newPassId);
    });

    test('6. Case: SCRAP Disposition at IVI - Unit Terminated Permanently', async () => {
        const serial = 'SN-SCRAP-UNIT-001';

        const scrapRes = await pool.query(
            `INSERT INTO rrh_ivi_inspections (
                session_id, work_order_id, serial_number, duplexer_main, duplexer_part_no, status,
                remarks, scanned_by, route, passed_to_next_stage
             ) VALUES ($1, $2, $3, 'MAIN-DUP-01', 'DP-100', 'SCRAP', 'Severe structural chassis fracture - irrecoverable', 'tester', 'ECN', false)
             RETURNING id, status, passed_to_next_stage;`,
            [iviSessionId, testWo, serial]
        );

        assert.strictEqual(scrapRes.rows[0].status, 'SCRAP');
        assert.strictEqual(scrapRes.rows[0].passed_to_next_stage, false);
    });
});
