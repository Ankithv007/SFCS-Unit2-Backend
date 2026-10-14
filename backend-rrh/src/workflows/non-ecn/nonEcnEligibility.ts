import { PoolClient } from 'pg';
import { StationId } from '../common/stationRegistry';
import { WorkflowEngine } from '../common/workflowEngine';
import { EligibilityResult } from '../common/transitionValidator';

/**
 * Validates whether a Non-ECN unit is eligible to enter the specified Non-ECN station.
 */
export async function verifyNonEcnStationEligibility(
    client: PoolClient,
    stationId: StationId,
    workOrderId: string,
    serialNumber: string
): Promise<EligibilityResult> {
    return WorkflowEngine.verifyTransition(client, stationId, workOrderId, serialNumber);
}
