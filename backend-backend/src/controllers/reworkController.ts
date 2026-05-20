import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by } = req.body;
        if (!work_order_id) return sendError(res, "work_order_id is required");
        if (!created_by) return sendError(res, "created_by is required");
        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) return sendError(res, "Work Order not found", 404);
        const batch_number = woResult.rows[0].wo_number;
        const result = await pool.query(
            `INSERT INTO rework_batches (work_order_id, batch_number, created_by) VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        return sendSuccess(res, "Batch created successfully", result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') return sendError(res, "Batch for this Work Order already exists");
        return sendError(res, err.message, 500);
    }
};

export const getBatches = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search as string;

    try {
        const queryParams: any[] = [];
        let searchCondition = '';
        if (search) {
            queryParams.push(`%${search}%`);
            searchCondition = `AND (w.wo_number ILIKE $1 OR b.batch_number ILIKE $1 OR w.model ILIKE $1)`;
        }

        const baseQuery = `
            SELECT 
                b.id, b.batch_number, b.work_order_id, b.created_at, b.created_by,
                w.wo_number, w.customer_name, w.model, w.quantity as "workOrderQty",
                ps.stage_name as "sourceStage",
                COUNT(bt.id)::int as rework,
                0 as debug, 0 as passed, 'in_progress' as status
            FROM rework_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            JOIN master_batches mb ON mb.work_order_id = w.id
            JOIN barcode_tracking bt ON bt.batch_id = mb.id
            JOIN production_stages ps ON bt.failed_stage_id = ps.id
            WHERE b.is_deleted = FALSE 
              AND bt.current_stage_id = (SELECT id FROM production_stages WHERE LOWER(stage_name) = 'rework' LIMIT 1)
              AND bt.current_status = 'REWORK'
              ${searchCondition}
            GROUP BY b.id, w.wo_number, w.customer_name, w.model, w.quantity, ps.stage_name`;

        const countResult = await pool.query(`SELECT COUNT(*) FROM (${baseQuery}) as t`, queryParams);
        const total = parseInt(countResult.rows[0].count);
        const paginatedQuery = `${baseQuery} ORDER BY b.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        const result = await pool.query(paginatedQuery, [...queryParams, limit, offset]);
        return res.status(200).json({ data: result.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (err: any) {
        console.error("Error in rework getBatches:", err);
        return sendError(res, err.message, 500);
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body;
    try {
        await pool.query("UPDATE rework_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2", [deleted_by || 'system', id]);
        return sendSuccess(res, "Batch soft deleted");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const createReworkScan = async (req: Request, res: Response) => {
    const { batch_id, barcode: inputBarcode, scanned_by, status, remarks, failed_at, failed_remarks } = req.body;
    
    if (!remarks || typeof remarks !== 'string' || !remarks.trim()) {
        return sendError(res, "Repair remark is mandatory to complete rework.", 400);
    }

    const cleanRemarks = remarks.trim();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // --- USN Resolution ---
        // Boards from Assembly+ use Unit Serial Number. Boards from PTH-PCBA-FCT use PCB barcode.
        // Try to resolve as USN first; if not found, treat as PCB barcode directly.
        const usnCheck = await client.query(
            `SELECT barcode, unit_serial_number FROM unit_serial_mapping WHERE unit_serial_number = $1`,
            [(inputBarcode || '').trim().toUpperCase()]
        );
        const resolvedBarcode = (usnCheck.rowCount ?? 0) > 0 ? usnCheck.rows[0].barcode : (inputBarcode || '').trim().toUpperCase();
        const resolvedUSN: string | null = (usnCheck.rowCount ?? 0) > 0 ? usnCheck.rows[0].unit_serial_number : null;

        // Lock barcode tracking row
        await client.query("SELECT * FROM barcode_tracking WHERE barcode = $1 FOR UPDATE", [resolvedBarcode]);

        const checkResult = await client.query(`
            SELECT bt.barcode, bt.failed_stage_id, ps.stage_name
            FROM barcode_tracking bt
            JOIN production_stages ps ON bt.failed_stage_id = ps.id
            WHERE bt.barcode = $1 
              AND bt.current_stage_id = (SELECT id FROM production_stages WHERE LOWER(stage_name) = 'rework' LIMIT 1)
              AND bt.current_status = 'REWORK'`, [resolvedBarcode]);

        if (checkResult.rowCount === 0) {
            throw new Error("This barcode is not in REWORK state or already resolved.");
        }

        const failedStageId = checkResult.rows[0].failed_stage_id;
        const originStation = (checkResult.rows[0].stage_name || 'PTH').toUpperCase();

        const updateTable = (originStation === 'PCBA-FCT' ? 'pcba_fct_scans' :
                            originStation === 'UNIT TESTING' ? 'unit_testing_scans' :
                            originStation.toLowerCase().replace(/[ -]/g, '_') + '_scans');

        const failedRecordRes = await client.query(
            `SELECT scanned_at, remarks FROM ${updateTable} WHERE barcode = $1 AND status IN ('rework', 'REWORK') ORDER BY scanned_at DESC LIMIT 1`,
            [resolvedBarcode]
        );
        const originalFailedAt = failedRecordRes.rows[0]?.scanned_at || new Date();
        const originalFailedRemarks = failedRecordRes.rows[0]?.remarks || '-';

        const result = await client.query(
            `INSERT INTO rework_scans (batch_id, barcode, unit_serial_number, scanned_by, status, remarks, stage, failed_at, failed_remarks, repair_remark, repair_time)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP) RETURNING *`,
            [batch_id, resolvedBarcode, resolvedUSN, scanned_by, 'ACCEPTED', cleanRemarks, originStation, originalFailedAt, originalFailedRemarks, cleanRemarks]
        );

        await client.query(
            `UPDATE ${updateTable} SET resolution_remarks = 'Fixed', repair_time = CURRENT_TIMESTAMP, repair_remark = $1 WHERE barcode = $2 AND status IN ('rework', 'REWORK')`,
            [cleanRemarks, resolvedBarcode]
        );

        await client.query(
            "UPDATE barcode_tracking SET current_stage_id = $1, current_status = 'READY_FOR_RESCAN', last_updated_at = CURRENT_TIMESTAMP, last_updated_by = $2, repair_completed_at = CURRENT_TIMESTAMP WHERE barcode = $3",
            [failedStageId, scanned_by, resolvedBarcode]
        );

        await client.query('COMMIT');
        return sendSuccess(res, "Item resolved and returned to " + originStation, result.rows[0]);
    } catch (err: any) {
        await client.query('ROLLBACK');
        return sendError(res, err.message, 500);
    } finally {
        client.release();
    }
};

export const getScans = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    try {
        const result = await pool.query(
            `SELECT * FROM rework_scans WHERE batch_id = $1 ORDER BY scanned_at DESC`,
            [batch_id]
        );
        return sendSuccess(res, "Scans fetched", result.rows);
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};
