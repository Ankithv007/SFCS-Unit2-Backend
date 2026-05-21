import pool from '../../config/db';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TraceabilityService');

export class TraceabilityService {
    static async updateUnitState(
        barcode: string,
        batchId: number | null,
        stageId: number,
        status: string,
        updatedBy: string
    ): Promise<void> {
        try {
            const checkResult = await pool.query(`SELECT id FROM units WHERE barcode = $1`, [barcode]);
            const isFailure = ['FAILED', 'REWORK', 'DEBUG'].includes(status.toUpperCase());
            const isRepairTransition = ['REWORK', 'DEBUG'].includes(status.toUpperCase());
            
            if (checkResult.rows.length === 0) {
                const insertQuery = `
                    INSERT INTO units 
                    (barcode, batch_id, current_stage_id, current_status, last_scanned_at, last_scanned_by)
                    VALUES ($1, $2, $3, $4, NOW(), $5)
                `;
                await pool.query(insertQuery, [barcode, batchId, stageId, status, updatedBy]);
            } else {
                const updateQuery = `
                    UPDATE units 
                    SET batch_id = COALESCE($1, batch_id),
                        current_stage_id = $2,
                        current_status = $3,
                        ${isFailure ? 'failed_stage_id = $2,' : ''}
                        ${isRepairTransition ? 'repair_count = repair_count + 1,' : ''}
                        last_scanned_at = NOW(),
                        last_scanned_by = $4,
                        updated_at = NOW()
                    WHERE barcode = $5
                `;
                await pool.query(updateQuery, [batchId, stageId, status, updatedBy, barcode]);
            }
        } catch (error: any) {
            logger.error(`Error in updateUnitState: ${error.message}`);
            throw error;
        }
    }
}
