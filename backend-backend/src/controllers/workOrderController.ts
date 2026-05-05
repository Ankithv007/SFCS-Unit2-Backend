import { Request, Response } from 'express';
import pool from '../config/db';

export const createWorkOrder = async (req: Request, res: Response) => {
    const { wo_number, quantity, customer_name, model, created_by } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO work_orders (wo_number, quantity, customer_name, model, created_by) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [wo_number, quantity, customer_name, model, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating work order:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Work Order number already exists" });
        }
        res.status(500).json({ error: "Failed to create work order" });
    }
};

export const getAllWorkOrders = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM work_orders ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching work orders:", err);
        res.status(500).json({ error: "Failed to fetch work orders" });
    }
};

export const deleteWorkOrder = async (req: any, res: Response) => {
    const { id } = req.params;
    
    // Server-side role check
    if (!['Admin', 'Super Admin'].includes(req.user?.role || '')) {
        return res.status(403).json({ error: "Access denied: Admins only" });
    }

    try {
        const result = await pool.query('DELETE FROM work_orders WHERE id = $1 RETURNING *', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Work Order not found" });
        }
        res.status(200).json({ message: "Work Order deleted successfully" });
    } catch (err) {
        console.error("Error deleting work order:", err);
        res.status(500).json({ error: "Failed to delete work order" });
    }
};
