import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';

export const createBatch = async (req: Request, res: Response) => {
    try {
        console.log("Incoming Create Batch Request:", req.body);
        const { work_order_id, created_by } = req.body;

        if (!work_order_id) {
            return res.status(400).json({ error: "work_order_id is required" });
        }
        if (!created_by) {
            return res.status(400).json({ error: "created_by is required" });
        }

        // Fetch Work Order number to use as Batch Number
        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) {
            return res.status(404).json({ error: "Work Order not found" });
        }
        const batch_number = woResult.rows[0].wo_number;

        const result = await pool.query(
            `INSERT INTO pth_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("❌ Error creating PTH batch:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Batch for this Work Order already exists" });
        }
        res.status(500).json({ error: "Failed to create batch: " + err.message });
    }
};

export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*, 
                w.wo_number, 
                w.customer_name,
                w.quantity as wo_qty,
                COUNT(s.id) as scanned_qty,
                COUNT(CASE WHEN s.status IN ('accepted', 'ACCEPTED') THEN 1 END) as passed,
                COUNT(CASE WHEN s.status IN ('rework', 'REWORK') THEN 1 END) as rework,
                COUNT(CASE WHEN s.status IN ('debug', 'DEBUG') THEN 1 END) as debug
            FROM pth_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN pth_scans s ON s.batch_id = b.id
            WHERE b.is_deleted = FALSE
            GROUP BY b.id, w.wo_number, w.customer_name, w.quantity
            ORDER BY b.created_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching PTH batches:", err);
        res.status(500).json({ error: "Failed to fetch batches" });
    }
};

export const completeBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query(
            "UPDATE pth_batches SET status = 'completed' WHERE id = $1",
            [id]
        );
        res.status(200).json({ message: "Batch completed" });
    } catch (err) {
        console.error("Error completing PTH batch:", err);
        res.status(500).json({ error: "Failed to complete batch" });
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body; // Expect deleted_by in request
    try {
        await pool.query(
            "UPDATE pth_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2",
            [deleted_by || 'system', id]
        );
        res.status(200).json({ message: "Batch soft deleted" });
    } catch (err) {
        console.error("Error deleting PTH batch:", err);
        res.status(500).json({ error: "Failed to delete batch" });
    }
};


import { processMESScan } from '../utils/mesLogic';

export const createPthScan = async (req: Request, res: Response) => {
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
            stage_id: 1,
            prev_stage_id: null,
            batch_table: 'pth_batches',
            scans_table: 'pth_scans',
            work_order_id
        });

        await client.query('COMMIT');
        return sendSuccess(res, "Barcode scanned successfully", scanResult);

    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error("Error in createPthScan:", err);
        return sendError(res, err.message || "Failed to process scan");
    } finally {
        client.release();
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    const { batchId } = req.params;
    try {
        const result = await pool.query(
            `SELECT 
                h.barcode,
                h.scanned_by,
                h.scanned_at,
                h.status,
                h.remarks,
                COALESCE(
                    h.failed_at,
                    (SELECT rs.scanned_at FROM rework_scans rs WHERE rs.barcode = h.barcode ORDER BY rs.scanned_at DESC LIMIT 1),
                    (SELECT ds.scanned_at FROM debug_scans ds WHERE ds.barcode = h.barcode ORDER BY ds.scanned_at DESC LIMIT 1)
                ) as remark_debug_time,
                COALESCE(
                    h.failed_remarks,
                    (SELECT rs.remarks FROM rework_scans rs WHERE rs.barcode = h.barcode ORDER BY rs.scanned_at DESC LIMIT 1),
                    (SELECT ds.remarks FROM debug_scans ds WHERE ds.barcode = h.barcode ORDER BY ds.scanned_at DESC LIMIT 1),
                    h.resolution_remarks
                ) as remark_debug_remarks
             FROM pth_scans h
             WHERE h.batch_id = $1
             ORDER BY h.scanned_at DESC`,
            [batchId]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching PTH batch scans:", err);
        res.status(500).json({ error: "Failed to fetch scans" });
    }
};

export const updateScanStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;
    try {
        await pool.query(
            `UPDATE pth_scans 
             SET status = $1, remarks = $2 
             WHERE id = $3`,
            [status, remarks, id]
        );
        res.status(200).json({ message: "Updated" });
    } catch (err) {
        console.error("Error updating PTH scan status:", err);
        res.status(500).json({ error: "Failed to update status" });
    }
};

export const getPthDetailsByWoId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Work Order not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch details" });
    }
};

