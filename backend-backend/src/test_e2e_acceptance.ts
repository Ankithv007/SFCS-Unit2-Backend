import pool from './config/db';
import { WorkflowEngineService } from './services/workflow/WorkflowEngineService';
import { ScanProcessingService } from './services/scans/ScanProcessingService';
import { BatchManagementService } from './services/batches/BatchManagementService';

async function runAcceptanceTest() {
    console.log('=== RUNNING SECTION 28 FINAL ACCEPTANCE TEST ===\n');
    let passed = 0;
    let failed = 0;

    function assert(cond: boolean, name: string, detail?: string) {
        if (cond) {
            console.log(`✅ [PASS] ${name}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${name}${detail ? ' - ' + detail : ''}`);
            failed++;
        }
    }

    try {
        const woNumber = 'WO-ACCEPT-28';
        const barcode = 'BAR-ACCEPT-28-001';

        // 1. Cleanup any previous run
        await pool.query("DELETE FROM rework_sessions WHERE barcode = $1", [barcode]);
        await pool.query("DELETE FROM debug_sessions WHERE barcode = $1", [barcode]);
        await pool.query("DELETE FROM unit_serial_mapping WHERE barcode = $1", [barcode]);
        await pool.query("DELETE FROM scans WHERE barcode = $1", [barcode]);
        await pool.query("DELETE FROM units WHERE barcode = $1", [barcode]);
        await pool.query('DELETE FROM scans WHERE batch_id IN (SELECT id FROM batches WHERE batch_number = $1)', [woNumber]);
        await pool.query('DELETE FROM units WHERE batch_id IN (SELECT id FROM batches WHERE batch_number = $1)', [woNumber]);
        await pool.query('DELETE FROM batch_stage_progress WHERE batch_id IN (SELECT id FROM batches WHERE batch_number = $1)', [woNumber]);
        await pool.query('DELETE FROM batches WHERE batch_number = $1', [woNumber]);
        await pool.query('DELETE FROM work_orders WHERE wo_number = $1', [woNumber]);

        // 2. Create new Work Order with selected_stages = ["PTH", "QA"]
        console.log('Step 1: Creating Work Order with selected_stages = ["PTH", "QA"]...');
        const woInsert = await pool.query(
            `INSERT INTO work_orders (wo_number, quantity, customer_name, model, created_by, selected_stages)
             VALUES ($1, 5, 'Acceptance Customer', 'Model-28', 'acceptance_runner', $2::jsonb)
             RETURNING id, wo_number, selected_stages`,
            [woNumber, JSON.stringify(['PTH', 'QA'])]
        );
        const wo = woInsert.rows[0];
        assert(wo && wo.id > 0, 'Work Order created in database');
        assert(Array.isArray(wo.selected_stages) && wo.selected_stages.length === 2, 'Work Order has selected_stages = ["PTH", "QA"]');

        // 3. Resolve active route
        const activeRoute = await WorkflowEngineService.resolveActiveRoute({ workOrderId: wo.id });
        assert(activeRoute.length === 2, 'Active route contains exactly 2 stages');
        assert(activeRoute[0].stage_code === 'PTH', 'First stage in active route is PTH');
        assert(activeRoute[1].stage_code === 'QA', 'Final stage in active route is QA');

        // 4. Batch creation
        const firstStageId = activeRoute[0].id;
        const batchId = await BatchManagementService.getOrCreateBatch(
            woNumber,
            wo.id,
            firstStageId,
            'acceptance_runner'
        );
        assert(typeof batchId === 'number' && batchId > 0, 'Batch created for Work Order');

        // 5. Check Batch Visibility:
        // Batch visible in PTH
        const pthBatches = await BatchManagementService.getBatchesByStage('PTH', 50, 0);
        const visibleInPTH = pthBatches.data.some((b: any) => b.wo_number === woNumber);
        assert(visibleInPTH, 'Batch visible in PTH');

        // Batch NOT visible in VI
        const viBatches = await BatchManagementService.getBatchesByStage('VI', 50, 0);
        const visibleInVI = viBatches.data.some((b: any) => b.wo_number === woNumber);
        assert(!visibleInVI, 'Batch NOT visible in VI');

        // Batch visible in QA
        const qaBatches = await BatchManagementService.getBatchesByStage('QA', 50, 0);
        const visibleInQA = qaBatches.data.some((b: any) => b.wo_number === woNumber);
        assert(visibleInQA, 'Batch visible in QA');

        // Batch NOT visible in Packing
        const packBatches = await BatchManagementService.getBatchesByStage('PACKING', 50, 0);
        const visibleInPack = packBatches.data.some((b: any) => b.wo_number === woNumber);
        assert(!visibleInPack, 'Batch NOT visible in Packing');

        // 6. Scan PTH (First Stage)
        console.log('Step 2: Scanning barcode at PTH...');
        const pthScan = await ScanProcessingService.processStageScan('PTH', {
            work_order_id: wo.id,
            batch_id: batchId!,
            barcode,
            status: 'ACCEPTED',
            scanned_by: 'tester'
        });
        assert(pthScan.success, 'PTH scan SUCCESS', pthScan.message);

        // Check unit state after PTH
        const unitAfterPTH = await pool.query('SELECT current_status, current_stage_id FROM units WHERE barcode = $1', [barcode]);
        assert(unitAfterPTH.rows.length === 1, 'Unit record created in units table');
        assert(unitAfterPTH.rows[0].current_status === 'ACCEPTED', 'Unit status is ACCEPTED after PTH');
        assert(unitAfterPTH.rows[0].current_stage_id === activeRoute[0].id, 'Unit current_stage_id is PTH');

        // 7. Verify attempting scan at skipped stage VI returns STAGE_NOT_IN_ROUTING
        console.log('Step 3: Attempting scan at VI (deselected stage)...');
        let viRejectedCorrectly = false;
        let viErrorMsg = '';
        let viErrorCode = '';
        try {
            await ScanProcessingService.processStageScan('VI', {
                work_order_id: wo.id,
                batch_id: batchId!,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
        } catch (err: any) {
            viRejectedCorrectly = true;
            viErrorMsg = err.message || '';
            viErrorCode = err.code || '';
        }
        assert(
            viRejectedCorrectly && (viErrorCode === 'STAGE_NOT_IN_ROUTING' || viErrorMsg.includes('not part of this Work Order\'s process routing')),
            'Scan at VI rejected with STAGE_NOT_IN_ROUTING (not Record Not Found)',
            viErrorMsg
        );

        // 8. Scan QA (Final Stage)
        console.log('Step 4: Scanning barcode at QA...');
        const qaScan = await ScanProcessingService.processStageScan('QA', {
            work_order_id: wo.id,
            batch_id: batchId!,
            barcode,
            status: 'ACCEPTED',
            scanned_by: 'tester'
        });
        assert(qaScan.success, 'QA scan SUCCESS', qaScan.message);

        // 9. Verify unit is COMPLETED
        const unitAfterQA = await pool.query('SELECT current_status, current_stage_id FROM units WHERE barcode = $1', [barcode]);
        assert(unitAfterQA.rows.length === 1, 'Unit record exists after QA scan');
        assert(unitAfterQA.rows[0].current_status === 'COMPLETED', `Unit status transitioned to COMPLETED (got: ${unitAfterQA.rows[0]?.current_status})`);
        assert(unitAfterQA.rows[0].current_stage_id === activeRoute[1].id, 'Unit current_stage_id is QA');

        // 10. Check Tracking
        console.log('Step 5: Verifying unit and WO tracking...');
        const scansRes = await pool.query(
            `SELECT s.stage_id, ps.stage_code, s.scan_result
             FROM scans s
             JOIN production_stages ps ON ps.id = s.stage_id
             WHERE s.barcode = $1
             ORDER BY s.id ASC`,
            [barcode]
        );
        assert(scansRes.rows.length === 2, `Scans table recorded 2 scans (got ${scansRes.rows.length})`);
        assert(scansRes.rows[0].stage_code === 'PTH', 'First scan stage was PTH');
        assert(scansRes.rows[1].stage_code === 'QA', 'Second scan stage was QA');

        // 11. Test Work Order retrieval
        const woById = await pool.query('SELECT * FROM work_orders WHERE id = $1', [wo.id]);
        assert(woById.rows.length === 1 && woById.rows[0].wo_number === woNumber, 'Work Order detail query by ID succeeds');
        const woByNum = await pool.query('SELECT * FROM work_orders WHERE wo_number = $1', [woNumber]);
        assert(woByNum.rows.length === 1 && woByNum.rows[0].id === wo.id, 'Work Order detail query by wo_number succeeds');

        console.log('\n=== SECTION 28 FINAL ACCEPTANCE TEST FINISHED ===');
        console.log(`Passed: ${passed}`);
        console.log(`Failed: ${failed}`);

        if (failed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } catch (err: any) {
        console.error('Fatal error in acceptance test:', err);
        process.exit(1);
    }
}

runAcceptanceTest();
