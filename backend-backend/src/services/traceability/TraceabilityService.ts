import pool from '../../config/db';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TraceabilityService');

export class TraceabilityService {
    static async updateUnitState(
        barcode: string,
        batchId: number | null,
        stageId: number,
        status: string,
        updatedBy: string,
        remarks?: string,
        dbClient?: any
    ): Promise<void> {
        const db = dbClient || pool;
        try {
            const checkResult = await db.query(`SELECT id FROM units WHERE barcode = $1`, [barcode]);
            const isFailure = ['FAILED', 'REWORK', 'DEBUG'].includes(status.toUpperCase());
            const isRepairTransition = ['REWORK', 'DEBUG'].includes(status.toUpperCase());
            
            if (checkResult.rows.length === 0) {
                const insertQuery = `
                    INSERT INTO units 
                    (barcode, batch_id, current_stage_id, current_status, failed_stage_id, repair_count, failure_remark, failed_at, last_scanned_at, last_scanned_by)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, ${isFailure ? 'NOW()' : 'NULL'}, NOW(), $8)
                `;
                await db.query(insertQuery, [barcode, batchId, stageId, status, isFailure ? stageId : null, isRepairTransition ? 1 : 0, isFailure ? remarks : null, updatedBy]);
            } else {
                // If it is a failure transition, we record failure_remark and failed_at.
                // If the scanning stage is Rework/Debug and it's resolved, we record repair_remark.
                // Note: isFailure = 'REWORK' or 'DEBUG' scans. 
                // Repair completion (RESOLVED/ACCEPTED) will NOT trigger isFailure, so we can save it as repair_remark.
                const isRepairCompletion = ['RESOLVED', 'ACCEPTED'].includes(status.toUpperCase());
                const isReworkOrDebugStage = [10, 11].includes(stageId);

                const updateQuery = `
                    UPDATE units 
                    SET batch_id = COALESCE($1, batch_id),
                        current_stage_id = $2,
                        current_status = $3,
                        ${(isFailure && !isReworkOrDebugStage) ? 'failed_stage_id = $2, failed_at = NOW(), failure_remark = $6,' : ''}
                        ${isRepairCompletion ? 'repair_remark = $6,' : ''}
                        ${isRepairTransition ? 'repair_count = repair_count + 1,' : ''}
                        last_scanned_at = NOW(),
                        last_scanned_by = $4,
                        updated_at = NOW()
                    WHERE barcode = $5
                `;
                
                const queryParams = [batchId, stageId, status, updatedBy, barcode];
                if ((isFailure && !isReworkOrDebugStage) || isRepairCompletion) {
                    queryParams.push(remarks || null);
                }
                
                await db.query(updateQuery, queryParams);
            }

        } catch (error: any) {
            logger.error(`Error in updateUnitState: ${error.message}`);
            throw error;
        }
    }
}
