import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import ecnIpqcRoutes from '../src/routes/ecn/ecnIpqcRoutes';
import iviRoutes from '../src/routes/iviRoutes';

const DB_HOST = process.env.DB_HOST || 'db';
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10);
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || 'root';
const DB_NAME = process.env.DB_NAME || 'rrh_verification_db';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

const pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
});

describe('Full Barcode-Scan API Latency, Duplicate Rejection & Rework Benchmark Suite', () => {
    let server: http.Server;
    let serverPort: number;
    let baseUrl: string;
    let authToken: string;

    const testWoId = 'WO-BENCH-REAL-2026';
    let testIviSessionId = 0;
    let testIpqcSessionId = 0;

    before(async () => {
        // 1. Generate valid test JWT
        authToken = jwt.sign(
            { id: 999, username: 'test_operator', email: 'operator@sfcs.local', role: 'admin' },
            JWT_SECRET,
            { expiresIn: '2h' }
        );

        // 2. Setup Express test application mounting actual routes
        const app = express();
        app.use(express.json());

        // Mount actual routers
        app.use('/api/rrh/ipqc', ecnIpqcRoutes);
        app.use('/api/rrh/ivi', iviRoutes);

        // Error handler
        app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
            res.status(err.status || 500).json({ error: err.message });
        });

        await new Promise<void>((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                const addr = server.address() as any;
                serverPort = addr.port;
                baseUrl = `http://127.0.0.1:${serverPort}`;
                resolve();
            });
        });

        // 3. Clean test harness data
        await pool.query('DELETE FROM rrh_ipqc_inspections WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_ivi_inspections WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_inward_scans WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_ipqc_sessions WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_ivi_sessions WHERE work_order_id = $1', [testWoId]);
        await pool.query('DELETE FROM rrh_work_orders WHERE work_order_id = $1', [testWoId]);

        // 4. Seed Canonical Work Order
        await pool.query(
            `INSERT INTO rrh_work_orders (work_order_id, lot_quantity, status)
             VALUES ($1, 500, 'CREATED')`,
            [testWoId]
        );

        // 5. Seed Sessions
        const iviSessRes = await pool.query(
            `INSERT INTO rrh_ivi_sessions (work_order_id, status, route)
             VALUES ($1, 'In Progress', 'ECN') RETURNING id`,
            [testWoId]
        );
        testIviSessionId = iviSessRes.rows[0].id;

        const ipqcSessRes = await pool.query(
            `INSERT INTO rrh_ipqc_sessions (work_order_id, status, route)
             VALUES ($1, 'In Progress', 'ECN') RETURNING id`,
            [testWoId]
        );
        testIpqcSessionId = ipqcSessRes.rows[0].id;

        // 6. Pre-seed 100 units with Inward Scan + Passed IVI Inspection (Prerequisites for IPQC)
        for (let i = 1; i <= 100; i++) {
            const sn = `SN-BENCH-${i.toString().padStart(4, '0')}`;
            await pool.query(
                `INSERT INTO rrh_inward_scans (
                    work_order_id, serial_number, scanned_by, status
                 ) VALUES ($1, $2, 'InwardOp', 'PASS')`,
                [testWoId, sn]
            );

            await pool.query(
                `INSERT INTO rrh_ivi_inspections (
                    session_id, work_order_id, serial_number, status, scanned_by, route, physical_tpn,
                    duplexer_main, duplexer_part_no, rrh_unit
                 ) VALUES ($1, $2, $3, 'PASS', 'IviOp', 'ECN', '611-SKU000176-P', 'DPX-MAIN-01', 'DPX-PART-01', 'RRH-UNIT-01')`,
                [testIviSessionId, testWoId, sn]
            );
        }

        // Seed 1 unit specifically for duplicate race testing
        const dupSn = 'SN-BENCH-DUPLICATE-01';
        await pool.query(
            `INSERT INTO rrh_inward_scans (work_order_id, serial_number, scanned_by, status)
             VALUES ($1, $2, 'InwardOp', 'PASS')`,
            [testWoId, dupSn]
        );
        await pool.query(
            `INSERT INTO rrh_ivi_inspections (
                session_id, work_order_id, serial_number, status, scanned_by, route, physical_tpn,
                duplexer_main, duplexer_part_no, rrh_unit
             ) VALUES ($1, $2, $3, 'PASS', 'IviOp', 'ECN', '611-SKU000176-P', 'DPX-MAIN-01', 'DPX-PART-01', 'RRH-UNIT-01')`,
            [testIviSessionId, testWoId, dupSn]
        );

        // Seed 1 unit specifically for rework testing
        const reworkSn = 'SN-BENCH-REWORK-01';
        await pool.query(
            `INSERT INTO rrh_inward_scans (work_order_id, serial_number, scanned_by, status)
             VALUES ($1, $2, 'InwardOp', 'PASS')`,
            [testWoId, reworkSn]
        );
        await pool.query(
            `INSERT INTO rrh_ivi_inspections (
                session_id, work_order_id, serial_number, status, scanned_by, route, physical_tpn,
                duplexer_main, duplexer_part_no, rrh_unit
             ) VALUES ($1, $2, $3, 'PASS', 'IviOp', 'ECN', '611-SKU000176-P', 'DPX-MAIN-01', 'DPX-PART-01', 'RRH-UNIT-01')`,
            [testIviSessionId, testWoId, reworkSn]
        );
    });

    after(async () => {
        if (server) {
            if (typeof (server as any).closeAllConnections === 'function') {
                (server as any).closeAllConnections();
            }
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        await pool.end();
        setTimeout(() => process.exit(0), 100);
    });

    test('Benchmark 1: Full Barcode-Scan API Latency under Concurrent Load', async () => {
        const standardCheckpoints = [
            { id: 1, name: 'Check physical damage', confirmed: true, status: 'PASS', remark: '' },
            { id: 2, name: 'Check RF connector pins', confirmed: true, status: 'PASS', remark: '' },
            { id: 3, name: 'Check screw torque', confirmed: true, status: 'PASS', remark: '' },
            { id: 4, name: 'Check thermal pad placement', confirmed: true, status: 'PASS', remark: '' },
            { id: 5, name: 'Check cable routing', confirmed: true, status: 'PASS', remark: '' },
            { id: 6, name: 'Check labeling integrity', confirmed: true, status: 'PASS', remark: '' },
            { id: 7, name: 'Check housing seal', confirmed: true, status: 'PASS', remark: '' }
        ];

        const latencies: number[] = [];
        let successCount = 0;
        let errorCount = 0;

        const totalRequests = 100;
        const concurrencyLimit = 10;
        const unitIndices = Array.from({ length: totalRequests }, (_, i) => i + 1);

        const benchmarkStartTime = performance.now();

        // Worker queue execution to simulate 10 concurrent scanning operators
        const runWorker = async (indices: number[]) => {
            for (const idx of indices) {
                const sn = `SN-BENCH-${idx.toString().padStart(4, '0')}`;
                const payload = {
                    work_order_id: testWoId,
                    serial_number: sn,
                    physical_tpn: '611-SKU000176-P',
                    band: 'B1',
                    e_label: 'VALID_ELABEL',
                    pam_tpn: 'PAM-TPN-01',
                    rfpc_tpn: 'RFPC-TPN-01',
                    rfpc_sl_no: `RFPC-${idx}`,
                    checkpoints: standardCheckpoints
                };

                const t0 = performance.now();
                const res = await fetch(`${baseUrl}/api/rrh/ipqc/sessions/${testIpqcSessionId}/inspections`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify(payload)
                });
                const t1 = performance.now();
                latencies.push(t1 - t0);

                if (res.status === 200 || res.status === 201) {
                    successCount++;
                } else {
                    errorCount++;
                    const body = await res.text();
                    console.error(`Request ${sn} failed with ${res.status}: ${body}`);
                }
            }
        };

        // Distribute work among workers
        const chunks: number[][] = Array.from({ length: concurrencyLimit }, () => []);
        unitIndices.forEach((idx, i) => chunks[i % concurrencyLimit].push(idx));

        await Promise.all(chunks.map(chunk => runWorker(chunk)));

        const benchmarkEndTime = performance.now();
        const totalDurationSec = (benchmarkEndTime - benchmarkStartTime) / 1000;
        const throughput = totalRequests / totalDurationSec;

        latencies.sort((a, b) => a - b);
        const p50 = latencies[Math.floor(latencies.length * 0.50)];
        const p95 = latencies[Math.floor(latencies.length * 0.95)];
        const max = latencies[latencies.length - 1];
        const errorRate = (errorCount / totalRequests) * 100;

        console.log(`\n================== RRH BARCODE-SCAN API BENCHMARK RESULTS ==================`);
        console.log(`Total Scans Processed: ${totalRequests}`);
        console.log(`Concurrency Level:     ${concurrencyLimit} active parallel operators`);
        console.log(`Total Wall Clock Time: ${totalDurationSec.toFixed(2)} seconds`);
        console.log(`Throughput:            ${throughput.toFixed(2)} scans/sec`);
        console.log(`p50 Latency:           ${p50.toFixed(2)} ms`);
        console.log(`p95 Latency:           ${p95.toFixed(2)} ms`);
        console.log(`Max Latency:           ${max.toFixed(2)} ms`);
        console.log(`Error Rate:            ${errorRate.toFixed(2)}% (${errorCount}/${totalRequests})`);
        console.log(`============================================================================\n`);

        assert.strictEqual(successCount, totalRequests, 'All 100 valid scan submissions must succeed');
        assert.strictEqual(errorCount, 0, 'Error rate must be exactly 0%');
        assert.ok(p50 < 500, `p50 latency (${p50.toFixed(2)}ms) must be well within real-time operational thresholds (< 500ms)`);
        assert.ok(p95 < 1000, `p95 latency (${p95.toFixed(2)}ms) must be well within operational bounds (< 1000ms)`);
    });

    test('Benchmark 2: Concurrent Duplicate Scans Safe Rejection (HTTP 409 & Zero 500s)', async () => {
        const standardCheckpoints = [
            { id: 1, name: 'Check physical damage', confirmed: true, status: 'PASS', remark: '' },
            { id: 2, name: 'Check RF connector pins', confirmed: true, status: 'PASS', remark: '' },
            { id: 3, name: 'Check screw torque', confirmed: true, status: 'PASS', remark: '' },
            { id: 4, name: 'Check thermal pad placement', confirmed: true, status: 'PASS', remark: '' },
            { id: 5, name: 'Check cable routing', confirmed: true, status: 'PASS', remark: '' },
            { id: 6, name: 'Check labeling integrity', confirmed: true, status: 'PASS', remark: '' },
            { id: 7, name: 'Check housing seal', confirmed: true, status: 'PASS', remark: '' }
        ];

        const dupSn = 'SN-BENCH-DUPLICATE-01';
        const payload = {
            work_order_id: testWoId,
            serial_number: dupSn,
            physical_tpn: '611-SKU000176-P',
            band: 'B1',
            e_label: 'VALID_ELABEL',
            pam_tpn: 'PAM-TPN-01',
            rfpc_tpn: 'RFPC-TPN-01',
            rfpc_sl_no: 'RFPC-DUP',
            checkpoints: standardCheckpoints
        };

        // Fire 10 simultaneous duplicate scans through the live HTTP API
        const concurrentAttempts = 10;
        const promises = Array.from({ length: concurrentAttempts }, () =>
            fetch(`${baseUrl}/api/rrh/ipqc/sessions/${testIpqcSessionId}/inspections`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(payload)
            })
        );

        const responses = await Promise.all(promises);
        const statuses = responses.map(r => r.status);

        const count200 = statuses.filter(s => s === 200 || s === 201).length;
        const count409 = statuses.filter(s => s === 409).length;
        const count500 = statuses.filter(s => s >= 500).length;

        console.log(`[Duplicate Scan Concurrency Test] 10 Simultaneous Scans for ${dupSn}:`);
        console.log(`  HTTP 200/201 (Accepted):  ${count200}`);
        console.log(`  HTTP 409 (Safely Rejected): ${count409}`);
        console.log(`  HTTP 500 (Unhandled Errors): ${count500}`);

        assert.strictEqual(count200, 1, 'Exactly ONE scan must be accepted as PASS');
        assert.strictEqual(count409, concurrentAttempts - 1, 'All other concurrent duplicate scans must be safely rejected with HTTP 409');
        assert.strictEqual(count500, 0, 'Zero unhandled 500 errors during concurrent race condition');

        // Confirm database integrity: exactly 1 active record
        const activeRows = await pool.query(
            `SELECT id, status, is_deleted FROM rrh_ipqc_inspections
             WHERE work_order_id = $1 AND serial_number = $2 AND is_deleted = false`,
            [testWoId, dupSn]
        );
        assert.strictEqual(activeRows.rows.length, 1, 'Database must contain exactly 1 active inspection record');
    });

    test('Benchmark 3: Rework Audit Traceability & Historical Yield Metric Accuracy', async () => {
        const reworkSn = 'SN-BENCH-REWORK-01';

        // Step 1: Initial Scan FAILS due to checkpoint failure
        const failCheckpoints = [
            { id: 1, name: 'Check physical damage', confirmed: true, status: 'FAIL', remark: 'Micro-fracture on casting corner' },
            { id: 2, name: 'Check RF connector pins', confirmed: true, status: 'PASS', remark: '' },
            { id: 3, name: 'Check screw torque', confirmed: true, status: 'PASS', remark: '' },
            { id: 4, name: 'Check thermal pad placement', confirmed: true, status: 'PASS', remark: '' },
            { id: 5, name: 'Check cable routing', confirmed: true, status: 'PASS', remark: '' },
            { id: 6, name: 'Check labeling integrity', confirmed: true, status: 'PASS', remark: '' },
            { id: 7, name: 'Check housing seal', confirmed: true, status: 'PASS', remark: '' }
        ];

        const failRes = await fetch(`${baseUrl}/api/rrh/ipqc/sessions/${testIpqcSessionId}/inspections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                work_order_id: testWoId,
                serial_number: reworkSn,
                physical_tpn: '611-SKU000176-P',
                band: 'B1',
                checkpoints: failCheckpoints,
                remarks: 'Point 1: Micro-fracture on casting corner'
            })
        });

        assert.ok([200, 201].includes(failRes.status), `failRes.status should be 200 or 201, got ${failRes.status}`);
        const failData = await failRes.json();
        assert.strictEqual(failData.inspection.status, 'FAIL');
        const failId = failData.inspection.id;

        // Step 2: Unit is reworked and submitted with PASS
        const passCheckpoints = [
            { id: 1, name: 'Check physical damage', confirmed: true, status: 'PASS', remark: '' },
            { id: 2, name: 'Check RF connector pins', confirmed: true, status: 'PASS', remark: '' },
            { id: 3, name: 'Check screw torque', confirmed: true, status: 'PASS', remark: '' },
            { id: 4, name: 'Check thermal pad placement', confirmed: true, status: 'PASS', remark: '' },
            { id: 5, name: 'Check cable routing', confirmed: true, status: 'PASS', remark: '' },
            { id: 6, name: 'Check labeling integrity', confirmed: true, status: 'PASS', remark: '' },
            { id: 7, name: 'Check housing seal', confirmed: true, status: 'PASS', remark: '' }
        ];

        const passRes = await fetch(`${baseUrl}/api/rrh/ipqc/sessions/${testIpqcSessionId}/inspections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                work_order_id: testWoId,
                serial_number: reworkSn,
                physical_tpn: '611-SKU000176-P',
                band: 'B1',
                checkpoints: passCheckpoints,
                is_reinspected: true,
                defect_fixed: 'Replaced outer housing chassis and retorqued'
            })
        });

        assert.ok([200, 201].includes(passRes.status), `passRes.status should be 200 or 201, got ${passRes.status}`);
        const passData = await passRes.json();
        assert.strictEqual(passData.inspection.status, 'COMPLETED');
        const passId = passData.inspection.id;

        // Step 3: Verify ISO-9001 Lineage & Audit Trail in PostgreSQL
        const supersededFailRow = await pool.query(
            `SELECT id, status, is_deleted, superseded_by_id, superseded_at, remarks
             FROM rrh_ipqc_inspections WHERE id = $1`,
            [failId]
        );
        assert.strictEqual(supersededFailRow.rows[0].status, 'FAIL');
        assert.strictEqual(supersededFailRow.rows[0].is_deleted, true, 'Superseded failure must be soft-deleted to satisfy active unique constraints');
        assert.strictEqual(supersededFailRow.rows[0].superseded_by_id, passId, 'Failure record must point to the new passing inspection ID');
        assert.ok(supersededFailRow.rows[0].superseded_at !== null, 'superseded_at timestamp must be populated');

        // Step 4: Verify Defect Preservation in Historical Quality Analytics
        const historicalDefects = await pool.query(
            `SELECT id, serial_number, remarks, scanned_at
             FROM rrh_ipqc_inspections
             WHERE work_order_id = $1 AND remarks ILIKE '%Micro-fracture%'`,
            [testWoId]
        );
        assert.strictEqual(historicalDefects.rows.length, 1, 'Historical failure defect is 100% preserved in analytics queries');

        // Step 5: Verify Active Operational Yield Metrics
        const activeMetrics = await pool.query(
            `SELECT
                COUNT(CASE WHEN status IN ('PASS', 'COMPLETED') THEN 1 END)::int as pass_count,
                COUNT(CASE WHEN status = 'FAIL' THEN 1 END)::int as fail_count
             FROM rrh_ipqc_inspections
             WHERE work_order_id = $1 AND serial_number = $2 AND is_deleted = false`,
            [testWoId, reworkSn]
        );
        assert.strictEqual(activeMetrics.rows[0].pass_count, 1, 'Operational active pass count must be exactly 1');
        assert.strictEqual(activeMetrics.rows[0].fail_count, 0, 'Operational active fail count must be exactly 0 (superseded failure is excluded from active operational inventory)');

        console.log(`[Rework Verification] Unit ${reworkSn}: Fail ID ${failId} -> Pass ID ${passId}. Audit trail and operational metrics 100% verified.`);
    });
});
