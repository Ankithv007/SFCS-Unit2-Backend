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

/**
 * GET /api/trace/batch-summary/:batchInput
 * Returns stage-wise production summary for a batch or a unit's parent batch.
 */
export const getBatchSummary = async (req: Request, res: Response) => {
    const { batchInput } = req.params;
    logger.info(`Batch summary request received for: [${batchInput}]`);

    if (!batchInput) {
        return res.status(400).json({ error: 'Batch input is required' });
    }

    try {
        // 1. Resolve Batch Number
        let batchNumber: string | null = null;

        // Strategy A: Check if input is a valid batch number directly
        const whBatchCheck = await pool.query(`SELECT batch_number FROM warehouse_batches WHERE batch_number = $1`, [batchInput]);

        if (whBatchCheck.rows.length > 0) {
            batchNumber = whBatchCheck.rows[0].batch_number;
        } else {
            // Strategy B: Check if input is a barcode by looking it up in history
            const resolveResult = await pool.query(`
                SELECT b.batch_number 
                FROM barcode_stage_history h
                JOIN warehouse_batches b ON h.batch_id = b.id
                WHERE h.barcode = $1 AND h.stage_name = 'Warehouse'
                LIMIT 1
            `, [batchInput]);

            if (resolveResult.rows.length > 0) {
                batchNumber = resolveResult.rows[0].batch_number;
            }
        }

        if (!batchNumber) {
            const BARCODE_REGEX = /^[A-Z]{2}-\d{4}-\d{2}-[A-Z0-9]{4}$/;
            if (BARCODE_REGEX.test(batchInput)) {
                return res.status(404).json({ error: 'Invalid barcode' });
            }
            return res.status(404).json({ error: 'Batch not found' });
        }

        // 2. Get All Barcodes in Batch (from Warehouse stage)
        const barcodesResult = await pool.query(`
            SELECT DISTINCT h.barcode 
            FROM barcode_stage_history h
            JOIN warehouse_batches b ON h.batch_id = b.id
            WHERE h.stage_name = 'Warehouse' AND b.batch_number = $1
        `, [batchNumber]);

        const batchBarcodes = barcodesResult.rows.map(r => r.barcode);

        // 3. Aggregate Stage Data
        // We use a single query with subqueries or multiple queries. For readability and strict rules, multiple is safer.

        const fetchStageStats = async (stageName: string, bCodes: string[]) => {
            if (bCodes.length === 0) return { scanned: 0, passed: 0, rework: 0, rework_passed: 0, failed: 0, scrap: 0, moving_to_next: 0 };

            const stats = await pool.query(`
                WITH stage_data AS (
                    SELECT barcode, status, created_at
                    FROM barcode_stage_history
                    WHERE stage_name = $1 AND barcode = ANY($2)
                ),
                barcode_stats AS (
                    SELECT 
                        barcode,
                        COUNT(*) as total_attempts,
                        BOOL_OR(status = 'Passed') as has_passed,
                        BOOL_OR(status = 'Failed') as has_failed,
                        BOOL_OR(status = 'Rework') as has_rework,
                        BOOL_OR(status = 'Scrap') as has_scrapped,
                        COUNT(*) FILTER (WHERE status = 'Failed') as fail_count,
                        -- Rework Passed = barcode that had at least one failure/rework AND eventually passed in this stage
                        (BOOL_OR(status = 'Failed' OR status = 'Rework') AND BOOL_OR(status = 'Passed')) as is_rework_passed
                    FROM stage_data
                    GROUP BY barcode
                )
                SELECT 
                    COUNT(DISTINCT barcode)::int as scanned,
                    COUNT(*) FILTER (WHERE has_passed AND NOT is_rework_passed)::int as passed,
                    COUNT(*) FILTER (WHERE has_rework OR (has_failed AND NOT has_passed AND NOT has_scrapped))::int as rework,
                    COUNT(*) FILTER (WHERE is_rework_passed)::int as rework_passed,
                    COUNT(*) FILTER (WHERE has_failed)::int as failed,
                    COUNT(*) FILTER (WHERE has_scrapped)::int as scrap
                FROM barcode_stats
            `, [stageName, bCodes]);

            const row = stats.rows[0];
            return {
                scanned: row.scanned || 0,
                passed: row.passed || 0,
                rework: row.rework || 0,
                rework_passed: row.rework_passed || 0,
                failed: row.failed || 0,
                scrap: row.scrap || 0,
                moving_to_next: (row.passed || 0) + (row.rework_passed || 0)
            };
        };

        const warehouseStats = await pool.query(`
            SELECT 
                (SELECT expected_quantity FROM warehouse_batches WHERE batch_number = $1) as total_created,
                COUNT(DISTINCT h.barcode)::int as total_scanned
            FROM barcode_stage_history h
            JOIN warehouse_batches b ON h.batch_id = b.id
            WHERE h.stage_name = 'Warehouse' AND b.batch_number = $1
        `, [batchNumber]);

        const preIqc = await fetchStageStats('Pre-IQC', batchBarcodes);
        const preImpedance = await fetchStageStats('Pre-Impedance', batchBarcodes);
        const preCalibration = await fetchStageStats('Pre-Calibration', batchBarcodes);
        const preAclr = await fetchStageStats('Pre-ACLR', batchBarcodes);

        const response: any = {
            batch: batchNumber,
            warehouse: {
                total_created: warehouseStats.rows[0]?.total_created || 0,
                total_scanned: warehouseStats.rows[0]?.total_scanned || 0
            },
            pre_iqc: preIqc,
            pre_impedance: preImpedance,
            pre_calibration: preCalibration,
            pre_aclr: {
                ...preAclr,
                final_output: preAclr.moving_to_next
            }
        };

        return res.json(response);
    } catch (error: any) {
        logger.error(`Error in getBatchSummary: ${error.message}`);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
