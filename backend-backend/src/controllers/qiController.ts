import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';
import { processMESScan, resolveUnitSerial } from '../utils/mesLogic';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by } = req.body;
        if (!work_order_id) return sendError(res, "work_order_id is required");
        if (!created_by) return sendError(res, "created_by is required");
        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) return sendError(res, "Work Order not found", 404);
        const batch_number = woResult.rows[0].wo_number;
        const result = await pool.query(
            `INSERT INTO qi_batches (work_order_id, batch_number, created_by) VALUES ($1, $2, $3) RETURNING *`,
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
    const statusFilter = req.query.status as string;
    const search = req.query.search as string;

    try {
        let baseQuery = `
            SELECT * FROM (
                SELECT 
                b.id, b.batch_number, b.work_order_id, b.created_at, b.created_by, b.is_deleted,
                w.wo_number, w.customer_name, w.model, w.quantity as "workOrderQty",
                (SELECT COUNT(DISTINCT ps.barcode) FROM unit_testing_scans ps JOIN unit_testing_batches pb ON ps.batch_id = pb.id WHERE pb.work_order_id = w.id AND ps.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED')) as "previousStagePassed",
                stats.scanned,
                ((SELECT COUNT(DISTINCT ps.barcode) FROM unit_testing_scans ps JOIN unit_testing_batches pb ON ps.batch_id = pb.id WHERE pb.work_order_id = w.id AND ps.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED')) - stats.scanned) as pending,
                stats.passed, stats.rework, stats.debug, b.status
            FROM qi_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN LATERAL (
                WITH latest_scans AS (
                    SELECT DISTINCT ON (barcode) status FROM qi_scans WHERE batch_id = b.id ORDER BY barcode, scanned_at DESC
                )
                SELECT COUNT(*)::int as scanned,
                    COUNT(*) FILTER (WHERE status = 'ACCEPTED')::int as passed,
                    COUNT(*) FILTER (WHERE status = 'REWORK')::int as rework,
                    COUNT(*) FILTER (WHERE status = 'DEBUG')::int as debug
                FROM latest_scans
            ) stats ON TRUE
            WHERE b.is_deleted = FALSE
            ) as t`;

        let whereClause = '';
        const conditions: string[] = [];
        const queryParams: any[] = [];
        if (statusFilter) conditions.push(statusFilter === 'completed' ? "t.status = 'completed'" : "t.status != 'completed'");
        if (search) {
            queryParams.push(`%${search}%`);
            conditions.push(`(t.wo_number ILIKE $${queryParams.length} OR t.batch_number ILIKE $${queryParams.length} OR t.model ILIKE $${queryParams.length})`);
        }
        if (conditions.length > 0) whereClause = ' WHERE ' + conditions.join(' AND ');

        const countResult = await pool.query(`SELECT COUNT(*) FROM (${baseQuery}) as t ${whereClause}`, queryParams);
        const total = parseInt(countResult.rows[0].count);
        const result = await pool.query(`SELECT * FROM (${baseQuery}) as t ${whereClause} ORDER BY t.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`, [...queryParams, limit, offset]);
        return res.status(200).json({ data: result.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (err: any) {
        console.error("Error in getBatches for qiController.ts:", err);
        return sendError(res, err.message, 500);
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body;
    try {
        await pool.query("UPDATE qi_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2", [deleted_by || 'system', id]);
        return sendSuccess(res, "Batch soft deleted");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const createQiScan = async (req: Request, res: Response) => {
    const { work_order_id, batch_id, barcode: inputBarcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const usnResolved = await resolveUnitSerial(client, inputBarcode);
        if (!usnResolved) {
            throw new Error("Invalid scan. QI only accepts the Unit Serial Number sticker. Please scan the Unit Serial Number.");
        }
        const { pcb_barcode, unit_serial_number } = usnResolved;

        const scanResult = await processMESScan({
            client, batch_id, barcode: pcb_barcode, scanned_by, status, remarks,
            resolution_remarks, failed_at, failed_remarks,
            stage_id: 8, prev_stage_id: 7,
            batch_table: 'qi_batches', scans_table: 'qi_scans',
            work_order_id, unit_serial_number
        });

        const statsResult = await client.query(`
            SELECT w.quantity as "workOrderQty",
                (SELECT COUNT(DISTINCT ps.barcode) FROM unit_testing_scans ps JOIN unit_testing_batches pb ON ps.batch_id = pb.id WHERE pb.work_order_id = w.id AND ps.status IN ('accepted','ACCEPTED','passed','PASSED')) as "previousStagePassed",
                stats.scanned, (w.quantity - stats.scanned) as pending, stats.passed, stats.rework, stats.debug, b.status
            FROM qi_batches b JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN LATERAL (
                WITH latest_scans AS (SELECT DISTINCT ON (s.barcode) s.status FROM qi_scans s JOIN qi_batches pb ON s.batch_id = pb.id WHERE pb.work_order_id = w.id ORDER BY s.barcode, s.scanned_at DESC)
                SELECT COUNT(*)::int as scanned, COUNT(*) FILTER (WHERE status IN ('accepted','passed','ACCEPTED','PASSED'))::int as passed, COUNT(*) FILTER (WHERE status IN ('rework','REWORK'))::int as rework, COUNT(*) FILTER (WHERE status IN ('debug','DEBUG'))::int as debug FROM latest_scans
            ) stats ON TRUE
            WHERE b.id = $1 GROUP BY b.id, w.quantity, w.id, stats.scanned, stats.passed, stats.rework, stats.debug, b.status`, [batch_id]);

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: "Scan completed successfully", data: { scan: scanResult, counters: statsResult.rows[0] } });
    } catch (err: any) {
        await client.query('ROLLBACK');
        return sendError(res, err.message);
    } finally {
        client.release();
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    const { batchId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;
    try {
        const countResult = await pool.query('SELECT COUNT(*) FROM qi_scans WHERE batch_id = $1', [batchId]);
        const total = parseInt(countResult.rows[0].count);
        const result = await pool.query(`SELECT * FROM qi_scans WHERE batch_id = $1 ORDER BY scanned_at DESC LIMIT $2 OFFSET $3`, [batchId, limit, offset]);
        return res.status(200).json({ data: result.rows, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (err: any) {
        return res.status(500).json({ error: err.message || "Failed to fetch scans" });
    }
};

export const updateScanStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;
    try {
        await pool.query(`UPDATE qi_scans SET status = $1, remarks = $2 WHERE id = $3`, [status, remarks, id]);
        return sendSuccess(res, "Status updated successfully");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};
