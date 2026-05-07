import { Request, Response } from 'express';
import pool from '../config/db';

const generateBatchNumber = async () => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const prefix = `VI${dateStr}`;

    const lastBatch = await pool.query(`
        SELECT batch_number FROM vi_batches 
        WHERE batch_number LIKE $1 
        ORDER BY id DESC LIMIT 1
    `, [`${prefix}%`]);

    let sequence = '0001';
    if (lastBatch.rowCount && lastBatch.rowCount > 0) {
        const lastNum = parseInt(lastBatch.rows[0].batch_number.slice(-4));
        sequence = String(lastNum + 1).padStart(4, '0');
    }
    return `${prefix}${sequence}`;
};

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by } = req.body;

        if (!work_order_id) {
            return res.status(400).json({ error: "work_order_id is required" });
        }
        if (!created_by) {
            return res.status(400).json({ error: "created_by is required" });
        }

        const batch_number = await generateBatchNumber();
        const result = await pool.query(
            `INSERT INTO vi_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("❌ Error creating VI batch:", err);
        res.status(500).json({ error: "Failed to create batch: " + err.message });
    }
};

export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*, 
                w.wo_number, 
                w.quantity as wo_qty,
                COUNT(s.id) as scanned_qty,
                COUNT(CASE WHEN s.status IN ('accepted', 'ACCEPTED') THEN 1 END) as passed,
                COUNT(CASE WHEN s.status IN ('rework', 'REWORK') THEN 1 END) as rework,
                COUNT(CASE WHEN s.status IN ('debug', 'DEBUG') THEN 1 END) as debug
            FROM vi_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN vi_scans s ON s.batch_id = b.id
            GROUP BY b.id, w.wo_number, w.quantity
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
    const { batch_id, barcode, scanned_by } = req.body;
    try {
        // 🔥 validate from PTH
        const check = await pool.query(
            `SELECT * FROM pth_scans 
             WHERE barcode = $1 
             AND status = 'ACCEPTED'`,
            [barcode]
        );

        if (check.rows.length === 0) {
            return res.status(400).json({
                error: "Barcode not passed in PTH"
            });
        }

        const result = await pool.query(
            `INSERT INTO vi_scans (batch_id, barcode, scanned_by, status) 
             VALUES ($1, $2, $3, 'accepted') RETURNING *`,
            [batch_id, barcode, scanned_by]
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
