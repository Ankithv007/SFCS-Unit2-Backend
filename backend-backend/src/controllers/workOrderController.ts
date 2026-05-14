import { Request, Response } from 'express';
import pool from '../config/db';

export const createWorkOrder = async (req: Request, res: Response) => {
    const { wo_number, quantity, customer_name, model, created_by } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Create Work Order
        const result = await client.query(
            `INSERT INTO work_orders (wo_number, quantity, customer_name, model, created_by) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [wo_number, quantity, customer_name, model, created_by]
        );
        const newWO = result.rows[0];

        // 2. Auto-create master batch for traceability
        await client.query(
            `INSERT INTO master_batches (work_order_id, batch_number, customer_name, model, total_qty, created_by, status) 
             VALUES ($1, $2, $3, $4, $5, $6, 'active') ON CONFLICT (batch_number) DO NOTHING`,
            [newWO.id, wo_number, customer_name, model, quantity, created_by || 'system']
        );

        // 3. Auto-create batches for ALL production stages so it appears in Pending Batches immediately
        const stages = [
            'pth_batches', 'vi_batches', 'qa_batches', 'flashing_batches', 
            'pcba_fct_batches', 'assembly_batches', 'unit_testing_batches', 
            'qi_batches', 'packing_batches', 'rework_batches', 'debug_batches'
        ];

        for (const table of stages) {
            await client.query(
                `INSERT INTO ${table} (work_order_id, batch_number, created_by) 
                 VALUES ($1, $2, $3) ON CONFLICT (batch_number) DO NOTHING`,
                [newWO.id, wo_number, created_by || 'system']
            );
        }

        await client.query('COMMIT');
        res.status(201).json(newWO);
    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error("Error creating work order:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Work Order number already exists" });
        }
        res.status(500).json({ error: "Failed to create work order" });
    } finally {
        client.release();
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
