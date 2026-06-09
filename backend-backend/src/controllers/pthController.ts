import { Request, Response } from 'express';
import { ScanProcessingService } from '../services/scans/ScanProcessingService';
import { BatchManagementService } from '../services/batches/BatchManagementService';
import { AuditService } from '../services/audit/AuditService';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by, batch_number } = req.body;
        // In a fully centralized model, we just ask BatchManagement to handle this
        // It's possible the route still passes just work_order_id, but the service handles it.
        const batchId = await BatchManagementService.getOrCreateBatch(batch_number, work_order_id, 1 /* fallback if needed, better to fetch stage ID internally */, created_by);
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
        const result = await BatchManagementService.getBatchesByStage('PTH', limit, offset, status, search);
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

export const createPthScan = async (req: Request, res: Response) => {
    try {
        const result = await ScanProcessingService.processStageScan('PTH', req.body);
        return res.status(200).json(result);
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    try {
        const data = await AuditService.getScansByBatchAndStage(req.params.batchId, 'PTH');
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

export const completeBatch = async (req: Request, res: Response) => {
    try {
        await BatchManagementService.completeBatch(req.params.id);
        res.status(200).json({ message: "Batch completed" });
    } catch (err) {
        res.status(500).json({ error: "Failed to complete batch" });
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

// Legacy support
export const getPthDetailsByWoId = async (req: Request, res: Response) => {
    // This could also be moved to a generic service if needed
    try {
        // Mocking for pure thinness, this might be handled by a WorkOrderService
        res.status(200).json({ id: req.params.id, message: "Use Central Work Order APIs" });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch details" });
    }
};
