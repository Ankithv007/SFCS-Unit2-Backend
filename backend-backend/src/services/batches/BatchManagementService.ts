import pool from '../../config/db';
import { createLogger } from '../../utils/logger';
import { syncSmtWorkOrders, syncSingleWorkOrder } from '../workOrderSyncService';
import { WorkflowEngineService } from '../workflow/WorkflowEngineService';

const logger = createLogger('BatchManagementService');

export class BatchManagementService {
    static async getOrCreateBatch(
        batchNumber: string, 
        workOrderId: number | null, 
        stageId: number, 
        createdBy: string
    ): Promise<number | null> {
        try {
            if (workOrderId) {
                const woCheck = await pool.query('SELECT id, selected_stages FROM work_orders WHERE id = $1', [workOrderId]);
                if (woCheck.rows.length === 0 || !woCheck.rows[0].selected_stages) {
                    await syncSingleWorkOrder(workOrderId);
                }
            }

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

        // 1. Resolve stage using cached production stages
        const allStages = await WorkflowEngineService.getAllProductionStages();
        const stage = WorkflowEngineService.matchStageToProductionStage(stageCode, allStages) 
            || allStages.find(s => s.stage_code.toUpperCase() === stageCode.toUpperCase() || s.stage_name.toUpperCase() === stageCode.toUpperCase());

        if (!stage) return { data: [], total: 0 };
        const stageId = stage.id;
        const stageName = stage.stage_name;

        const isReworkOrDebug = stageCode === 'REWORK' || stageCode === 'DEBUG';

        // Filter batches so standard stage pages only show Work Orders that selected this stage (or legacy NULL)
        const stageInRoutingFilter = isReworkOrDebug ? '' : `
            AND (
                w.selected_stages IS NULL
                OR jsonb_typeof(w.selected_stages) != 'array'
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text(w.selected_stages) AS elem
                    WHERE UPPER(REPLACE(REPLACE(REPLACE(elem, '-', ''), '_', ''), ' ', '')) = UPPER(REPLACE(REPLACE(REPLACE('${stageCode}', '-', ''), '_', ''), ' ', ''))
                       OR UPPER(elem) = UPPER('${stageName}')
                )
            )
        `;

        let statusFilter = '';
        if (!isReworkOrDebug) {
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
            searchFilter = `AND (b.batch_number ILIKE $4 OR w.wo_number ILIKE $4 OR w.customer_name ILIKE $4 OR w.model ILIKE $4)`;
            searchFilterCount = `AND (b.batch_number ILIKE $2 OR w.wo_number ILIKE $2 OR w.customer_name ILIKE $2 OR w.model ILIKE $2)`;
            searchParams.push(`%${search.trim()}%`);
        }

        if (isReworkOrDebug) {
            const query = `
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
                GROUP BY b.id, w.id, ps.id, ps.stage_name
                ORDER BY b.created_at DESC LIMIT $2::int OFFSET $3::int
            `;
            const result = await pool.query(query, [stageId, limit, offset, ...searchParams]);

            const countQuery = `
                SELECT COUNT(DISTINCT b.id || '_' || ps.id) as count
                FROM batches b 
                JOIN work_orders w ON b.work_order_id = w.id
                JOIN units u ON u.batch_id = b.id
                JOIN production_stages ps ON u.failed_stage_id = ps.id
                WHERE b.is_deleted = FALSE ${statusFilter} ${searchFilterCount}
                  AND u.current_status = '${stageCode}'
                  AND ($1::int IS NULL OR true)
            `;
            const countRes = await pool.query(countQuery, searchParams.length > 0 ? [stageId, searchParams[0]] : [stageId]);

            return {
                data: result.rows,
                total: parseInt(countRes.rows[0]?.count || '0')
            };
        }

        // Standard stage query: ultra-fast set-based paginated lookup
        const query = `
            SELECT 
                b.id, 
                b.batch_number, 
                b.work_order_id, 
                b.created_at, 
                b.created_by, 
                b.is_deleted,
                b.status,
                w.wo_number, 
                w.customer_name, 
                w.model, 
                w.quantity as "workOrderQty", 
                w.selected_stages as "selectedStages",
                COALESCE(p.scanned_qty, 0) as p_scanned,
                COALESCE(p.accepted_qty, 0) as p_accepted,
                COALESCE(p.rework_qty, 0) as p_rework,
                COALESCE(p.debug_qty, 0) as p_debug
            FROM batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN batch_stage_progress p ON b.id = p.batch_id AND p.stage_id = $1
            WHERE b.is_deleted = FALSE ${statusFilter} ${stageInRoutingFilter} ${searchFilter}
            ORDER BY b.created_at DESC LIMIT $2::int OFFSET $3::int
        `;

        const [result, countRes] = await Promise.all([
            pool.query(query, [stageId, limit, offset, ...searchParams]),
            pool.query(`
                SELECT COUNT(*) as count FROM batches b 
                JOIN work_orders w ON b.work_order_id = w.id
                LEFT JOIN batch_stage_progress p ON b.id = p.batch_id AND p.stage_id = $1
                WHERE b.is_deleted = FALSE ${statusFilter} ${stageInRoutingFilter} ${searchFilterCount}
            `, searchParams.length > 0 ? [stageId, searchParams[0]] : [stageId])
        ]);

        const total = parseInt(countRes.rows[0]?.count || '0');
        if (result.rows.length === 0) {
            return { data: [], total };
        }

        const batchIds = result.rows.map(r => r.id);

        // Fetch metrics for just the returned page of batches in parallel
        const [scansRes, unitsRes, progressRes, unitsByStageRes] = await Promise.all([
            pool.query(`
                SELECT batch_id, COUNT(DISTINCT barcode) as scan_count
                FROM scans
                WHERE batch_id = ANY($1::int[]) AND stage_id = $2
                GROUP BY batch_id
            `, [batchIds, stageId]),

            pool.query(`
                SELECT batch_id,
                       COUNT(*) FILTER (WHERE current_stage_id > $2 OR (current_stage_id = $2 AND current_status = 'ACCEPTED')) as passed_count,
                       COUNT(*) FILTER (WHERE failed_stage_id = $2 AND (current_stage_id = $2 OR current_stage_id IN (10, 11)) AND current_status = 'REWORK') as rework_count,
                       COUNT(*) FILTER (WHERE failed_stage_id = $2 AND (current_stage_id = $2 OR current_stage_id IN (10, 11)) AND current_status = 'DEBUG') as debug_count
                FROM units
                WHERE batch_id = ANY($1::int[])
                GROUP BY batch_id
            `, [batchIds, stageId]),

            pool.query(`
                SELECT batch_id, stage_id, accepted_qty, scanned_qty
                FROM batch_stage_progress
                WHERE batch_id = ANY($1::int[])
            `, [batchIds]),

            pool.query(`
                SELECT batch_id, current_stage_id, current_status, COUNT(DISTINCT barcode) as cnt
                FROM units
                WHERE batch_id = ANY($1::int[])
                GROUP BY batch_id, current_stage_id, current_status
            `, [batchIds])
        ]);

        const scanMap = new Map<number, number>();
        for (const r of scansRes.rows) {
            scanMap.set(r.batch_id, parseInt(r.scan_count || '0'));
        }

        const unitsMap = new Map<number, any>();
        for (const r of unitsRes.rows) {
            unitsMap.set(r.batch_id, {
                passed_count: parseInt(r.passed_count || '0'),
                rework_count: parseInt(r.rework_count || '0'),
                debug_count: parseInt(r.debug_count || '0'),
            });
        }

        const progressMap = new Map<string, { accepted_qty: number; scanned_qty: number }>();
        for (const r of progressRes.rows) {
            progressMap.set(`${r.batch_id}_${r.stage_id}`, {
                accepted_qty: parseInt(r.accepted_qty || '0'),
                scanned_qty: parseInt(r.scanned_qty || '0')
            });
        }

        // Format and calculate active-route previousStagePassed and pending
        const data = await Promise.all(result.rows.map(async (row) => {
            const batchId = row.id;
            const workOrderQty = Number(row.workOrderQty) || 0;
            const selectedStages = row.selectedStages;

            const scannedCount = scanMap.get(batchId) || 0;
            const scanned = Math.max(Number(row.p_scanned) || 0, scannedCount);

            const uMetric = unitsMap.get(batchId);
            const passedCount = uMetric ? Number(uMetric.passed_count) || 0 : 0;
            const passed = Math.max(Number(row.p_accepted) || 0, passedCount);

            const rework = uMetric ? Number(uMetric.rework_count) || 0 : (Number(row.p_rework) || 0);
            const debug = uMetric ? Number(uMetric.debug_count) || 0 : (Number(row.p_debug) || 0);

            // Dynamic route-aware previous stage resolution
            const prevStage = await WorkflowEngineService.getPreviousStage(stageId, {
                workOrderId: row.work_order_id,
                selectedStages: selectedStages
            });

            let previousStagePassed = workOrderQty;
            if (prevStage) {
                const prevProg = progressMap.get(`${batchId}_${prevStage.id}`);
                const prevProgAccepted = prevProg ? Number(prevProg.accepted_qty) || 0 : 0;

                let prevUnitsPassed = 0;
                for (const u of unitsByStageRes.rows) {
                    if (u.batch_id === batchId) {
                        if (u.current_stage_id > prevStage.id || (u.current_stage_id === prevStage.id && u.current_status === 'ACCEPTED')) {
                            prevUnitsPassed += Number(u.cnt) || 0;
                        }
                    }
                }
                previousStagePassed = Math.max(prevProgAccepted, prevUnitsPassed);
            }

            const pending = Math.max(0, previousStagePassed - scanned);

            return {
                id: row.id,
                batch_number: row.batch_number,
                work_order_id: row.work_order_id,
                created_at: row.created_at,
                created_by: row.created_by,
                is_deleted: row.is_deleted,
                wo_number: row.wo_number,
                customer_name: row.customer_name,
                model: row.model,
                workOrderQty,
                selectedStages,
                previousStagePassed,
                scanned,
                pending,
                sourceStage: null,
                failedStageId: null,
                passed,
                rework,
                debug,
                status: row.status
            };
        }));

        return { data, total };
    }

    static async completeBatch(id: string) {
        await pool.query("UPDATE batches SET status = 'COMPLETED' WHERE id = $1", [id]);
    }

    static async deleteBatch(id: string, deletedBy: string) {
        await pool.query("UPDATE batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2", [deletedBy, id]);
    }
}
