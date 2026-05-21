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

        // 2. Create the master Centralized Batch for this Work Order
        // A single batch tracks through stages. We initialize it at Stage 1.
        const stagesRes = await client.query(`SELECT id FROM production_stages ORDER BY stage_order ASC`);
        const stageIds = stagesRes.rows.map(row => row.id);
        
        let newBatchId = null;
        if (stageIds.length > 0) {
            const firstStageId = stageIds[0];
            const batchResult = await client.query(
                `INSERT INTO batches (work_order_id, batch_number, current_stage_id, created_by) 
                 VALUES ($1, $2, $3, $4) 
                 ON CONFLICT (batch_number) DO NOTHING RETURNING id`,
                [newWO.id, wo_number, firstStageId, created_by || 'system']
            );
            
            if (batchResult.rowCount && batchResult.rowCount > 0) {
                newBatchId = batchResult.rows[0].id;
            } else {
                // Fetch if existed
                const existingBatch = await client.query(`SELECT id FROM batches WHERE batch_number = $1`, [wo_number]);
                if (existingBatch.rows.length > 0) newBatchId = existingBatch.rows[0].id;
            }

            // 3. Auto-create batch_stage_progress for ALL production stages 
            // so it appears in Pending Batches immediately across all frontend pages.
            if (newBatchId) {
                for (const stageId of stageIds) {
                    await client.query(
                        `INSERT INTO batch_stage_progress (batch_id, stage_id) 
                         VALUES ($1, $2) ON CONFLICT (batch_id, stage_id) DO NOTHING`,
                        [newBatchId, stageId]
                    );
                }
            }
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
