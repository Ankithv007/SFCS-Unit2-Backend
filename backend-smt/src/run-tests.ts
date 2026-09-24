import { Request, Response } from 'express';
import pool from './config/db';
import { trackWorkOrder } from './controllers/smtTrackController';
import { validateAndRecordScan as spiScan } from './controllers/spiController';
import { getWorkOrderById } from './controllers/smtController';

const mockRes = () => {
    const res: any = {};
    res.status = (code: number) => {
        res.statusCode = code;
        return res;
    };
    res.json = (data: any) => {
        res.data = data;
        return res;
    };
    return res;
};

const mockReq = (query: any = {}, body: any = {}, params: any = {}) => {
    return { query, body, params, user: { id: 1, role: 'Admin' } } as any;
};

async function runTests() {
    try {
        console.log('--- STARTING INTEGRATION TESTS ---');

        // Test 1: NULL / EMPTY Input handling on Track Work Order
        console.log('\n[Test 1] Null / Empty input (Track)');
        let res1 = mockRes();
        await trackWorkOrder(mockReq({ woId: null }), res1);
        console.log('null ->', res1.statusCode, res1.data);

        let res2 = mockRes();
        await trackWorkOrder(mockReq({ woId: undefined }), res2);
        console.log('undefined ->', res2.statusCode, res2.data);

        let res3 = mockRes();
        await trackWorkOrder(mockReq({ woId: '' }), res3);
        console.log('empty string ->', res3.statusCode, res3.data);

        let res4 = mockRes();
        await trackWorkOrder(mockReq({ woId: '   ' }), res4);
        console.log('whitespace ->', res4.statusCode, res4.data);

        // Fetch a valid WO and serial for subsequent tests
        const woRes = await pool.query(`SELECT id FROM smt_work_orders LIMIT 1`);
        if (woRes.rows.length === 0) {
            console.log('No work orders found for testing. Skipping logic tests.');
            return;
        }
        const validWoId = woRes.rows[0].id;
        console.log('Using Work Order ID:', validWoId);

        const serialRes = await pool.query(`SELECT serial_number FROM smt_serial_numbers WHERE work_order_id = $1 LIMIT 1`, [validWoId]);
        if (serialRes.rows.length === 0) {
            console.log('No serials found. Exiting.');
            return;
        }
        const validSerial = serialRes.rows[0].serial_number;
        console.log('Using Serial Number:', validSerial);

        // Test 2: Case & Whitespace Insensitivity (Work Order Lookup)
        console.log('\n[Test 2] Case & Whitespace Insensitivity (SMT Work Order)');
        const variations = [
            validWoId,
            validWoId.toLowerCase(),
            `  ${validWoId} `,
            validWoId.toUpperCase()
        ];
        
        for (const variant of variations) {
            const res = mockRes();
            await getWorkOrderById(mockReq({}, {}, { id: variant }), res);
            console.log(`Variant "${variant}" ->`, res.statusCode, res.data.success !== false ? 'MATCH' : 'FAIL');
        }

        // Test 3: Concurrency on SPI Scan
        console.log('\n[Test 3] Concurrency Test (SPI)');
        // First we need a session
        const sessRes = await pool.query(`SELECT id FROM smt_spi_sessions WHERE work_order_id = $1 LIMIT 1`, [validWoId]);
        if (sessRes.rows.length > 0) {
            const sessionId = sessRes.rows[0].id;
            console.log('Using SPI Session ID:', sessionId);
            
            // Fire two concurrent requests for the same serial with different casings
            const reqA = mockReq({}, { scanned_barcode: validSerial.toUpperCase() }, { id: sessionId });
            const reqB = mockReq({}, { scanned_barcode: ` ${validSerial.toLowerCase()} ` }, { id: sessionId });
            
            const [resA, resB] = await Promise.all([
                (async () => { const r = mockRes(); await spiScan(reqA, r); return r; })(),
                (async () => { const r = mockRes(); await spiScan(reqB, r); return r; })()
            ]);

            console.log('Concurrent A ->', resA.statusCode, resA.data?.error || 'SUCCESS');
            console.log('Concurrent B ->', resB.statusCode, resB.data?.error || 'SUCCESS');
        } else {
            console.log('No active SPI session found to test concurrency.');
        }

        // Test 4: Final EXPLAIN ANALYZE traces
        console.log('\n[Test 4] EXPLAIN ANALYZE');
        const queries = [
            `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM smt_serial_numbers WHERE work_order_id = '${validWoId}' AND UPPER(BTRIM(serial_number)) = UPPER(BTRIM('${validSerial}'))`,
            `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM smt_serial_numbers WHERE UPPER(BTRIM(serial_number)) = UPPER(BTRIM('${validSerial}'))`,
            `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM smt_inspections WHERE work_order_id = '${validWoId}' AND UPPER(BTRIM(scanned_barcode)) = UPPER(BTRIM('${validSerial}'))`,
            `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM smt_work_orders WHERE id = '${validWoId}'`,
            `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM smt_work_orders WHERE po_id = '${validWoId}'`,
            `EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM smt_fg_sessions WHERE work_order_id = '${validWoId}' AND LOWER(side) = 'top'`
        ];

        for (const q of queries) {
            const r = await pool.query(q);
            console.log('\nQuery:', q.substring(0, 100) + '...');
            console.log(r.rows.map((row: any) => row['QUERY PLAN']).join('\n'));
        }

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

runTests();
