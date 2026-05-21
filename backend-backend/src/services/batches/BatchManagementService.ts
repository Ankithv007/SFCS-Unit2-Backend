import pool from '../../config/db';
import { createLogger } from '../../utils/logger';

const logger = createLogger('BatchManagementService');

export class BatchManagementService {
    static async getOrCreateBatch(
        batchNumber: string, 
        workOrderId: number | null, 
        stageId: number, 
        createdBy: string
    ): Promise<number | null> {
        try {
            const checkQuery = `SELECT id FROM batches WHERE batch_number = $1`;
            const checkResult = await pool.query(checkQuery, [batchNumber]);
            
            let batchId;
            if (checkResult.rows.length === 0) {
                const insertQuery = `
                    INSERT INTO batches (batch_number, work_order_id, created_by, current_stage_id)
                    VALUES ($1, $2, $3, $4) RETURNING id
                `;
                const insertResult = await pool.query(insertQuery, [batchNumber, workOrderId, createdBy, stageId]);
                batchId = insertResult.rows[0].id;
            } else {
                batchId = checkResult.rows[0].id;
                await pool.query(`UPDATE batches SET current_stage_id = $1 WHERE id = $2`, [stageId, batchId]);
            }

            const trackingQuery = `SELECT id FROM batch_stage_progress WHERE batch_id = $1 AND stage_id = $2`;
            const trackingResult = await pool.query(trackingQuery, [batchId, stageId]);

            if (trackingResult.rows.length === 0) {
                const insertTrackingQuery = `
                    INSERT INTO batch_stage_progress (batch_id, stage_id)
                    VALUES ($1, $2)
                `;
                await pool.query(insertTrackingQuery, [batchId, stageId]);
            }

            return batchId;
        } catch (error: any) {
            logger.error(`Error in getOrCreateBatch: ${error.message}`);
            throw error;
        }
    }

    static async incrementBatchMetrics(batchId: number, stageId: number, status: string): Promise<void> {
        try {
            let colToIncrement = 'scanned_qty';
            if (status.toUpperCase() === 'ACCEPTED') colToIncrement = 'accepted_qty';
            else if (status.toUpperCase() === 'FAILED' || status.toUpperCase() === 'SCRAP') colToIncrement = 'failed_qty';
            else if (status.toUpperCase() === 'REWORK') colToIncrement = 'rework_qty';
            else if (status.toUpperCase() === 'DEBUG') colToIncrement = 'debug_qty';

            const updateQuery = `
                UPDATE batch_stage_progress 
                SET scanned_qty = scanned_qty + 1,
                    ${colToIncrement} = ${colToIncrement} + 1
                WHERE batch_id = $1 AND stage_id = $2
            `;
            await pool.query(updateQuery, [batchId, stageId]);
        } catch (error: any) {
            logger.error(`Error in incrementBatchMetrics: ${error.message}`);
            throw error;
        }
    }

