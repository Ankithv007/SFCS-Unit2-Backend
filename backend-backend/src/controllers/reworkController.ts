import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';
import { BatchManagementService } from '../services/batches/BatchManagementService';
import { ScanProcessingService } from '../services/scans/ScanProcessingService';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by, batch_number } = req.body;
        const batchId = await BatchManagementService.getOrCreateBatch(batch_number, work_order_id, 10 /* Rework Stage */, created_by);
        res.status(201).json({ id: batchId, batch_number, work_order_id });
    } catch (err: any) {
        res.status(500).json({ error: "Failed to create batch: " + err.message });
    }
};

export const getBatches = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;

    try {
        const result = await BatchManagementService.getBatchesByStage('REWORK', limit, offset, status, search);
        return res.status(200).json({
            data: result.data,
            total: result.total,
            page,
            limit,
            totalPages: Math.ceil(result.total / limit)
        });
    } catch (err: any) {
        console.error("Error in rework getBatches:", err);
        return sendError(res, err.message, 500);
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body;
    try {
        await pool.query("UPDATE rework_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2", [deleted_by || 'system', id]);
        return sendSuccess(res, "Batch soft deleted");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const createReworkScan = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by, status, remarks } = req.body;
    
    if (!remarks || typeof remarks !== 'string' || !remarks.trim()) {
        return sendError(res, "Repair remark is mandatory to complete rework.", 400);
    }

    try {
        const result = await ScanProcessingService.processStageScan('REWORK', {
            work_order_id: null,
            batch_id,
            barcode,
            status: status || 'RESOLVED',
            scanned_by: scanned_by || 'system',
            remarks: remarks.trim(),
            failed_stage_id: req.body.failed_stage_id
        });

        return sendSuccess(res, "Item resolved and returned to original stage", result.data);
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const getScans = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    const { failedStageId } = req.query;
    try {
        const query = `
            SELECT s.*, u.failed_stage_id, u.failed_at, u.failure_remark, u.repair_remark, m.unit_serial_number 
            FROM scans s 
            JOIN units u ON s.barcode = u.barcode
            LEFT JOIN unit_serial_mapping m ON s.barcode = m.barcode
            WHERE s.batch_id = $1 AND s.stage_id = 10
            ${failedStageId ? 'AND u.failed_stage_id = $2::int' : ''}
            ORDER BY s.scanned_at DESC
        `;
        const params = failedStageId ? [batch_id, failedStageId] : [batch_id];
        const result = await pool.query(query, params);
        return sendSuccess(res, "Scans fetched", result.rows);
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};
