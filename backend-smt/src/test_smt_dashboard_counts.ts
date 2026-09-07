import pool from './config/db';
import { calculateSmtStageMetrics } from './controllers/adminDashboardController';
import { dashboardEvents, notifySmtDashboardUpdate } from './utils/dashboardEmitter';

async function runTests() {
    console.log('=== SMT DASHBOARD METRICS AUTOMATED VERIFICATION ===\n');

    const testWoId = 'WO_TEST_DASHBOARD_' + Date.now();
    const testQty = 10;
    let passedTests = 0;
    let totalTests = 0;

    const assert = (condition: boolean, testName: string, detail?: string) => {
        totalTests++;
        if (condition) {
            console.log(`✅ [PASS] ${testName}`);
            passedTests++;
        } else {
            console.error(`❌ [FAIL] ${testName}${detail ? ` - Detail: ${detail}` : ''}`);
        }
    };

    try {
        // 1. Create a clean test work order
        await pool.query(
            `INSERT INTO smt_work_orders (id, area_id, line_id, priority, product_name, model_name, quantity, panel_quantity, sides, status)
             VALUES ($1, 'SMT', 'SMT-1', 'Medium', 'Test Product', 'Test Model', $2, 5, 'Top / Bottom', 'In Progress')`,
            [testWoId, testQty]
        );

        // 2. Generate 10 test serial numbers
        const serialIds: number[] = [];
        for (let i = 1; i <= 10; i++) {
            const snStr = `${testWoId}-SN-${String(i).padStart(3, '0')}`;
            const snRes = await pool.query(
                `INSERT INTO smt_serial_numbers (work_order_id, serial_format, serial_number, status)
                 VALUES ($1, 'STANDARD', $2, 'Generated') RETURNING id`,
                [testWoId, snStr]
            );
            serialIds.push(snRes.rows[0].id);
        }

        // Test 1: Initial Empty Stage Metrics
        const initialMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, null);
        assert(
            initialMetrics.printing.passed === 0 &&
            initialMetrics.printing.failed === 0 &&
            initialMetrics.printing.pending === 10 &&
            initialMetrics.printing.percentage === 0,
            'Test 1: Initial state has 0 Pass, 0 Fail, 10 Pending, 0% Yield'
        );

        // Test 2: Valid PASS on Printing
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Printing', 'TestOp', 'PASS', $2, 'BARCODE-1', NOW() - INTERVAL '10 minutes')`,
            [serialIds[0], testWoId]
        );
        const passMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, null);
        assert(
            passMetrics.printing.passed === 1 &&
            passMetrics.printing.failed === 0 &&
            passMetrics.printing.pending === 9 &&
            passMetrics.printing.percentage === 10,
            'Test 2: Valid PASS -> Pass=1, Pending=9, Fail=0, Yield=10%'
        );

        // Test 3: Genuine FAIL on Printing
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Printing', 'TestOp', 'FAIL', $2, 'BARCODE-2', NOW() - INTERVAL '8 minutes')`,
            [serialIds[1], testWoId]
        );
        const failMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, null);
        assert(
            failMetrics.printing.passed === 1 &&
            failMetrics.printing.failed === 1 &&
            failMetrics.printing.pending === 8 &&
            failMetrics.printing.percentage === 10,
            'Test 3: Genuine FAIL -> Fail=1, Pending=8, Pass=1, Yield=10%'
        );

        // Test 4: Invalid Scans Excluded (INVALID and REJECTED states do NOT increment Fail)
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES (NULL, 'Printing', 'TestOp', 'INVALID', $1, 'INVALID_BARCODE_XYZ', NOW() - INTERVAL '6 minutes')`,
            [testWoId]
        );
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES (NULL, 'Printing', 'TestOp', 'REJECTED', $1, 'REJECTED_BARCODE_ABC', NOW() - INTERVAL '5 minutes')`,
            [testWoId]
        );
        const invalidMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, null);
        assert(
            invalidMetrics.printing.passed === 1 &&
            invalidMetrics.printing.failed === 1 &&
            invalidMetrics.printing.pending === 8 &&
            invalidMetrics.printing.percentage === 10,
            'Test 4: Invalid/Rejected scans NEVER increment Fail or alter Pending/Yield'
        );

        // Test 5: FAIL -> PASS (Repair/Rework)
        // Unit 2 previously failed. Now it is repaired and scanned as PASS at a later timestamp.
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Printing', 'TestOp', 'PASS', $2, 'BARCODE-2', NOW() - INTERVAL '3 minutes')`,
            [serialIds[1], testWoId]
        );
        const repairedMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, null);
        assert(
            repairedMetrics.printing.passed === 2 &&
            repairedMetrics.printing.failed === 0 &&
            repairedMetrics.printing.pending === 8 &&
            repairedMetrics.printing.percentage === 20,
            'Test 5: FAIL -> PASS transitions unit: Fail=0, Pass=2, Pending=8, unit not double-counted'
        );

        // Test 6: Historical Double-Count Prevention
        // Unit 3 has multiple historical scans: FAIL, then FAIL again, then PASS
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Printing', 'TestOp', 'FAIL', $2, 'BARCODE-3', NOW() - INTERVAL '20 minutes')`,
            [serialIds[2], testWoId]
        );
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Printing', 'TestOp', 'FAIL', $2, 'BARCODE-3', NOW() - INTERVAL '15 minutes')`,
            [serialIds[2], testWoId]
        );
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Printing', 'TestOp', 'PASS', $2, 'BARCODE-3', NOW() - INTERVAL '2 minutes')`,
            [serialIds[2], testWoId]
        );
        const multiScanMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, null);
        assert(
            multiScanMetrics.printing.passed === 3 &&
            multiScanMetrics.printing.failed === 0 &&
            multiScanMetrics.printing.pending === 7 &&
            multiScanMetrics.printing.percentage === 30,
            'Test 6: Historical scans (FAIL, FAIL, PASS) evaluated strictly by latest state (PASS)'
        );

        // Test 7: Stage Isolation (Printing does not alter Pre AOI, Post AOI, SMT FG)
        assert(
            multiScanMetrics.preAOI.passed === 0 &&
            multiScanMetrics.preAOI.failed === 0 &&
            multiScanMetrics.preAOI.pending === 10 &&
            multiScanMetrics.postAOI.passed === 0 &&
            multiScanMetrics.postAOI.failed === 0 &&
            multiScanMetrics.postAOI.pending === 10 &&
            multiScanMetrics.smtFG.passed === 0 &&
            multiScanMetrics.smtFG.failed === 0 &&
            multiScanMetrics.smtFG.pending === 10,
            'Test 7: Stage Isolation: Printing scans do not affect Pre AOI, Post AOI, or SMT FG'
        );

        // Test 8: All Four SMT Stages Independent Verification
        // Add Pre AOI PASS
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Pre AOI', 'TestOp', 'PASS', $2, 'BARCODE-1', NOW())`,
            [serialIds[0], testWoId]
        );
        // Add Pre AOI FAIL
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Pre AOI', 'TestOp', 'FAIL', $2, 'BARCODE-4', NOW())`,
            [serialIds[3], testWoId]
        );
        // Add Post AOI PASS
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'Post AOI', 'TestOp', 'PASS', $2, 'BARCODE-1', NOW())`,
            [serialIds[0], testWoId]
        );
        // Add SMT FG PASS
        await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, work_order_id, scanned_barcode, scanned_at)
             VALUES ($1, 'SMT FG', 'TestOp', 'PASS', $2, 'BARCODE-1', NOW())`,
            [serialIds[0], testWoId]
        );

        const allStagesMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, null);
        assert(
            allStagesMetrics.printing.passed === 3 && allStagesMetrics.printing.failed === 0 &&
            allStagesMetrics.preAOI.passed === 1 && allStagesMetrics.preAOI.failed === 1 && allStagesMetrics.preAOI.pending === 8 &&
            allStagesMetrics.postAOI.passed === 1 && allStagesMetrics.postAOI.failed === 0 && allStagesMetrics.postAOI.pending === 9 &&
            allStagesMetrics.smtFG.passed === 1 && allStagesMetrics.smtFG.failed === 0 && allStagesMetrics.smtFG.pending === 9,
            'Test 8: All four SMT stages independently report correct Pass, Fail, Pending, and Yield'
        );

        // Test 9: Real-time Event Emitter Verification
        let receivedEvent: any = null;
        const testHandler = (data: any) => {
            receivedEvent = data;
        };
        dashboardEvents.on('smt-dashboard-update', testHandler);
        notifySmtDashboardUpdate(testWoId);
        dashboardEvents.off('smt-dashboard-update', testHandler);

        assert(
            receivedEvent !== null &&
            receivedEvent.event === 'SMT_DASHBOARD_UPDATE' &&
            receivedEvent.data?.workOrderId === testWoId,
            'Test 9: Real-time update event emitted and payload matches affected Work Order ID'
        );

        // Test 10: Date Filtering Verification
        const todayStr = new Date().toISOString().split('T')[0];
        const todayMetrics = await calculateSmtStageMetrics(pool, testWoId, testQty, todayStr);
        assert(
            todayMetrics.printing.passed === 3 &&
            todayMetrics.preAOI.passed === 1 &&
            todayMetrics.postAOI.passed === 1 &&
            todayMetrics.smtFG.passed === 1,
            'Test 10: Date filtering preserves accurate daily metrics without corrupting state'
        );

    } catch (err: any) {
        console.error('Unexpected error during automated test:', err);
    } finally {
        // Cleanup: remove all test data created during test
        try {
            await pool.query('DELETE FROM smt_inspections WHERE work_order_id = $1', [testWoId]);
            await pool.query('DELETE FROM smt_serial_numbers WHERE work_order_id = $1', [testWoId]);
            await pool.query('DELETE FROM smt_work_orders WHERE id = $1', [testWoId]);
            console.log('\n🧹 Test cleanup completed: temporary test data purged.');
        } catch (cleanupErr: any) {
            console.error('Error cleaning up test data:', cleanupErr);
        }
    }

    console.log(`\n========================================`);
    console.log(`Test Summary: ${passedTests} / ${totalTests} Passed`);
    console.log(`========================================\n`);

    if (passedTests === totalTests) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests();
