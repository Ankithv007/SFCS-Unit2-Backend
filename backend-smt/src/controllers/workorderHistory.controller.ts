import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('WORKORDER_HISTORY_CONTROLLER');

/**
 * GET /api/smt/workorder-history
 * Query Params: areaId, lineId, fromDate, toDate
 */
export const getWorkOrderHistory = async (req: Request, res: Response) => {
    const { areaId, lineId, fromDate, toDate } = req.query;

    try {
        let query = `
            SELECT 
                wo.id as work_order_id,
                wo.area_id,
                wo.line_id,
                wo.product_name,
                wo.quantity as total_qty,
                (SELECT COUNT(*)::int FROM smt_serial_numbers sn WHERE sn.work_order_id = wo.id) as completed_qty,
                wo.created_by,
                wo.created_at as run_date_time
            FROM smt_work_orders wo
            WHERE 1=1
        `;

        const queryParams: any[] = [];

        if (areaId) {
            queryParams.push(areaId);
            query += ` AND wo.area_id = $${queryParams.length}`;
        }

        if (lineId && lineId !== 'ALL') {
            queryParams.push(lineId);
            query += ` AND wo.line_id = $${queryParams.length}`;
        }

        if (fromDate) {
            queryParams.push(`${fromDate} 00:00:00`);
            query += ` AND wo.created_at >= $${queryParams.length}`;
        }

        if (toDate) {
            queryParams.push(`${toDate} 23:59:59`);
            query += ` AND wo.created_at <= $${queryParams.length}`;
        }

        query += ` ORDER BY wo.created_at DESC`;

        const result = await pool.query(query, queryParams);

        // Process rows to add status and balanceQty
        const history = result.rows.map(row => {
            const totalQty = parseInt(row.total_qty) || 0;
            const completedQty = parseInt(row.completed_qty) || 0;
            const balanceQty = Math.max(0, totalQty - completedQty);

            // STATUS LOGIC (CRITICAL)
            // ACTIVE: If serial generation started (exists in serial table)
            // INACTIVE: If no serial generation yet
            // COMPLETED: If completedQty == totalQty
            let status = 'INACTIVE';
            if (completedQty >= totalQty && totalQty > 0) {
                status = 'COMPLETED';
            } else if (completedQty > 0) {
                status = 'ACTIVE';
            }

            return {
                ...row,
                total_qty: totalQty,
                completed_qty: completedQty,
                balance_qty: balanceQty,
                status: status
            };
        });

        res.status(200).json(history);
    } catch (err: any) {
        logger.error("Error fetching work order history:", err);
        res.status(500).json({ error: "Failed to fetch work order history", details: err.message });
    }
};
