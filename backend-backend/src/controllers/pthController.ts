import { Request, Response } from 'express';
import pool from '../config/db';

export const getPthDetailsByWoId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`
            SELECT * FROM work_orders WHERE id = $1
        `, [id]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Work Order not found" });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error("Error fetching PTH WO details:", err);
        res.status(500).json({ error: "Failed to fetch details" });
    }
};

export const createPthScan = async (req: any, res: Response) => {
    const { work_order_id, barcode, scanned_by } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO pth_scans (work_order_id, barcode, scanned_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, barcode, scanned_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating PTH scan:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Barcode already scanned in PTH" });
        }
        res.status(500).json({ error: "Failed to scan item in PTH" });
    }
};

export const getPthScansByWoId = async (req: Request, res: Response) => {
    const { woId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM pth_scans WHERE work_order_id = $1 ORDER BY scanned_at DESC',
            [woId]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching PTH scans:", err);
        res.status(500).json({ error: "Failed to fetch scans" });
    }
};
