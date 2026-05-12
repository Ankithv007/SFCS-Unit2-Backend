import { Request, Response } from 'express';
import pool from '../config/db';

export const createBatch = async (req: Request, res: Response) => {
    try {
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
            `INSERT INTO vi_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("❌ Error creating VI batch:", err);
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
                (SELECT COUNT(*) FROM pth_scans WHERE work_order_id = w.id AND status IN ('accepted', 'ACCEPTED')) as wo_qty,
                COUNT(s.id) as scanned_qty,
                COUNT(CASE WHEN s.status IN ('accepted', 'ACCEPTED') THEN 1 END) as passed,
                COUNT(CASE WHEN s.status IN ('rework', 'REWORK') THEN 1 END) as rework,
                COUNT(CASE WHEN s.status IN ('debug', 'DEBUG') THEN 1 END) as debug
            FROM vi_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN vi_scans s ON s.batch_id = b.id
            GROUP BY b.id, w.wo_number, w.customer_name, w.id
            ORDER BY b.created_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching VI batches:", err);
        res.status(500).json({ error: "Failed to fetch batches" });
    }
};

export const completeBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query(
            "UPDATE vi_batches SET status = 'completed' WHERE id = $1",
            [id]
        );
        res.status(200).json({ message: "Batch completed" });
    } catch (err) {
        console.error("Error completing VI batch:", err);
        res.status(500).json({ error: "Failed to complete batch" });
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM vi_batches WHERE id = $1", [id]);
        res.status(200).json({ message: "Batch deleted" });
    } catch (err) {
        console.error("Error deleting VI batch:", err);
        res.status(500).json({ error: "Failed to delete batch" });
    }
};

export const createViScan = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks } = req.body;
    try {
        // If the item was previously reworked but is now 'Fixed', delete the old record to allow re-scanning
        const existingScan = await pool.query(
            "SELECT * FROM vi_scans WHERE barcode = $1 AND batch_id = $2 ORDER BY scanned_at DESC LIMIT 1",
            [barcode, batch_id]
        );

        if (existingScan.rows.length > 0) {
            const scan = existingScan.rows[0];
            const currentStatus = scan.status.toLowerCase();
            
            if (currentStatus === 'accepted') {
                return res.status(400).json({ error: "Barcode already scanned and passed at this station" });
            }
            
            if ((currentStatus === 'rework' || currentStatus === 'debug') && 
                (!scan.resolution_remarks || scan.resolution_remarks.toLowerCase() !== 'fixed')) {
                return res.status(400).json({ error: "Barcode is in Rework/Debug and not yet fixed" });
            }
        }

        // If the incoming status is 'accepted', delete any existing 'rework' or 'debug' records 
        // to prevent duplicate entries and ensure UI cleanliness
        if (status && status.toLowerCase() === 'accepted') {
            await pool.query(
                "DELETE FROM vi_scans WHERE barcode = $1 AND batch_id = $2 AND status IN ('rework', 'REWORK', 'debug', 'DEBUG')",
                [barcode, batch_id]
            );
        }

        // 🔥 validate from PTH
        const check = await pool.query(
            `SELECT * FROM pth_scans 
             WHERE barcode = $1 
             AND status IN ('accepted', 'ACCEPTED')`,
            [barcode]
        );

        if (check.rows.length === 0) {
            return res.status(400).json({
                error: "Barcode not passed in PTH"
            });
        }

        const final_failed_at = failed_at || ((status && (status.toLowerCase() === 'rework' || status.toLowerCase() === 'debug')) ? new Date() : null);
        const final_failed_remarks = failed_remarks || ((status && (status.toLowerCase() === 'rework' || status.toLowerCase() === 'debug')) ? remarks : null);

        const result = await pool.query(
            `INSERT INTO vi_scans (batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [batch_id, barcode, scanned_by, status || 'accepted', remarks, resolution_remarks, final_failed_at, final_failed_remarks]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating VI scan:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Barcode already scanned" });
        }
        res.status(500).json({ error: "Failed to scan item" });
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    const { batchId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM vi_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batchId]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching VI batch scans:", err);
        res.status(500).json({ error: "Failed to fetch scans" });
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
        res.status(200).json({ message: "Updated" });
    } catch (err) {
        console.error("Error updating VI scan status:", err);
        res.status(500).json({ error: "Failed to update status" });
    }
};
