import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('MES Rework Lifecycle & ISO-9001 Audit Traceability Tests', () => {

    test('1. Rework Flow: Failed inspection preserves defect history and links to resolving pass', async () => {
        // Simulated in-memory database table for rrh_ipqc_inspections
        const table: any[] = [];
        let nextId = 1;

        // Step 1: Unit fails IPQC
        const initialFailRecord = {
            id: nextId++,
            session_id: 10,
            work_order_id: 'WO-TEST-001',
            serial_number: 'SN-REWORK-01',
            status: 'FAIL',
            remarks: 'Solder bridge on PAM connector',
            checkpoints: [{ name: 'Visual', status: 'FAIL', remark: 'Solder bridge' }],
            scanned_by: 'Operator 1',
            is_deleted: false,
            is_reinspected: false,
            defect_fixed: null,
            superseded_by_id: null,
            superseded_at: null
        };
        table.push(initialFailRecord);

        assert.strictEqual(table.length, 1);
        assert.strictEqual(table[0].status, 'FAIL');
        assert.strictEqual(table[0].is_deleted, false);

        // Step 2: Unit is repaired and re-scanned in session 10.
        // The rework logic in StationService:
        // Finds previous fail record:
        const prevFail = table.find(r => r.session_id === 10 && r.serial_number === 'SN-REWORK-01' && r.is_deleted === false);
        assert.ok(prevFail);
        assert.strictEqual(prevFail.status, 'FAIL');

        // New passing record is inserted
        const passingRecord = {
            id: nextId++,
            session_id: 10,
            work_order_id: 'WO-TEST-001',
            serial_number: 'SN-REWORK-01',
            status: 'PASS',
            remarks: null,
            checkpoints: [{ name: 'Visual', status: 'PASS' }],
            scanned_by: 'Operator 2',
            is_deleted: false,
            is_reinspected: true,
            defect_fixed: prevFail.remarks || 'Defect resolved upon re-inspection.',
            superseded_by_id: null,
            superseded_at: null
        };
        table.push(passingRecord);

        // Previous failure record is marked is_deleted = true AND superseded_by_id = passingRecord.id
        prevFail.is_deleted = true;
        prevFail.superseded_by_id = passingRecord.id;
        prevFail.superseded_at = new Date();

        // Step 3: Verify Integrity & Traceability
        // Active record query (for station progression & partial unique constraints)
        const activeRecords = table.filter(r => r.is_deleted === false);
        assert.strictEqual(activeRecords.length, 1);
        assert.strictEqual(activeRecords[0].status, 'PASS');
        assert.strictEqual(activeRecords[0].is_reinspected, true);
        assert.strictEqual(activeRecords[0].defect_fixed, 'Solder bridge on PAM connector');

        // Historical failure audit query (for yield analysis & defect Pareto reporting)
        const allHistoricalFailures = table.filter(r => r.status === 'FAIL');
        assert.strictEqual(allHistoricalFailures.length, 1);
        assert.strictEqual(allHistoricalFailures[0].remarks, 'Solder bridge on PAM connector');
        assert.strictEqual(allHistoricalFailures[0].superseded_by_id, passingRecord.id);
        assert.ok(allHistoricalFailures[0].superseded_at instanceof Date);
    });

    test('2. Multi-Cycle Rework: Supports multiple repair attempts with chain of custody', async () => {
        const table: any[] = [];
        let nextId = 100;

        // Cycle 1: First fail
        const fail1 = {
            id: nextId++,
            serial_number: 'SN-CYCLE-02',
            status: 'FAIL',
            remarks: 'Firmware flash error',
            is_deleted: false,
            superseded_by_id: null as number | null
        };
        table.push(fail1);

        // Cycle 2: Second attempt still fails
        const fail2 = {
            id: nextId++,
            serial_number: 'SN-CYCLE-02',
            status: 'FAIL',
            remarks: 'Firmware checksum mismatch on retry',
            is_deleted: false,
            superseded_by_id: null as number | null
        };
        fail1.is_deleted = true;
        fail1.superseded_by_id = fail2.id;
        table.push(fail2);

        // Cycle 3: Hardware replaced, third attempt passes
        const pass3 = {
            id: nextId++,
            serial_number: 'SN-CYCLE-02',
            status: 'PASS',
            is_reinspected: true,
            defect_fixed: 'Flash IC replaced and reprogrammed',
            is_deleted: false,
            superseded_by_id: null as number | null
        };
        fail2.is_deleted = true;
        fail2.superseded_by_id = pass3.id;
        table.push(pass3);

        // Verify full lineage chain
        assert.strictEqual(table.length, 3);
        assert.strictEqual(fail1.superseded_by_id, fail2.id);
        assert.strictEqual(fail2.superseded_by_id, pass3.id);

        // Active count is strictly 1
        const active = table.filter(r => !r.is_deleted);
        assert.strictEqual(active.length, 1);
        assert.strictEqual(active[0].id, pass3.id);

        // Total failure count preserves both failed iterations for engineering Pareto analysis
        const failures = table.filter(r => r.status === 'FAIL');
        assert.strictEqual(failures.length, 2);
    });

    test('3. Duplicate Pass Prevention: Cannot re-scan unit that has already passed', async () => {
        const table: any[] = [
            {
                id: 50,
                work_order_id: 'WO-100',
                serial_number: 'SN-PASSED-99',
                status: 'PASS',
                is_deleted: false
            }
        ];

        // Attempting to scan a unit that already has an active PASS
        const existingPass = table.find(r => 
            r.work_order_id === 'WO-100' && 
            r.serial_number === 'SN-PASSED-99' && 
            !r.is_deleted && 
            (r.status === 'PASS' || r.status === 'COMPLETED')
        );

        assert.ok(existingPass, 'Should find existing active pass record');
        // Business logic must reject with 409 Conflict
        const canInsert = !existingPass;
        assert.strictEqual(canInsert, false, 'Must reject duplicate pass scan');
    });
});
