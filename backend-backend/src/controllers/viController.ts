import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';
import { processMESScan } from '../utils/mesLogic';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by } = req.body;

        if (!work_order_id) {
            return sendError(res, "work_order_id is required");
        }
        if (!created_by) {
            return sendError(res, "created_by is required");
        }

        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) {
            return sendError(res, "Work Order not found", 404);
        }
        const batch_number = woResult.rows[0].wo_number;

        const result = await pool.query(
            `INSERT INTO vi_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        return sendSuccess(res, "Batch created successfully", result.rows[0]);
    } catch (err: any) {
        console.error("❌ Error creating VI batch:", err);
        if (err.code === '23505') {
            return sendError(res, "Batch for this Work Order already exists");
        }
        return sendError(res, "Failed to create batch: " + err.message, 500);
    }
};

export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*, 
                w.wo_number, 
                w.customer_name,
                (SELECT COUNT(*) FROM pth_scans WHERE work_order_id = w.id AND status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED')) as wo_qty,
                COUNT(s.id) as scanned_qty,
                COUNT(CASE WHEN s.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED') THEN 1 END) as passed,
                COUNT(CASE WHEN s.status IN ('rework', 'REWORK') THEN 1 END) as rework,
                COUNT(CASE WHEN s.status IN ('debug', 'DEBUG') THEN 1 END) as debug
            FROM vi_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN vi_scans s ON s.batch_id = b.id
            WHERE b.is_deleted = FALSE
            GROUP BY b.id, w.wo_number, w.customer_name, w.id
            ORDER BY b.created_at DESC
        `);
        return res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching VI batches:", err);
        return sendError(res, "Failed to fetch batches", 500);
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body;
    try {
        await pool.query(
            "UPDATE vi_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2",
            [deleted_by || 'system', id]
        );
        return sendSuccess(res, "Batch soft deleted");
    } catch (err) {
        console.error("Error deleting VI batch:", err);
        return sendError(res, "Failed to delete batch", 500);
    }
};

export const createViScan = async (req: Request, res: Response) => {
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
            stage_id: 2,
            prev_stage_id: 1,
            batch_table: 'vi_batches',
            scans_table: 'vi_scans',
            work_order_id
        });

        await client.query('COMMIT');
        return sendSuccess(res, "Barcode scanned successfully", scanResult);

    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error("Error in createViScan:", err);
        return sendError(res, err.message || "Failed to process scan");
    } finally {
        client.release();
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    const { batchId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM vi_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
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
            `UPDATE vi_scans 
             SET status = $1, remarks = $2 
             WHERE id = $3`,
            [status, remarks, id]
        );
        return sendSuccess(res, "Status updated successfully");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};
