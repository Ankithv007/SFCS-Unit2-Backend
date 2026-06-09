import { Request, Response } from 'express';
import { ScanProcessingService } from '../services/scans/ScanProcessingService';
import { BatchManagementService } from '../services/batches/BatchManagementService';
import { AuditService } from '../services/audit/AuditService';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by, batch_number } = req.body;
        const batchId = await BatchManagementService.getOrCreateBatch(batch_number, work_order_id, 4 /* fallback if needed */, created_by);
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
        const result = await BatchManagementService.getBatchesByStage('FLASHING', limit, offset, status, search);
        return res.status(200).json({
            data: result.data,
            total: result.total,
            page,
            limit,
            totalPages: Math.ceil(result.total / limit)
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
};

export const createFlashingScan = async (req: Request, res: Response) => {
    try {
        const result = await ScanProcessingService.processStageScan('FLASHING', req.body);
        return res.status(200).json(result);
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    try {
        const data = await AuditService.getScansByBatchAndStage(req.params.batchId, 'FLASHING');
        return res.status(200).json({ data });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
};

export const updateScanStatus = async (req: Request, res: Response) => {
    try {
        await AuditService.updateScanStatus(req.params.id, req.body.status, req.body.remarks);
        res.status(200).json({ message: "Updated" });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const userRole = (req as any).user?.role;
    const lowerRole = (userRole || '').toString().toLowerCase().replace(/\s/g, '');
    if (lowerRole !== 'admin' && lowerRole !== 'superadmin') {
        return res.status(403).json({ error: 'You do not have permission to delete this record.' });
    }
    try {
        await BatchManagementService.deleteBatch(req.params.id, req.body.deleted_by || 'system');
        res.status(200).json({ message: 'Record deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete batch" });
    }
};
