import { PoolClient } from 'pg';
import { StationId } from '../common/stationRegistry';
import { WorkflowEngine } from '../common/workflowEngine';
import { EligibilityResult } from '../common/transitionValidator';

/**
 * Validates whether an ECN unit is eligible to enter the specified ECN station.
 */
export async function verifyEcnStationEligibility(
    client: PoolClient,
    stationId: StationId,
    workOrderId: string,
    serialNumber: string
): Promise<EligibilityResult> {
    return WorkflowEngine.verifyTransition(client, stationId, workOrderId, serialNumber);
}