    static async getBatchesByStage(stageCode: string, limit: number, offset: number, status?: string, search?: string) {
        // Find the stage and previous stage
        const stageRes = await pool.query('SELECT id, stage_order FROM production_stages WHERE stage_code = $1', [stageCode]);
        if (stageRes.rows.length === 0) return { data: [], total: 0 };
        const stageId = stageRes.rows[0].id;
        const stageOrder = stageRes.rows[0].stage_order;
        
        let prevStageIdQuery = 'SELECT id FROM production_stages WHERE stage_order = $1 - 1';
        let prevStageIdRes = await pool.query(prevStageIdQuery, [stageOrder]);
        const prevStageId = prevStageIdRes.rows.length > 0 ? prevStageIdRes.rows[0].id : null;

        let statusFilter = '';
        if (status === 'completed') {
            statusFilter = 'AND COALESCE(p.accepted_qty, 0) >= w.quantity';
        } else if (status === 'pending') {
            statusFilter = 'AND COALESCE(p.accepted_qty, 0) < w.quantity';
        }
        
        let searchFilter = '';
        const searchParams: any[] = [];
        if (search && search.trim() !== '') {
            searchFilter = `AND (b.batch_number ILIKE $5 OR w.wo_number ILIKE $5 OR w.customer_name ILIKE $5 OR w.model ILIKE $5)`;
            searchParams.push(`%${search.trim()}%`);
        }

        let previousStagePassedQuery = `
            COALESCE(
                (
                    SELECT COUNT(DISTINCT u.barcode) 
                    FROM units u 
                    JOIN batches pb ON u.batch_id = pb.id 
                    WHERE pb.work_order_id = w.id 
                      AND ($4::int IS NULL OR u.current_stage_id >= $4::int)
                ), w.quantity
            )
        `;

        if (stageCode === 'REWORK') {
            previousStagePassedQuery = `
                COALESCE(
                    (
                        SELECT SUM(p2.rework_qty) 
                        FROM batch_stage_progress p2 
                        JOIN batches b2 ON p2.batch_id = b2.id 
                        WHERE b2.work_order_id = w.id
                          AND ($4::int IS NULL OR true)
                    ), 0
                )
            `;
        } else if (stageCode === 'DEBUG') {
            previousStagePassedQuery = `
                COALESCE(
                    (
                        SELECT SUM(p2.debug_qty) 
                        FROM batch_stage_progress p2 
                        JOIN batches b2 ON p2.batch_id = b2.id 
                        WHERE b2.work_order_id = w.id
                          AND ($4::int IS NULL OR true)
                    ), 0
                )
            `;
        }

        const isReworkOrDebug = stageCode === 'REWORK' || stageCode === 'DEBUG';

        const query = isReworkOrDebug ? `
            SELECT 
                b.id, 
                b.batch_number, 
                b.work_order_id, 
                b.created_at, 
                b.created_by, 
                b.is_deleted,
                w.wo_number, 
                w.customer_name,
                w.model,
                w.quantity as "workOrderQty",
                
                0 as "previousStagePassed",
                0 as scanned,
                
                COUNT(u.barcode) as pending,
                ps.stage_name as "sourceStage",
                ps.id as "failedStageId",
                
                0 as passed,
                COUNT(u.barcode) as rework,
                COUNT(u.barcode) as debug,
                b.status
            FROM batches b
            JOIN work_orders w ON b.work_order_id = w.id
            JOIN units u ON u.batch_id = b.id
            JOIN production_stages ps ON u.failed_stage_id = ps.id
            WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilter}
              AND u.current_status = '${stageCode}'
              AND ($1::int IS NULL OR true)
              AND ($4::int IS NULL OR true)
            GROUP BY b.id, w.id, ps.id, ps.stage_name
            ORDER BY b.created_at DESC LIMIT $2 OFFSET $3
        ` : `
            SELECT 
                b.id, 
                b.batch_number, 
                b.work_order_id, 
                b.created_at, 
                b.created_by, 
                b.is_deleted,
                w.wo_number, 
                w.customer_name,
                w.model,
                w.quantity as "workOrderQty",
                
                -- Previous Stage Passed calculation
                ${previousStagePassedQuery} as "previousStagePassed",
                
                COALESCE(p.scanned_qty, 0) as scanned,
                
                (
                    SELECT COUNT(u.barcode)
                    FROM units u
                    JOIN batches b3 ON u.batch_id = b3.id
                    WHERE b3.work_order_id = w.id AND u.current_stage_id = $1 AND u.current_status = 'PENDING'
                ) as pending,
                NULL as "sourceStage",
                NULL as "failedStageId",
                
                COALESCE(p.accepted_qty, 0) as passed,
                (
                    SELECT COUNT(u.barcode)
                    FROM units u
                    JOIN batches b3 ON u.batch_id = b3.id
                    WHERE b3.work_order_id = w.id AND u.current_stage_id = $1 AND u.current_status = 'REWORK'
                ) as rework,
                (
                    SELECT COUNT(u.barcode)
                    FROM units u
                    JOIN batches b3 ON u.batch_id = b3.id
                    WHERE b3.work_order_id = w.id AND u.current_stage_id = $1 AND u.current_status = 'DEBUG'
                ) as debug,
                b.status
            FROM batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN batch_stage_progress p ON b.id = p.batch_id AND p.stage_id = $1
            WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilter}
            ORDER BY b.created_at DESC LIMIT $2 OFFSET $3
        `;
        
        const result = await pool.query(query, [stageId, limit, offset, prevStageId, ...searchParams]);
        
        const countQuery = isReworkOrDebug ? `
            SELECT COUNT(DISTINCT b.id || '_' || ps.id) as count
            FROM batches b 
            JOIN work_orders w ON b.work_order_id = w.id
            JOIN units u ON u.batch_id = b.id
            JOIN production_stages ps ON u.failed_stage_id = ps.id
            WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilter}
              AND u.current_status = '${stageCode}'
              AND ($1::int IS NULL OR true)
        ` : `
            SELECT COUNT(*) as count FROM batches b 
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN batch_stage_progress p ON b.id = p.batch_id AND p.stage_id = $1
            WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilter}
        `;
        
        const countRes = await pool.query(countQuery, searchParams.length > 0 ? [stageId, searchParams[0]] : [stageId]);

        return {
            data: result.rows,
            total: parseInt(countRes.rows[0].count)
        };
    }

    static async completeBatch(id: string) {
        await pool.query("UPDATE batches SET status = 'COMPLETED' WHERE id = $1", [id]);
    }

    static async deleteBatch(id: string, deletedBy: string) {
        await pool.query("UPDATE batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2", [deletedBy, id]);
    }
}
