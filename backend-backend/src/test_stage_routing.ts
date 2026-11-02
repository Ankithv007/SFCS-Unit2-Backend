import pool from './config/db';
import { WorkflowEngineService } from './services/workflow/WorkflowEngineService';
import { ScanProcessingService } from './services/scans/ScanProcessingService';
import { BatchManagementService } from './services/batches/BatchManagementService';

async function runTests() {
    console.log('=== STARTING WORK ORDER DYNAMIC ROUTING AUTOMATED TEST SUITE ===\n');
    let passedCount = 0;
    let failedCount = 0;

    function assert(condition: boolean, testName: string, detail?: string) {
        if (condition) {
            console.log(`✅ [PASS] ${testName}`);
            passedCount++;
        } else {
            console.error(`❌ [FAIL] ${testName}${detail ? ' - ' + detail : ''}`);
            failedCount++;
        }
    }

    try {
        // Ensure production_stages exist
        const stagesRes = await pool.query('SELECT * FROM production_stages ORDER BY stage_order ASC');
        console.log(`Found ${stagesRes.rows.length} production stages.`);

        // Helper to query unit status
        async function getUnitStatus(barcode: string) {
            const res = await pool.query('SELECT current_status, current_stage_id FROM units WHERE barcode = $1', [barcode]);
            return res.rows.length > 0 ? res.rows[0] : null;
        }

        // Helper to create a test Work Order and Batch
        async function createTestWO(woNumber: string, selectedStages: any) {
            await pool.query("DELETE FROM rework_sessions WHERE barcode LIKE 'BAR-%'");
            await pool.query("DELETE FROM debug_sessions WHERE barcode LIKE 'BAR-%'");
            await pool.query("DELETE FROM unit_serial_mapping WHERE barcode LIKE 'BAR-%'");
            await pool.query("DELETE FROM scans WHERE barcode LIKE 'BAR-%'");
            await pool.query("DELETE FROM units WHERE barcode LIKE 'BAR-%'");
            await pool.query('DELETE FROM scans WHERE batch_id IN (SELECT id FROM batches WHERE batch_number = $1)', [woNumber]);
            await pool.query('DELETE FROM units WHERE batch_id IN (SELECT id FROM batches WHERE batch_number = $1)', [woNumber]);
            await pool.query('DELETE FROM batch_stage_progress WHERE batch_id IN (SELECT id FROM batches WHERE batch_number = $1)', [woNumber]);
            await pool.query('DELETE FROM batches WHERE batch_number = $1', [woNumber]);
            await pool.query('DELETE FROM work_orders WHERE wo_number = $1', [woNumber]);

            const stagesJson = selectedStages !== null ? JSON.stringify(selectedStages) : null;
            const woRes = await pool.query(
                `INSERT INTO work_orders (wo_number, quantity, customer_name, model, created_by, selected_stages)
                 VALUES ($1, 10, 'Test Customer', 'Model-X', 'test_runner', $2::jsonb)
                 RETURNING id, wo_number, selected_stages`,
                [woNumber, stagesJson]
            );
            const wo = woRes.rows[0];

            const activeRoute = await WorkflowEngineService.resolveActiveRoute({ workOrderId: wo.id });
            const firstStageId = activeRoute.length > 0 ? activeRoute[0].id : 1;

            const batchId = await BatchManagementService.getOrCreateBatch(
                woNumber,
                wo.id,
                firstStageId,
                'test_runner'
            );

            return { wo, batchId: batchId!, activeRoute };
        }

        // =========================================================================
        // Test A: All stages in standard order
        // Route: PTH -> VI -> QA -> FLASHING -> PACKING
        // =========================================================================
        console.log('\n--- Running Test A: All Stages Route ---');
        {
            const { wo, batchId, activeRoute } = await createTestWO('WO-TEST-A', [
                'PTH', 'VI', 'QA', 'FLASHING', 'PACKING'
            ]);
            assert(activeRoute.length === 5, 'Test A: Route resolved to 5 stages');
            assert(activeRoute[0].stage_code === 'PTH', 'Test A: First stage is PTH');
            assert(activeRoute[4].stage_code === 'PACKING', 'Test A: Last stage is PACKING');

            const barcode = 'BAR-A-001';
            // Step 1: PTH scan
            const resPTH = await ScanProcessingService.processStageScan('PTH', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            let unit = await getUnitStatus(barcode);
            assert(resPTH.success && unit?.current_status === 'ACCEPTED', 'Test A: PTH scan SUCCESS');

            // Step 2: VI scan
            const resVI = await ScanProcessingService.processStageScan('VI', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resVI.success && unit?.current_status === 'ACCEPTED', 'Test A: VI scan SUCCESS');

            // Step 3: QA scan
            const resQA = await ScanProcessingService.processStageScan('QA', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resQA.success && unit?.current_status === 'ACCEPTED', 'Test A: QA scan SUCCESS');

            // Step 4: FLASHING scan
            const resFL = await ScanProcessingService.processStageScan('FLASHING', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resFL.success && unit?.current_status === 'ACCEPTED', 'Test A: FLASHING scan SUCCESS');

            // Step 5: PACKING scan (Final stage)
            const resPK = await ScanProcessingService.processStageScan('PACKING', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resPK.success && unit?.current_status === 'COMPLETED', 'Test A: PACKING scan COMPLETED unit');
        }

        // =========================================================================
        // Test B: Skip VI and Flashing (PTH -> QA -> PACKING)
        // Deselected stages must return STAGE_NOT_IN_ROUTING, direct PTH -> QA must work
        // =========================================================================
        console.log('\n--- Running Test B: Skip VI and Flashing ---');
        {
            const { wo, batchId, activeRoute } = await createTestWO('WO-TEST-B', [
                'PTH', 'QA', 'PACKING'
            ]);
            assert(activeRoute.length === 3, 'Test B: Route resolved to 3 stages');
            assert(activeRoute[0].stage_code === 'PTH', 'Test B: First stage is PTH');
            assert(activeRoute[1].stage_code === 'QA', 'Test B: Next stage after PTH is QA');
            assert(activeRoute[2].stage_code === 'PACKING', 'Test B: Last stage is PACKING');

            const barcode = 'BAR-B-001';

            // Step 1: PTH scan
            const resPTH = await ScanProcessingService.processStageScan('PTH', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            let unit = await getUnitStatus(barcode);
            assert(resPTH.success && unit?.current_status === 'ACCEPTED', 'Test B: PTH scan SUCCESS');

            // Step 2: VI scan (Deselected) -> STAGE_NOT_IN_ROUTING
            let viFailedAsExpected = false;
            try {
                await ScanProcessingService.processStageScan('VI', {
                    work_order_id: wo.id,
                    batch_id: batchId,
                    barcode,
                    status: 'ACCEPTED',
                    scanned_by: 'tester'
                });
            } catch (err: any) {
                if (err.errorCode === 'STAGE_NOT_IN_ROUTING') viFailedAsExpected = true;
            }
            assert(viFailedAsExpected, 'Test B: VI scan rejected with STAGE_NOT_IN_ROUTING');

            // Step 3: Flashing scan (Deselected) -> STAGE_NOT_IN_ROUTING
            let flFailedAsExpected = false;
            try {
                await ScanProcessingService.processStageScan('FLASHING', {
                    work_order_id: wo.id,
                    batch_id: batchId,
                    barcode,
                    status: 'ACCEPTED',
                    scanned_by: 'tester'
                });
            } catch (err: any) {
                if (err.errorCode === 'STAGE_NOT_IN_ROUTING') flFailedAsExpected = true;
            }
            assert(flFailedAsExpected, 'Test B: FLASHING scan rejected with STAGE_NOT_IN_ROUTING');

            // Step 4: QA scan (Direct transition from PTH -> QA!)
            const resQA = await ScanProcessingService.processStageScan('QA', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resQA.success && unit?.current_status === 'ACCEPTED', 'Test B: Direct PTH -> QA transition SUCCESS');

            // Step 5: PACKING scan (Final stage)
            const resPK = await ScanProcessingService.processStageScan('PACKING', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resPK.success && unit?.current_status === 'COMPLETED', 'Test B: PACKING scan COMPLETED unit');
        }

        // =========================================================================
        // Test C: PTH Deselected (VI -> QA -> PACKING)
        // PTH scan -> STAGE_NOT_IN_ROUTING
        // QA first scan -> INVALID_STAGE (Expected first stage is VI)
        // VI first scan -> SUCCESS
        // =========================================================================
        console.log('\n--- Running Test C: PTH Deselected (VI as first stage) ---');
        {
            const { wo, batchId, activeRoute } = await createTestWO('WO-TEST-C', [
                'VI', 'QA', 'PACKING'
            ]);
            assert(activeRoute[0].stage_code === 'VI', 'Test C: First stage is dynamically VI (stage_order > 1)');

            const barcode = 'BAR-C-001';

            // PTH scan -> STAGE_NOT_IN_ROUTING
            let pthFailed = false;
            try {
                await ScanProcessingService.processStageScan('PTH', {
                    work_order_id: wo.id,
                    batch_id: batchId,
                    barcode,
                    status: 'ACCEPTED',
                    scanned_by: 'tester'
                });
            } catch (err: any) {
                if (err.errorCode === 'STAGE_NOT_IN_ROUTING') pthFailed = true;
            }
            assert(pthFailed, 'Test C: PTH scan rejected with STAGE_NOT_IN_ROUTING');

            // QA first scan -> INVALID_STAGE (Expected VI)
            let qaFirstFailed = false;
            try {
                await ScanProcessingService.processStageScan('QA', {
                    work_order_id: wo.id,
                    batch_id: batchId,
                    barcode,
                    status: 'ACCEPTED',
                    scanned_by: 'tester'
                });
            } catch (err: any) {
                if (err.errorCode === 'INVALID_STAGE') qaFirstFailed = true;
            }
            assert(qaFirstFailed, 'Test C: First scan at QA rejected with INVALID_STAGE');

            // VI first scan -> SUCCESS
            const resVI = await ScanProcessingService.processStageScan('VI', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            let unit = await getUnitStatus(barcode);
            assert(resVI.success && unit?.current_status === 'ACCEPTED', 'Test C: First scan at VI succeeds');

            // QA scan -> SUCCESS
            const resQA = await ScanProcessingService.processStageScan('QA', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resQA.success && unit?.current_status === 'ACCEPTED', 'Test C: Subsequent scan at QA succeeds');

            // PACKING scan -> COMPLETED
            const resPK = await ScanProcessingService.processStageScan('PACKING', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resPK.success && unit?.current_status === 'COMPLETED', 'Test C: PACKING scan COMPLETED unit');
        }

        // =========================================================================
        // Test D: PTH and VI Deselected (QA -> PACKING)
        // PTH & VI -> STAGE_NOT_IN_ROUTING, QA first scan -> SUCCESS
        // =========================================================================
        console.log('\n--- Running Test D: PTH & VI Deselected (QA -> PACKING) ---');
        {
            const { wo, batchId, activeRoute } = await createTestWO('WO-TEST-D', [
                'QA', 'PACKING'
            ]);
            assert(activeRoute[0].stage_code === 'QA', 'Test D: First stage is QA');

            const barcode = 'BAR-D-001';

            // PTH scan -> STAGE_NOT_IN_ROUTING
            let pthFailed = false;
            try {
                await ScanProcessingService.processStageScan('PTH', {
                    work_order_id: wo.id,
                    batch_id: batchId,
                    barcode,
                    status: 'ACCEPTED',
                    scanned_by: 'tester'
                });
            } catch (err: any) {
                if (err.errorCode === 'STAGE_NOT_IN_ROUTING') pthFailed = true;
            }
            assert(pthFailed, 'Test D: PTH scan rejected with STAGE_NOT_IN_ROUTING');

            // VI scan -> STAGE_NOT_IN_ROUTING
            let viFailed = false;
            try {
                await ScanProcessingService.processStageScan('VI', {
                    work_order_id: wo.id,
                    batch_id: batchId,
                    barcode,
                    status: 'ACCEPTED',
                    scanned_by: 'tester'
                });
            } catch (err: any) {
                if (err.errorCode === 'STAGE_NOT_IN_ROUTING') viFailed = true;
            }
            assert(viFailed, 'Test D: VI scan rejected with STAGE_NOT_IN_ROUTING');

            // QA scan -> SUCCESS
            const resQA = await ScanProcessingService.processStageScan('QA', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            let unit = await getUnitStatus(barcode);
            assert(resQA.success && unit?.current_status === 'ACCEPTED', 'Test D: QA first scan SUCCESS');

            // PACKING scan -> COMPLETED
            const resPK = await ScanProcessingService.processStageScan('PACKING', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            unit = await getUnitStatus(barcode);
            assert(resPK.success && unit?.current_status === 'COMPLETED', 'Test D: PACKING scan COMPLETED unit');
        }

        // =========================================================================
        // Test E: Middle stage required (PTH -> FLASHING -> QA)
        // Note: Production stage order dictates: PTH -> QA -> FLASHING
        // Let's test: PTH -> QA -> FLASHING, where VI is skipped!
        // At PTH, scan at FLASHING -> INVALID_TRANSITION (expected QA)
        // QA -> SUCCESS, FLASHING -> SUCCESS, COMPLETED
        // =========================================================================
        console.log('\n--- Running Test E: Middle stage required (PTH -> QA -> FLASHING) ---');
        {
            // Note: Even if user specifies ['PTH', 'FLASHING', 'QA'], resolveActiveRoute strictly preserves stage_order!
            // stage_order: PTH (1) -> QA (3) -> FLASHING (4)
            const { wo, batchId, activeRoute } = await createTestWO('WO-TEST-E', [
                'PTH', 'FLASHING', 'QA'
            ]);
            assert(activeRoute[0].stage_code === 'PTH', 'Test E: First stage is PTH');
            assert(activeRoute[1].stage_code === 'QA', 'Test E: Authoritative order preserves QA before FLASHING');
            assert(activeRoute[2].stage_code === 'FLASHING', 'Test E: Last stage is FLASHING');

            const barcode = 'BAR-E-001';

            // PTH scan -> SUCCESS
            const resPTH = await ScanProcessingService.processStageScan('PTH', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            assert(resPTH.success, 'Test E: PTH scan SUCCESS');

            // Attempt FLASHING before QA -> INVALID_TRANSITION (expected QA)
            let flEarlyFailed = false;
            let expectedStageReported = '';
            try {
                await ScanProcessingService.processStageScan('FLASHING', {
                    work_order_id: wo.id,
                    batch_id: batchId,
                    barcode,
                    status: 'ACCEPTED',
                    scanned_by: 'tester'
                });
            } catch (err: any) {
                if (err.errorCode === 'INVALID_TRANSITION') {
                    flEarlyFailed = true;
                    expectedStageReported = err.requiredStage;
                }
            }
            assert(flEarlyFailed, 'Test E: Premature FLASHING scan rejected with INVALID_TRANSITION');
            assert(expectedStageReported === 'QA' || expectedStageReported.includes('Quality'), 'Test E: Correctly reported expected stage as QA');

            // QA scan -> SUCCESS
            const resQA = await ScanProcessingService.processStageScan('QA', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            assert(resQA.success, 'Test E: QA scan SUCCESS');

            // FLASHING scan -> SUCCESS & COMPLETED (Since FLASHING is the last stage in this route!)
            const resFL = await ScanProcessingService.processStageScan('FLASHING', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            let unit = await getUnitStatus(barcode);
            assert(resFL.success && unit?.current_status === 'COMPLETED', 'Test E: FLASHING scan COMPLETED unit (final stage)');
        }

        // =========================================================================
        // Test F: Only one stage (QA)
        // First scan is at QA, and immediately marks unit COMPLETED
        // =========================================================================
        console.log('\n--- Running Test F: Only One Stage (QA) ---');
        {
            const { wo, batchId, activeRoute } = await createTestWO('WO-TEST-F', ['QA']);
            assert(activeRoute.length === 1, 'Test F: Route has exactly 1 stage');
            assert(activeRoute[0].stage_code === 'QA', 'Test F: Stage is QA');

            const barcode = 'BAR-F-001';
            const resQA = await ScanProcessingService.processStageScan('QA', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            let unit = await getUnitStatus(barcode);
            assert(resQA.success && unit?.current_status === 'COMPLETED', 'Test F: Single stage scan is immediately COMPLETED');
        }

        // =========================================================================
        // Test G: Legacy Work Order (selected_stages = NULL)
        // Falls back to standard production stages in order without error
        // =========================================================================
        console.log('\n--- Running Test G: Legacy Work Order (selected_stages = NULL) ---');
        {
            const { wo, batchId, activeRoute } = await createTestWO('WO-TEST-G', null);
            assert(activeRoute.length >= 8, 'Test G: Legacy WO falls back to all standard stages');
            assert(activeRoute[0].stage_code === 'PTH', 'Test G: First stage is PTH');

            const barcode = 'BAR-G-001';
            const resPTH = await ScanProcessingService.processStageScan('PTH', {
                work_order_id: wo.id,
                batch_id: batchId,
                barcode,
                status: 'ACCEPTED',
                scanned_by: 'tester'
            });
            let unit = await getUnitStatus(barcode);
            assert(resPTH.success && unit?.current_status === 'ACCEPTED', 'Test G: Legacy WO first scan at PTH SUCCESS');
        }

        // =========================================================================
        // Test H: Empty Route (selected_stages = [])
        // Must throw validation error, reject scanning
        // =========================================================================
        console.log('\n--- Running Test H: Empty Route (selected_stages = []) ---');
        {
            let emptyRouteRejected = false;
            try {
                await WorkflowEngineService.resolveActiveRoute({ stagesList: [] });
            } catch (err: any) {
                emptyRouteRejected = true;
            }
            assert(emptyRouteRejected, 'Test H: Empty route [] rejected with validation error');
        }

        // =========================================================================
        // Test I: Invalid Stage (e.g. ['PTH', 'INVALID_STAGE'])
        // Unknown stages are filtered/rejected during route resolution
        // =========================================================================
        console.log('\n--- Running Test I: Invalid Stage ---');
        {
            const route = await WorkflowEngineService.resolveActiveRoute({ stagesList: ['PTH', 'INVALID_STAGE_XYZ'] });
            assert(route.length === 1 && route[0].stage_code === 'PTH', 'Test I: Unknown stage safely ignored or filtered out of active route');
        }

        // =========================================================================
        // Test J: Batch visibility filter
        // Work Order with PTH -> QA must show on PTH and QA, but NOT on VI or FLASHING
        // =========================================================================
        console.log('\n--- Running Test J: Batch Visibility on Stage Pages ---');
        {
            const { wo, batchId } = await createTestWO('WO-TEST-J', ['PTH', 'QA']);
            
            // Query batches for PTH
            const pthBatches = await BatchManagementService.getBatchesByStage('PTH', 50, 0);
            const foundInPTH = pthBatches.data.some((b: any) => b.wo_number === wo.wo_number);
            assert(foundInPTH, 'Test J: WO-TEST-J is visible on PTH batch page');

            // Query batches for VI (deselected)
            const viBatches = await BatchManagementService.getBatchesByStage('VI', 50, 0);
            const foundInVI = viBatches.data.some((b: any) => b.wo_number === wo.wo_number);
            assert(!foundInVI, 'Test J: WO-TEST-J is NOT visible on VI batch page');

            // Query batches for QA
            const qaBatches = await BatchManagementService.getBatchesByStage('QA', 50, 0);
            const foundInQA = qaBatches.data.some((b: any) => b.wo_number === wo.wo_number);
            assert(foundInQA, 'Test J: WO-TEST-J is visible on QA batch page');

            // Query batches for FLASHING (deselected)
            const flBatches = await BatchManagementService.getBatchesByStage('FLASHING', 50, 0);
            const foundInFL = flBatches.data.some((b: any) => b.wo_number === wo.wo_number);
            assert(!foundInFL, 'Test J: WO-TEST-J is NOT visible on FLASHING batch page');
        }

        console.log(`\n=== AUTOMATED TEST SUITE FINISHED ===`);
        console.log(`Total Passed: ${passedCount}`);
        console.log(`Total Failed: ${failedCount}`);

        if (failedCount > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
    } catch (err: any) {
        console.error('Fatal error during test execution:', err);
        process.exit(1);
    }
}

runTests();
