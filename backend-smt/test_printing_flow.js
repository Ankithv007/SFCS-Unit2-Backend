const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME_SMT || 'smt_db',
    password: process.env.DB_PASSWORD || 'root',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function runTests() {
    console.log('Connecting to SMT database...');
    const client = await pool.connect();
    try {
        console.log('Connected successfully!');
        
        // 1. Setup clean test data
        console.log('Cleaning up previous test data...');
        await client.query(`DELETE FROM smt_inspections WHERE printing_session_id IN (SELECT id FROM smt_printing_sessions WHERE work_order_id = 'WO-FLOW-TEST')`);
        await client.query(`DELETE FROM smt_printing_sessions WHERE work_order_id = 'WO-FLOW-TEST'`);
        await client.query(`DELETE FROM smt_stencil_lifecycle WHERE work_order_id = 'WO-FLOW-TEST'`);
        await client.query(`DELETE FROM stencil_master WHERE stencil_id = 'STENCIL-FLOW'`);
        await client.query(`DELETE FROM smt_serial_numbers WHERE work_order_id = 'WO-FLOW-TEST'`);
        await client.query(`DELETE FROM smt_work_orders WHERE id = 'WO-FLOW-TEST'`);

        console.log('Seeding test Work Order...');
        await client.query(`
            INSERT INTO smt_work_orders (id, area_id, line_id, priority, product_name, quantity, panel_quantity, sides, status)
            VALUES ('WO-FLOW-TEST', 'AREA-1', 'LINE-1', 'HIGH', 'Product-A', 3, 1, 'Top', 'Open')
        `);

        console.log('Seeding serial generation records...');
        await client.query(`
            INSERT INTO smt_serial_numbers (work_order_id, serial_format, serial_number, status)
            VALUES 
                ('WO-FLOW-TEST', 'FORMAT-1', 'SN-FLOW-001', 'Generated'),
                ('WO-FLOW-TEST', 'FORMAT-1', 'SN-FLOW-002', 'Generated'),
                ('WO-FLOW-TEST', 'FORMAT-1', 'SN-FLOW-003', 'Generated')
        `);

        console.log('Seeding stencil master...');
        const stencilMasterRes = await client.query(`
            INSERT INTO stencil_master (stencil_id, stencil_name, job_number, revision, thickness_mills, manufacturing_date, side, created_by_name)
            VALUES ('STENCIL-FLOW', 'Stencil Flow', 'JOB-1', 'A1', '5', CURRENT_DATE, 'TOP', 'Test Operator')
            RETURNING id
        `);
        const stencilMasterId = stencilMasterRes.rows[0].id;

        console.log('Seeding completed Stencil Lifecycle...');
        const lifecycleRes = await client.query(`
            INSERT INTO smt_stencil_lifecycle (
                stencil_record_id, stencil_id, stencil_name, work_order_id, work_order_number, 
                product_name, sides, quantity, qty_life_cycle, balance_life_cycle, 
                current_used_life_cycle, status, created_by, created_by_name
            ) VALUES (
                $1, 'STENCIL-FLOW', 'Stencil Flow', 'WO-FLOW-TEST', 'WO-FLOW-TEST',
                'Product-A', 'Top', 3, 3, 60000,
                0, 'Completed', 'admin', 'Admin'
            ) RETURNING id
        `, [stencilMasterId]);
        const lifecycleId = lifecycleRes.rows[0].id;

        // 2. Create printing session
        console.log('Creating printing session...');
        const sessionRes = await client.query(`
            INSERT INTO smt_printing_sessions (work_order_id, stencil_lifecycle_id, squeegee_number, solder_paste_barcode, side, status, created_by, created_by_name)
            VALUES ('WO-FLOW-TEST', $1, 'SQ-001', 'PASTE-001', 'Top', 'In Progress', 'admin', 'Admin')
            RETURNING id
        `, [lifecycleId]);
        const sessionId = sessionRes.rows[0].id;
        console.log(`Session created with ID: ${sessionId}`);

        // Helper to scan barcode via the DB logic simulated
        async function scanBarcode(barcode) {
            console.log(`Scanning barcode: ${barcode}`);
            // Check if valid serial number for WO
            const serialRes = await client.query(
                `SELECT * FROM smt_serial_numbers WHERE work_order_id = 'WO-FLOW-TEST' AND serial_number = $1`,
                [barcode]
            );
            if (serialRes.rows.length === 0) {
                throw new Error('Invalid barcode');
            }
            const serial = serialRes.rows[0];

            // Insert PASS inspection
            const insRes = await client.query(`
                INSERT INTO smt_inspections (printing_session_id, serial_id, scanned_barcode, status, process_step, scanned_by)
                VALUES ($1, $2, $3, 'PASS', 'Printing', 'Operator')
                RETURNING id
            `, [sessionId, serial.id, barcode]);

            // Check completion (Passed count = Work Order Quantity)
            const passRes = await client.query(
                `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
                 FROM smt_inspections 
                 WHERE printing_session_id = $1 AND status = 'PASS'`,
                [sessionId]
            );
            const passCount = parseInt(passRes.rows[0].count, 10);

            if (passCount >= 3) { // WO Quantity = 3
                await client.query(
                    `UPDATE smt_printing_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [sessionId]
                );
            }
            return { passCount, inspectionId: insRes.rows[0].id };
        }

        // Helper to fail a scanned row
        async function failRow(scanId, reason) {
            console.log(`Failing inspection row: ${scanId}`);
            await client.query(
                `UPDATE smt_inspections 
                 SET status = 'FAIL', rework_reason = $1, scanned_at = CURRENT_TIMESTAMP 
                 WHERE id = $2`,
                [reason, scanId]
            );

            const passRes = await client.query(
                `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
                 FROM smt_inspections 
                 WHERE printing_session_id = $1 AND status = 'PASS'`,
                [sessionId]
            );
            const passCount = parseInt(passRes.rows[0].count, 10);
            if (passCount >= 3) {
                await client.query(
                    `UPDATE smt_printing_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [sessionId]
                );
            }
            return { passCount };
        }

        // Test step 5: Scan 2 valid serial numbers
        const scan1 = await scanBarcode('SN-FLOW-001');
        const scan2 = await scanBarcode('SN-FLOW-002');
        console.log(`Passed count after 2 scans: ${scan2.passCount}`);
        
        let statusRes = await client.query('SELECT status FROM smt_printing_sessions WHERE id = $1', [sessionId]);
        console.log(`Session status: ${statusRes.rows[0].status}`);
        if (statusRes.rows[0].status !== 'In Progress') {
            throw new Error('Session should be In Progress');
        }

        // Test step 6: Fail 1 scanned serial number
        console.log('Failing first scan...');
        const failRes = await failRow(scan1.inspectionId, 'Defective paste');
        console.log(`Passed count after fail: ${failRes.passCount}`);

        statusRes = await client.query('SELECT status FROM smt_printing_sessions WHERE id = $1', [sessionId]);
        console.log(`Session status after fail: ${statusRes.rows[0].status}`);
        if (statusRes.rows[0].status !== 'In Progress') {
            throw new Error('Session should remain In Progress because Passed (1) < WO Qty (3)');
        }

        // Test step 7: Scan 2 more valid serial numbers (total unique passed will be 3)
        // First let's re-scan the first failed one (simulating rework or print retry) or scan the 3rd one
        // Let's re-scan SN-FLOW-001 (which we failed) so it becomes PASS again
        const scan1_retry = await client.query(`
            INSERT INTO smt_inspections (printing_session_id, serial_id, scanned_barcode, status, process_step, scanned_by)
            VALUES ($1, (SELECT id FROM smt_serial_numbers WHERE serial_number = 'SN-FLOW-001'), 'SN-FLOW-001', 'PASS', 'Printing', 'Operator')
            RETURNING id
        `, [sessionId]);

        // Scan the 3rd one to satisfy 3 unique Passed units
        const scan3 = await scanBarcode('SN-FLOW-003');
        console.log(`Passed count after final scans: ${scan3.passCount}`);

        statusRes = await client.query('SELECT status FROM smt_printing_sessions WHERE id = $1', [sessionId]);
        console.log(`Session status after final scans: ${statusRes.rows[0].status}`);
        if (statusRes.rows[0].status !== 'Completed') {
            throw new Error('Session should have transitioned to Completed');
        }

        console.log('✅ ALL INTEGRATION TESTS PASSED!');

    } catch (error) {
        console.error('❌ TEST FAILED:', error);
    } finally {
        // Cleanup test data
        console.log('Cleaning up database...');
        await client.query(`DELETE FROM smt_inspections WHERE printing_session_id IN (SELECT id FROM smt_printing_sessions WHERE work_order_id = 'WO-FLOW-TEST')`);
        await client.query(`DELETE FROM smt_printing_sessions WHERE work_order_id = 'WO-FLOW-TEST'`);
        await client.query(`DELETE FROM smt_stencil_lifecycle WHERE work_order_id = 'WO-FLOW-TEST'`);
        await client.query(`DELETE FROM stencil_master WHERE stencil_id = 'STENCIL-FLOW'`);
        await client.query(`DELETE FROM smt_serial_numbers WHERE work_order_id = 'WO-FLOW-TEST'`);
        await client.query(`DELETE FROM smt_work_orders WHERE id = 'WO-FLOW-TEST'`);
        client.release();
        await pool.end();
    }
}

runTests();
