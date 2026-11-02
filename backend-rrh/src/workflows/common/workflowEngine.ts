import { PoolClient } from 'pg';
import { StationId, RouteType, STATION_REGISTRY } from './stationRegistry';
import { validateStationEligibility, EligibilityResult } from './transitionValidator';
import { createLogger } from '../../utils/logger';

const logger = createLogger('WorkflowEngine');

export class WorkflowEngine {
    /**
     * Authoritatively validates station eligibility on the server.
     * Prevents clients from forcing transitions, bypassing stations, or mixing ECN and Non-ECN records.
     */
    public static async verifyTransition(
        client: PoolClient,
        stationId: StationId,
        workOrderId: string,
        serialNumber: string
    ): Promise<EligibilityResult> {
        const station = STATION_REGISTRY[stationId];
        if (!station) {
            throw new Error(`Invalid manufacturing station: ${stationId}`);
        }

        logger.info(`Evaluating MES station transition to ${stationId} for WO=${workOrderId}, Serial=${serialNumber}`);
        const result = await validateStationEligibility(client, stationId, workOrderId, serialNumber);

        if (!result.eligible) {
            logger.warn(`MES Transition REJECTED: Station=${stationId}, WO=${workOrderId}, Serial=${serialNumber}. Reason: ${result.reason}`);
        } else {
            logger.info(`MES Transition APPROVED: Station=${stationId}, WO=${workOrderId}, Serial=${serialNumber}`);
        }

        return result;
    }

    /**
     * Checks if a serial has already been scanned in the current session.
     */
    public static async checkDuplicateScan(
        client: PoolClient,
        inspectionTable: string,
        sessionId: number,
        serialNumber: string
    ): Promise<boolean> {
        const res = await client.query(
            `SELECT id FROM ${inspectionTable}
             WHERE session_id = $1
               AND UPPER(TRIM(serial_number)) = UPPER(TRIM($2))
               AND is_deleted = false
             LIMIT 1`,
            [sessionId, serialNumber]
        );
        return res.rows.length > 0;
    }
}
