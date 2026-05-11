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

        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) {
            return res.status(404).json({ error: "Work Order not found" });
        }
        const batch_number = woResult.rows[0].wo_number;

        const result = await pool.query(
            `INSERT INTO assembly_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("❌ Error creating Assembly batch:", err);
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
                (SELECT COUNT(*) FROM pcba_fct_scans pfs JOIN pcba_fct_batches pfb ON pfs.batch_id = pfb.id WHERE pfb.work_order_id = w.id AND pfs.status IN ('accepted', 'ACCEPTED')) as wo_qty,
                COUNT(s.id) as scanned_qty,
                COUNT(CASE WHEN s.status IN ('accepted', 'ACCEPTED') THEN 1 END) as passed,
                COUNT(CASE WHEN s.status IN ('remark', 'REMARK') THEN 1 END) as remark,
                COUNT(CASE WHEN s.status IN ('debug', 'DEBUG') THEN 1 END) as debug
            FROM assembly_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN assembly_scans s ON s.batch_id = b.id
            GROUP BY b.id, w.wo_number, w.customer_name, w.id
            ORDER BY b.created_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching Assembly batches:", err);
        res.status(500).json({ error: "Failed to fetch batches" });
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM assembly_batches WHERE id = $1", [id]);
        res.status(200).json({ message: "Batch deleted" });
    } catch (err) {
        console.error("Error deleting Assembly batch:", err);
        res.status(500).json({ error: "Failed to delete batch" });
    }
};

export const createScan = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks } = req.body;
    try {
        // Ghost Removal Logic
        const existingScan = await pool.query(
            "SELECT * FROM assembly_scans WHERE barcode = $1 AND batch_id = $2 ORDER BY scanned_at DESC LIMIT 1",
            [barcode, batch_id]
        );

        if (existingScan.rows.length > 0) {
            const scan = existingScan.rows[0];
            if (scan.status.toLowerCase() === 'accepted') {
                return res.status(400).json({ error: "Barcode already scanned and passed at this station" });
            }
            if ((scan.status.toLowerCase() === 'remark' || scan.status.toLowerCase() === 'debug') && scan.resolution_remarks !== 'Fixed') {
                return res.status(400).json({ error: "Barcode is in Remark/Debug and not yet fixed" });
            }
            if ((scan.status.toLowerCase() === 'remark' || scan.status.toLowerCase() === 'debug') && scan.resolution_remarks === 'Fixed') {
                await pool.query("DELETE FROM assembly_scans WHERE barcode = $1 AND batch_id = $2", [barcode, batch_id]);
            }
        }

        // Strict Check: Barcode must be accepted in PCBA-FCT
        const check = await pool.query(
            `SELECT * FROM pcba_fct_scans 
             WHERE barcode = $1 
             AND status IN ('accepted', 'ACCEPTED')`,
            [barcode]
        );

        if (check.rows.length === 0) {
            return res.status(400).json({
                error: "Barcode not passed in PCBA-FCT station"
            });
        }

        const final_failed_at = failed_at || ((status && (status.toLowerCase() === 'remark' || status.toLowerCase() === 'debug')) ? new Date() : null);
        const final_failed_remarks = failed_remarks || ((status && (status.toLowerCase() === 'remark' || status.toLowerCase() === 'debug')) ? remarks : null);

        const result = await pool.query(
            `INSERT INTO assembly_scans (batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [batch_id, barcode, scanned_by, status || 'accepted', remarks, resolution_remarks, final_failed_at, final_failed_remarks]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating Assembly scan:", err);
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
            'SELECT * FROM assembly_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batchId]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching Assembly batch scans:", err);
        res.status(500).json({ error: "Failed to fetch scans" });
    }
};

export const updateScanStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;
    try {
        await pool.query(
            `UPDATE assembly_scans 
             SET status = $1, remarks = $2 
             WHERE id = $3`,
            [status, remarks, id]
        );
        res.status(200).json({ message: "Updated" });
    } catch (err) {
        console.error("Error updating Assembly scan status:", err);
        res.status(500).json({ error: "Failed to update status" });
    }
};
