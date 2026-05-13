import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';
import { processMESScan } from '../utils/mesLogic';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by } = req.body;
        if (!work_order_id) return sendError(res, "work_order_id is required");
        if (!created_by) return sendError(res, "created_by is required");

        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) return sendError(res, "Work Order not found", 404);
        const batch_number = woResult.rows[0].wo_number;

        const result = await pool.query(
            `INSERT INTO qi_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        return sendSuccess(res, "Batch created successfully", result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') return sendError(res, "Batch for this Work Order already exists");
        return sendError(res, err.message, 500);
    }
};

export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*, 
                w.wo_number, 
                w.customer_name,
                (SELECT COUNT(*) FROM unit_testing_scans uts JOIN unit_testing_batches utb ON uts.batch_id = utb.id WHERE utb.work_order_id = w.id AND uts.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED')) as wo_qty,
                COUNT(s.id) as scanned_qty,
                COUNT(CASE WHEN s.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED') THEN 1 END) as passed,
                COUNT(CASE WHEN s.status IN ('rework', 'REWORK') THEN 1 END) as rework,
                COUNT(CASE WHEN s.status IN ('debug', 'DEBUG') THEN 1 END) as debug
            FROM qi_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN qi_scans s ON s.batch_id = b.id
            WHERE b.is_deleted = FALSE
            GROUP BY b.id, w.wo_number, w.customer_name, w.id
            ORDER BY b.created_at DESC
        `);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body;
    try {
        await pool.query(
            "UPDATE qi_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2",
            [deleted_by || 'system', id]
        );
        return sendSuccess(res, "Batch soft deleted");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const createQiScan = async (req: Request, res: Response) => {
    const { work_order_id, batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const scanResult = await processMESScan({
            client,
            batch_id,
            barcode,
            scanned_by,
            status,
            remarks,
            resolution_remarks,
            failed_at,
            failed_remarks,
            stage_id: 8,
            prev_stage_id: 7,
            batch_table: 'qi_batches',
            scans_table: 'qi_scans',
            work_order_id
        });
        await client.query('COMMIT');
        return sendSuccess(res, "Barcode scanned successfully", scanResult);
    } catch (err: any) {
        await client.query('ROLLBACK');
        return sendError(res, err.message);
    } finally {
        client.release();
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    const { batchId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM qi_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batchId]
        );
        return res.status(200).json(result.rows);
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const updateScanStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;
    try {
        await pool.query(
            `UPDATE qi_scans SET status = $1, remarks = $2 WHERE id = $3`,
            [status, remarks, id]
        );
        return sendSuccess(res, "Status updated successfully");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

