import pool from '../../config/db';
import { createLogger } from '../../utils/logger';
import { syncSmtWorkOrders } from '../workOrderSyncService';

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
        await syncSmtWorkOrders();
        // Find the stage and previous stage
        const stageRes = await pool.query('SELECT id, stage_order FROM production_stages WHERE stage_code = $1', [stageCode]);

        if (stageRes.rows.length === 0) return { data: [], total: 0 };
        const stageId = stageRes.rows[0].id;
        const stageOrder = stageRes.rows[0].stage_order;
        
        let prevStageIdQuery = 'SELECT id FROM production_stages WHERE stage_order = $1 - 1';
        let prevStageIdRes = await pool.query(prevStageIdQuery, [stageOrder]);
        const prevStageId = prevStageIdRes.rows.length > 0 ? prevStageIdRes.rows[0].id : null;

        // Stage name -> stage_code mapping for selected_stages lookup
        // (selected_stages stores display names; production_stages uses stage_code)
        const STAGE_NAME_TO_CODE: Record<string, string> = {
            'PTH': 'PTH', 'VI': 'VI', 'QA': 'QA',
            'Flashing': 'FLASHING', 'PCBA-FCT': 'PCBA_FCT',
            'Assembly': 'ASSEMBLY', 'Unit Testing': 'UNIT_TESTING',
            'QI': 'QI', 'Packing': 'PACKING'
        };
        // Build a SQL CASE expression mapping display name -> stage_code
        const nameToCaseSql = Object.entries(STAGE_NAME_TO_CODE)
            .map(([name, code]: [string, string]) => `WHEN '${name}' THEN '${code}'`)
            .join(' ');
        // Per-WO subquery: finds the stage_id of the nearest preceding stage
        // that is in this WO's selected_stages, with stage_order < current stage.
        // Falls back to null (= first stage, no prior check needed) if none found.
        const prevStagePerWoSubquery = `
            (
                SELECT ps2.id
                FROM production_stages ps2
                WHERE ps2.stage_order < ${stageOrder}
                  AND ps2.stage_code IN (
                      SELECT CASE elem ${nameToCaseSql} END
                      FROM jsonb_array_elements_text(
                          COALESCE(w.selected_stages, '[]'::jsonb)
                      ) AS elem
                      WHERE CASE elem ${nameToCaseSql} END IS NOT NULL
                  )
                ORDER BY ps2.stage_order DESC
                LIMIT 1
            )
        `;


        let statusFilter = '';
        if (stageCode !== 'REWORK' && stageCode !== 'DEBUG') {
            if (status === 'completed') {
                statusFilter = 'AND COALESCE(p.accepted_qty, 0) >= w.quantity';
            } else if (status === 'pending') {
                statusFilter = 'AND COALESCE(p.accepted_qty, 0) < w.quantity';
            }
        }
        
        let searchFilter = '';
        let searchFilterCount = '';
        const searchParams: any[] = [];
        if (search && search.trim() !== '') {
            searchFilter = `AND (b.batch_number ILIKE $5 OR w.wo_number ILIKE $5 OR w.customer_name ILIKE $5 OR w.model ILIKE $5)`;
            searchFilterCount = `AND (b.batch_number ILIKE $2 OR w.wo_number ILIKE $2 OR w.customer_name ILIKE $2 OR w.model ILIKE $2)`;
            searchParams.push(`%${search.trim()}%`);
        }

        let previousStagePassedQuery = `
            COALESCE(
                (
                    SELECT COUNT(DISTINCT u.barcode)
                    FROM units u
                    JOIN batches pb ON u.batch_id = pb.id
                    WHERE pb.work_order_id = w.id
                      AND (
                          ${prevStagePerWoSubquery} IS NULL
                          OR u.current_stage_id > (${prevStagePerWoSubquery})
                          OR (u.current_stage_id = (${prevStagePerWoSubquery}) AND u.current_status = 'ACCEPTED')
                      )
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
                w.selected_stages as "selectedStages",
                
                (
                    SELECT COUNT(DISTINCT s.barcode)
                    FROM scans s
                    WHERE s.batch_id = b.id 
                      AND s.stage_id = $1 
                      AND (
                          SELECT sf.stage_id 
                          FROM scans sf 
                          WHERE sf.barcode = s.barcode 
                            AND sf.scan_result IN ('REWORK', 'DEBUG') 
                            AND sf.scanned_at < s.scanned_at 
                          ORDER BY sf.scanned_at DESC LIMIT 1
                      ) = ps.id
                ) as scanned,
                
                COUNT(u.barcode) as pending,
                ps.stage_name as "sourceStage",
                ps.id as "failedStageId",
                
                (
                    SELECT COUNT(DISTINCT s.barcode)
                    FROM scans s
                    WHERE s.batch_id = b.id 
                      AND s.stage_id = $1 
                      AND s.scan_result IN ('ACCEPTED', 'RESOLVED')
                      AND (
                          SELECT sf.stage_id 
                          FROM scans sf 
                          WHERE sf.barcode = s.barcode 
                            AND sf.scan_result IN ('REWORK', 'DEBUG') 
                            AND sf.scanned_at < s.scanned_at 
                          ORDER BY sf.scanned_at DESC LIMIT 1
                      ) = ps.id
                ) as passed,
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
              AND (true)
            GROUP BY b.id, w.id, ps.id, ps.stage_name
            ORDER BY b.created_at DESC LIMIT $2::int OFFSET $3::int
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
                w.selected_stages as "selectedStages",
                
                -- Previous Stage Passed calculation
                ${previousStagePassedQuery} as "previousStagePassed",
                
                (
                    SELECT COUNT(DISTINCT s.barcode)
                    FROM scans s
                    WHERE s.batch_id = b.id AND s.stage_id = $1
                ) as scanned,
                
                CASE WHEN (${prevStagePerWoSubquery}) IS NULL THEN
                    GREATEST(0, w.quantity - (
                        SELECT COUNT(DISTINCT s.barcode)
                        FROM scans s
                        WHERE s.batch_id = b.id AND s.stage_id = $1
                    ))
                ELSE
                    (
                        SELECT COUNT(DISTINCT u.barcode)
                        FROM units u
                        WHERE u.batch_id = b.id
                          AND u.barcode NOT IN (
                              SELECT s2.barcode
                              FROM scans s2
                              WHERE s2.batch_id = b.id AND s2.stage_id = $1
                          )
                    )
                END as pending,
                
                NULL as "sourceStage",
                NULL as "failedStageId",
                
                (
                    SELECT COUNT(*)
                    FROM units u
                    WHERE u.batch_id = b.id
                      AND (u.current_stage_id > $1 OR (u.current_stage_id = $1 AND u.current_status = 'ACCEPTED'))
                ) as passed,
                
                (
                    SELECT COUNT(*)
                    FROM units u
                    WHERE u.batch_id = b.id
                      AND u.failed_stage_id = $1
                      AND (u.current_stage_id = $1 OR u.current_stage_id = 10 OR u.current_stage_id = 11)
                      AND u.current_status != 'ACCEPTED'
                      AND (
                          SELECT s.scan_result 
                          FROM scans s 
                          WHERE s.barcode = u.barcode AND s.stage_id = $1 AND s.scan_result IN ('REWORK', 'DEBUG') 
                          ORDER BY s.scanned_at DESC LIMIT 1
                      ) = 'REWORK'
                ) as rework,
                
                (
                    SELECT COUNT(*)
                    FROM units u
                    WHERE u.batch_id = b.id
                      AND u.failed_stage_id = $1
                      AND (u.current_stage_id = $1 OR u.current_stage_id = 10 OR u.current_stage_id = 11)
                      AND u.current_status != 'ACCEPTED'
                      AND (
                          SELECT s.scan_result 
                          FROM scans s 
                          WHERE s.barcode = u.barcode AND s.stage_id = $1 AND s.scan_result IN ('REWORK', 'DEBUG') 
                          ORDER BY s.scanned_at DESC LIMIT 1
                      ) = 'DEBUG'
                ) as debug,
                
                b.status
            FROM batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN batch_stage_progress p ON b.id = p.batch_id AND p.stage_id = $1
            WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilter}
            ORDER BY b.created_at DESC LIMIT $2::int OFFSET $3::int
        `;
        
        const result = await pool.query(query, [stageId, limit, offset, ...searchParams]);
        
        const countQuery = isReworkOrDebug ? `
            SELECT COUNT(DISTINCT b.id || '_' || ps.id) as count
            FROM batches b 
            JOIN work_orders w ON b.work_order_id = w.id
            JOIN units u ON u.batch_id = b.id
            JOIN production_stages ps ON u.failed_stage_id = ps.id
            WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilterCount}
              AND u.current_status = '${stageCode}'
              AND ($1::int IS NULL OR true)
        ` : `
            SELECT COUNT(*) as count FROM batches b 
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN batch_stage_progress p ON b.id = p.batch_id AND p.stage_id = $1
            WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilterCount}
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
