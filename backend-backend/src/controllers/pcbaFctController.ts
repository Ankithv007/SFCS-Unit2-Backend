import { Request, Response } from 'express';
import { ScanProcessingService } from '../services/scans/ScanProcessingService';
import { BatchManagementService } from '../services/batches/BatchManagementService';
import { AuditService } from '../services/audit/AuditService';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by, batch_number } = req.body;
        const batchId = await BatchManagementService.getOrCreateBatch(batch_number, work_order_id, 5 /* fallback if needed */, created_by);
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
        const result = await BatchManagementService.getBatchesByStage('PCBA_FCT', limit, offset, status, search);
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

export const createPcbaFctScan = async (req: Request, res: Response) => {
    try {
        const result = await ScanProcessingService.processStageScan('PCBA_FCT', req.body);
        return res.status(200).json(result);
    } catch (err: any) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    try {
        const data = await AuditService.getScansByBatchAndStage(req.params.batchId, 'PCBA_FCT');
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
    try {
        await BatchManagementService.deleteBatch(req.params.id, req.body.deleted_by || 'system');
        res.status(200).json({ message: "Batch soft deleted" });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete batch" });
    }
};

export const linkUnitSerial = async (req: Request, res: Response) => {
    const { barcode, unit_serial_number, linked_by } = req.body;
    try {
        if (!barcode || !unit_serial_number || !linked_by) {
            return res.status(400).json({ error: "Missing required fields for USN linking" });
        }
        
        const pool = require('../config/db').default;

        // 1. Check if the USN is already mapped to ANOTHER barcode
        const usnCheck = await pool.query(
            `SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1`,
            [unit_serial_number]
        );
        if (usnCheck.rows.length > 0) {
            const existingBarcode = usnCheck.rows[0].barcode;
            if (existingBarcode !== barcode) {
                return res.status(400).json({ error: "Unit Serial Number already linked to another PCB barcode." });
            }
        }
        
        // 2. Check if the barcode is already mapped to a DIFFERENT USN (block remapping)
        const barcodeCheck = await pool.query(
            `SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1`,
            [barcode]
        );
        if (barcodeCheck.rows.length > 0) {
            const existingUsn = barcodeCheck.rows[0].unit_serial_number;
            if (existingUsn !== unit_serial_number) {
                return res.status(400).json({ error: "PCB barcode already linked to another Unit Serial Number." });
            }
        }
        
        await pool.query(
            `INSERT INTO unit_serial_mapping (barcode, unit_serial_number, linked_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (barcode) DO UPDATE 
             SET unit_serial_number = EXCLUDED.unit_serial_number, linked_by = EXCLUDED.linked_by`,
            [barcode, unit_serial_number, linked_by]
        );
        res.status(200).json({ success: true, message: "Unit Serial Number linked successfully" });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
};
