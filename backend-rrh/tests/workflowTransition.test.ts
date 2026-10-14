import { test, describe } from 'node:test';
import assert from 'node:assert';
import { validateStationEligibility } from '../src/workflows/common/transitionValidator';
import { STATION_REGISTRY } from '../src/workflows/common/stationRegistry';
import { ECN_WORKFLOW_DEFINITION } from '../src/workflows/ecn/ecnWorkflow';
import { NON_ECN_WORKFLOW_DEFINITION } from '../src/workflows/non-ecn/nonEcnWorkflow';

describe('MES Manufacturing Workflow & Station Eligibility Tests', () => {

    test('1. Workflow Architecture & Definitions Integrity', () => {
        // ECN Workflow must require IPQC and no initial burn-in
        assert.strictEqual(ECN_WORKFLOW_DEFINITION.route, 'ECN');
        assert.strictEqual(ECN_WORKFLOW_DEFINITION.requiresIpqc, true);
        assert.strictEqual(ECN_WORKFLOW_DEFINITION.initialPostBurnInRequired, false);
        assert.deepStrictEqual(ECN_WORKFLOW_DEFINITION.sequence, [
            'INWARD',
            'IVI',
            'ECN_IPQC',
            'ECN_PROGRAMMING',
            'ECN_PRE_BURN_IN',
            'ECN_HIPOT',
            'ECN_POST_BURN_IN'
        ]);

        // Non-ECN Workflow must bypass IPQC and require Initial Post-Burn-In
        assert.strictEqual(NON_ECN_WORKFLOW_DEFINITION.route, 'NON_ECN');
        assert.strictEqual(NON_ECN_WORKFLOW_DEFINITION.requiresIpqc, false);
        assert.strictEqual(NON_ECN_WORKFLOW_DEFINITION.initialPostBurnInRequired, true);
        assert.deepStrictEqual(NON_ECN_WORKFLOW_DEFINITION.sequence, [
            'INWARD',
            'IVI',
            'NON_ECN_POST_BURN_IN_INITIAL',
            'NON_ECN_PROGRAMMING',
            'NON_ECN_PRE_BURN_IN',
            'NON_ECN_HIPOT',
            'NON_ECN_POST_BURN_IN_FINAL'
        ]);
    });

    test('2. Station Registry Metadata Correctness', () => {
        assert.strictEqual(STATION_REGISTRY.ECN_IPQC.route, 'ECN');
        assert.strictEqual(STATION_REGISTRY.ECN_IPQC.requiredPredecessorId, 'IVI');

        assert.strictEqual(STATION_REGISTRY.NON_ECN_POST_BURN_IN_INITIAL.route, 'NON_ECN');
        assert.strictEqual(STATION_REGISTRY.NON_ECN_POST_BURN_IN_INITIAL.postBurnInType, 'INITIAL');
        assert.strictEqual(STATION_REGISTRY.NON_ECN_POST_BURN_IN_INITIAL.requiredPredecessorId, 'IVI');

        assert.strictEqual(STATION_REGISTRY.NON_ECN_PROGRAMMING.requiredPredecessorId, 'NON_ECN_POST_BURN_IN_INITIAL');
        assert.strictEqual(STATION_REGISTRY.NON_ECN_POST_BURN_IN_FINAL.postBurnInType, 'FINAL');
        assert.strictEqual(STATION_REGISTRY.NON_ECN_POST_BURN_IN_FINAL.requiredPredecessorId, 'NON_ECN_HIPOT');
    });

    test('3. ECN Transition Rules: Reject Non-ECN Unit from Entering IPQC', async () => {
        const mockClient: any = {
            query: async (sql: string, params: any[]) => {
                // Return empty if route is NON_ECN
                return { rows: [] };
            }
        };

        const result = await validateStationEligibility(mockClient, 'ECN_IPQC', 'WO-100', 'SN-001');
        assert.strictEqual(result.eligible, false);
        assert.match(result.reason || '', /Non-ECN units cannot enter IPQC/i);
    });

    test('4. ECN Transition Rules: Approve Valid Passed ECN IVI into IPQC', async () => {
        const mockClient: any = {
            query: async () => {
                return { rows: [{ id: 10, serial_number: 'SN-001', status: 'PASS', route: 'ECN' }] };
            }
        };

        const result = await validateStationEligibility(mockClient, 'ECN_IPQC', 'WO-100', 'SN-001');
        assert.strictEqual(result.eligible, true);
        assert.strictEqual(result.stationId, 'ECN_IPQC');
        assert.strictEqual(result.route, 'ECN');
    });

    test('5. Non-ECN Transition Rules: Approve IVI to Initial Post-Burn-In (Bypasses IPQC)', async () => {
        const mockClient: any = {
            query: async (sql: string, params: any[]) => {
                // IVI record with route = 'NON_ECN'
                return { rows: [{ id: 25, serial_number: 'SN-NON-01', status: 'PASS', route: 'NON_ECN' }] };
            }
        };

        const result = await validateStationEligibility(mockClient, 'NON_ECN_POST_BURN_IN_INITIAL', 'WO-200', 'SN-NON-01');
        assert.strictEqual(result.eligible, true);
        assert.strictEqual(result.stationId, 'NON_ECN_POST_BURN_IN_INITIAL');
        assert.strictEqual(result.route, 'NON_ECN');
    });

    test('6. Non-ECN Transition Rules: Approve Initial Post-Burn-In to Non-ECN Programming', async () => {
        const mockClient: any = {
            query: async () => {
                return {
                    rows: [{
                        id: 50,
                        serial_number: 'SN-NON-01',
                        status: 'PASS',
                        route: 'NON_ECN',
                        post_burn_in_type: 'INITIAL'
                    }]
                };
            }
        };

        const result = await validateStationEligibility(mockClient, 'NON_ECN_PROGRAMMING', 'WO-200', 'SN-NON-01');
        assert.strictEqual(result.eligible, true);
        assert.strictEqual(result.stationId, 'NON_ECN_PROGRAMMING');
        assert.strictEqual(result.route, 'NON_ECN');
    });

    test('7. Non-ECN Transition Rules: Reject Programming if Predecessor Initial Post-Burn-In Missing', async () => {
        const mockClient: any = {
            query: async () => {
                return { rows: [] }; // No Initial Post-Burn-In found
            }
        };

        const result = await validateStationEligibility(mockClient, 'NON_ECN_PROGRAMMING', 'WO-200', 'SN-UNTESTED');
        assert.strictEqual(result.eligible, false);
        assert.match(result.reason || '', /Non-ECN Programming requires passed Initial Post-Burn-In/i);
    });

    test('8. Stage Skipping Guard: Cannot Jump directly to Final Post-Burn-In without Hipot', async () => {
        const mockClient: any = {
            query: async () => {
                return { rows: [] }; // No Hipot record
            }
        };

        const result = await validateStationEligibility(mockClient, 'NON_ECN_POST_BURN_IN_FINAL', 'WO-200', 'SN-SKIP');
        assert.strictEqual(result.eligible, false);
        assert.match(result.reason || '', /has not passed Non-ECN Hipot Test/i);
    });

    test('9. Full Non-ECN Pipeline: Programming -> Pre-Burn-In -> Hipot -> Final Post-Burn-In', async () => {
        // Programming -> Pre-Burn-In
        const progMock: any = {
            query: async () => ({ rows: [{ id: 60, serial_number: 'SN-NON-01', status: 'PASS', route: 'NON_ECN' }] })
        };
        const preBurnResult = await validateStationEligibility(progMock, 'NON_ECN_PRE_BURN_IN', 'WO-200', 'SN-NON-01');
        assert.strictEqual(preBurnResult.eligible, true);
        assert.strictEqual(preBurnResult.stationId, 'NON_ECN_PRE_BURN_IN');

        // Pre-Burn-In -> Hipot
        const pbiMock: any = {
            query: async () => ({ rows: [{ id: 70, serial_number: 'SN-NON-01', status: 'PASS', route: 'NON_ECN' }] })
        };
        const hipotResult = await validateStationEligibility(pbiMock, 'NON_ECN_HIPOT', 'WO-200', 'SN-NON-01');
        assert.strictEqual(hipotResult.eligible, true);
        assert.strictEqual(hipotResult.stationId, 'NON_ECN_HIPOT');

        // Hipot -> Final Post-Burn-In
        const hipotMock: any = {
            query: async () => ({ rows: [{ id: 80, serial_number: 'SN-NON-01', status: 'PASS', route: 'NON_ECN' }] })
        };
        const finalPbiResult = await validateStationEligibility(hipotMock, 'NON_ECN_POST_BURN_IN_FINAL', 'WO-200', 'SN-NON-01');
        assert.strictEqual(finalPbiResult.eligible, true);
        assert.strictEqual(finalPbiResult.stationId, 'NON_ECN_POST_BURN_IN_FINAL');
    });

    test('10. Non-ECN IVI Unit with passed_to_next_stage = true is eligible for Initial Post-Burn-In', async () => {
        const mockClient: any = {
            query: async () => ({
                rows: [{
                    id: 99,
                    serial_number: 'SN-FAIL-OVERRIDE',
                    status: 'FAIL',
                    passed_to_next_stage: true,
                    route: 'NON_ECN'
                }]
            })
        };

        const result = await validateStationEligibility(mockClient, 'NON_ECN_POST_BURN_IN_INITIAL', 'WO-200', 'SN-FAIL-OVERRIDE');
        assert.strictEqual(result.eligible, true);
        assert.strictEqual(result.stationId, 'NON_ECN_POST_BURN_IN_INITIAL');
        assert.strictEqual(result.route, 'NON_ECN');
    });
});
