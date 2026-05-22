import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('SMT_TRACK_CONTROLLER');

export const trackSerialNumber = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Serial Number is required.' });
    }

    const inputValue = id.trim().toUpperCase();

    try {
        // 1. Find the serial number record
        const serialResult = await pool.query(
            `SELECT sn.*, wo.product_name, wo.quantity, wo.line_id, wo.created_by as wo_created_by, wo.created_at as wo_created_at
             FROM smt_serial_numbers sn
             LEFT JOIN smt_work_orders wo ON sn.work_order_id = wo.id
             WHERE sn.serial_number = $1`,
            [inputValue]
        );

        if ((serialResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `"${inputValue}" was not found in the system. Please check the Serial Number.` });
        }

        const serial = serialResult.rows[0];

        // 2. Fetch all inspection history for this serial across all process steps
        const historyResult = await pool.query(
            `SELECT 
                id,
                serial_id,
                process_step,
                scanned_by,
                scanned_at,
                status,
                rework_reason
            FROM smt_inspections
            WHERE serial_id = $1
            ORDER BY scanned_at ASC`,
            [serial.id]
        );

        const history = historyResult.rows.map((row: any) => ({
            id: row.id,
            process_step: row.process_step || '-',
            status: (row.status || '').toUpperCase(),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            rework_reason: row.rework_reason || null,
        }));

        // 3. Determine current stage (last stage in history)
        let currentStage = 'Pending';
        let currentStatus = 'PENDING';
        if (history.length > 0) {
            const lastRecord = history[history.length - 1];
            currentStage = lastRecord.process_step;
            currentStatus = lastRecord.status;
        }

        // 4. Compute statistics
        const totalFailures = history.filter(h => h.status === 'REWORK' || h.status === 'FAIL').length;
        const totalReworks = history.filter(h => h.process_step === 'Rework').length;
        const totalPassed = history.filter(h => h.status === 'PASS').length;

        // 5. Determine final status
        let finalStatusLabel = 'IN PRODUCTION';
        if (currentStatus === 'PASS' && currentStage === 'SMT FG') {
            finalStatusLabel = 'COMPLETED';
        } else if (currentStatus === 'REWORK') {
            finalStatusLabel = 'IN REWORK';
        } else if (currentStatus === 'FAIL') {
            finalStatusLabel = 'FAILED';
        } else if (currentStatus === 'PASS') {
            finalStatusLabel = 'IN PRODUCTION';
        }

        return res.status(200).json({
            serial_number: serial.serial_number,
            serial_format: serial.serial_format,
            work_order_id: serial.work_order_id,
            product_name: serial.product_name || '-',
            quantity: serial.quantity || '-',
            line_id: serial.line_id || '-',
            current_stage: currentStage,
            current_status: currentStatus,
            final_status_label: finalStatusLabel,
            created_at: serial.created_at,
            total_failures: totalFailures,
            total_reworks: totalReworks,
            total_passed: totalPassed,
            scan_history: history,
        });

    } catch (err: any) {
        logger.error('❌ Error in trackSerialNumber:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};
