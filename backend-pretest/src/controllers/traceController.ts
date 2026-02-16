import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('TRACE');

/**
 * GET /api/trace/:barcode
 * Returns full chronological history and current summary for a barcode.
 */
export const getBarcodeHistory = async (req: Request, res: Response) => {
    const { barcode } = req.params;
    logger.info(`Trace request received for barcode: [${barcode}] | Path: ${req.originalUrl}`);

    if (!barcode) {
        return res.status(400).json({ error: 'Barcode is required' });
    }

    try {
        // 1. Fetch Latest Summary (Using covering index: idx_trace_latest_only_desc)
        const summaryResult = await pool.query(`
            SELECT 
                stage_name as current_stage,
                status as last_status,
                operator,
                batch_id,
                created_at as last_updated_at
            FROM barcode_stage_history
            WHERE barcode = $1
            ORDER BY created_at DESC, id DESC
            LIMIT 1
        `, [barcode]);

        if (summaryResult.rows.length === 0) {
            return res.status(404).json({ error: 'No history found for this barcode.' });
        }

        // 2. Fetch Full Chronological History (Using index: idx_trace_barcode_history_asc)
        const historyResult = await pool.query(`
            SELECT 
                stage_name,
                stage_order,
                status,
                operator,
                remarks,
                source_system,
                created_at
            FROM barcode_stage_history
            WHERE barcode = $1
            ORDER BY created_at ASC, id ASC
        `, [barcode]);

        // 3. Assemble Elite Payload
        const responseData = {
            barcode,
            summary: summaryResult.rows[0],
            timeline: historyResult.rows.map(row => ({
                stage: row.stage_name,
                order: row.stage_order,
                status: row.status,
                operator: row.operator,
                timestamp: row.created_at,
                source: row.source_system,
                remarks: row.remarks || '-'
            }))
        };

        return res.json(responseData);
    } catch (error: any) {
        logger.error(`Error in getBarcodeHistory: ${error.message}`);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
