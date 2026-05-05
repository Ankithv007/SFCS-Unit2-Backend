import { Request, Response } from 'express';
import pool from '../config/db';

const generateBatchNumber = async () => {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
    const prefix = `PTH${dateStr}`;
    
    const lastBatch = await pool.query(`
        SELECT batch_number FROM pth_batches 
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
    const { work_order_id, created_by } = req.body;
    try {
        const batch_number = await generateBatchNumber();
        const result = await pool.query(
            `INSERT INTO pth_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Error creating PTH batch:", err);
        res.status(500).json({ error: "Failed to create batch" });
    }
};

export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT b.*, w.wo_number, w.quantity as wo_qty,
            (SELECT COUNT(*) FROM pth_scans WHERE batch_id = b.id) as scanned_count
            FROM pth_batches b
            JOIN work_orders w ON b.work_order_id = w.id
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
    try {
        await pool.query("DELETE FROM pth_batches WHERE id = $1", [id]);
        res.status(200).json({ message: "Batch deleted" });
    } catch (err) {
        console.error("Error deleting PTH batch:", err);
        res.status(500).json({ error: "Failed to delete batch" });
    }
};

export const createPthScan = async (req: Request, res: Response) => {
    const { work_order_id, batch_id, barcode, scanned_by } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO pth_scans (work_order_id, batch_id, barcode, scanned_by) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [work_order_id, batch_id, barcode, scanned_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating PTH scan:", err);
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
            'SELECT * FROM pth_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batchId]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching PTH batch scans:", err);
        res.status(500).json({ error: "Failed to fetch scans" });
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
