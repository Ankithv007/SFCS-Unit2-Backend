import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import {
    savePoDocument,
    deletePoDocument,
    parseExcelPreview,
    normalizePoPath
} from '../services/poDocumentService';
import { getUploadsDir } from '../utils/uploads';

const logger = createLogger('SMT_CONTROLLER');

// === Work Orders ===
export const createWorkOrder = async (req: Request, res: Response) => {
    const {
        work_order_id,
        po_id,
        remark,
        area_id,
        line_id,
        priority,
        product_name,
        product_description,
        quantity,
        panel_quantity,
        sides,
        created_by,
        barcode_source,
        po_document
    } = req.body;

    // 1. Input Normalization for Work Order ID
    const normalizedWorkOrderId = typeof work_order_id === 'string'
        ? work_order_id.trim().toUpperCase()
        : '';

    // 2. Length Validation for Work Order ID
    if (normalizedWorkOrderId.length < 3 || normalizedWorkOrderId.length > 50) {
        return res.status(400).json({
            success: false,
            message: "Work Order ID must be between 3 and 50 characters"
        });
    }

    // 3. Character Validation for Work Order ID
    if (!/^[A-Z0-9\-_]+$/.test(normalizedWorkOrderId)) {
        return res.status(400).json({
            success: false,
            message: "Work Order ID can only contain letters, numbers, hyphens (-), and underscores (_)"
        });
    }

    // 4. Validation & Normalization for PO ID
    const normalizedPoId = typeof po_id === 'string' ? po_id.trim() : '';
    if (!normalizedPoId) {
        return res.status(400).json({
            success: false,
            message: "PO ID is required"
        });
    }
    if (!/^[a-zA-Z0-9\-_]+$/.test(normalizedPoId)) {
        return res.status(400).json({
            success: false,
            message: "PO ID can only contain letters, numbers, hyphens (-), and underscores (_)"
        });
    }

    // Validate Sides
    if (!sides) {
        return res.status(400).json({
            success: false,
            message: "Sides is required"
        });
    }
    const allowedSides = ['Top', 'Bottom', 'Top / Bottom'];
    if (!allowedSides.includes(sides)) {
        return res.status(400).json({
            success: false,
            message: "Sides must be Top, Bottom, or Top / Bottom"
        });
    }

    try {
        let poName: string | null = null;
        let poPath: string | null = null;
        let poType: string | null = null;

        // If a PO document is uploaded, process it
        if (po_document && po_document.data) {
            logger.info(`Processing PO document upload for WO ${normalizedWorkOrderId}...`);
            const savedFile = await savePoDocument(po_document, normalizedWorkOrderId);
            poName = savedFile.originalName;
            poPath = savedFile.relativePath;
            poType = savedFile.mimeType;
            logger.info(`Audit: PO document uploaded successfully for WO ${normalizedWorkOrderId}. Path: ${poPath}`);
        }

        const result = await pool.query(
            `INSERT INTO smt_work_orders (
                id, area_id, line_id, priority, product_name, product_description, 
                quantity, panel_quantity, sides, created_by, barcode_source,
                po_document_name, po_document_path, po_document_type, uploaded_at,
                po_id, remark
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) 
            RETURNING *`,
            [
                normalizedWorkOrderId,
                area_id,
                line_id,
                priority,
                product_name,
                product_description,
                quantity,
                panel_quantity,
                sides,
                created_by,
                barcode_source || 'GENERATED',
                poName,
                poPath,
                poType,
                poPath ? new Date() : null,
                normalizedPoId,
                remark || null
            ]
        );

        logger.info(`Audit: Work order created successfully: ${normalizedWorkOrderId}`);

        res.status(201).json({
            success: true,
            message: "Work order created successfully",
            data: result.rows[0]
        });
    } catch (err: any) {
        logger.error("Error creating work order:", err);
        // Handle database-level duplicate unique violation
        if (err.code === '23505') {
            return res.status(400).json({
                success: false,
                message: "Work Order ID already exists"
            });
        }
        res.status(400).json({
            success: false,
            message: err.message || "Failed to create work order"
        });
    }
};

export const getPendingWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 
                wo.*, 
                COALESCE((
                    SELECT GREATEST(
                        (SELECT COUNT(*) FROM smt_serial_numbers sn WHERE sn.work_order_id = wo.id AND sn.status != 'Cancelled'),
                        (SELECT COALESCE(SUM(sb.generated_quantity), 0) FROM smt_serial_batches sb WHERE sb.work_order_id = wo.id AND sb.is_deleted = false AND sb.status NOT IN ('Cancelled', 'Deleted'))
                    )
                ), 0)::int as generated_count
            FROM smt_work_orders wo
            WHERE wo.status NOT IN ('Cancelled', 'Deleted', 'Completed')
              AND COALESCE((
                  SELECT GREATEST(
                      (SELECT COUNT(*) FROM smt_serial_numbers sn WHERE sn.work_order_id = wo.id AND sn.status != 'Cancelled'),
                      (SELECT COALESCE(SUM(sb.generated_quantity), 0) FROM smt_serial_batches sb WHERE sb.work_order_id = wo.id AND sb.is_deleted = false AND sb.status NOT IN ('Cancelled', 'Deleted'))
                  )
              ), 0) < wo.quantity
            ORDER BY wo.created_at DESC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching pending work orders:", err);
        res.status(500).json({ error: "Failed to fetch pending work orders" });
    }
};

export const getWorkOrders = async (req: Request, res: Response) => {
    const { page, limit, search } = req.query;

    // Backwards compatibility: If page and limit query parameters are missing, return legacy array
    if (!page && !limit) {
        try {
            let queryText = 'SELECT * FROM smt_work_orders';
            const params: any[] = [];

            if (search) {
                queryText += ' WHERE id ILIKE $1 OR po_id ILIKE $1 OR remark ILIKE $1';
                params.push(`%${(search as string).trim()}%`);
            }
            queryText += ' ORDER BY created_at DESC';

            const result = await pool.query(queryText, params);
            return res.status(200).json(result.rows);
        } catch (err) {
            logger.error("Error fetching work orders (legacy):", err);
            return res.status(500).json({ error: "Failed to fetch work orders" });
        }
    }

    try {
        const pageNum = parseInt(page as string) || 1;
        const limitNum = parseInt(limit as string) || 15;
        const offset = (pageNum - 1) * limitNum;

        let countQuery = 'SELECT COUNT(*) FROM smt_work_orders';
        let dataQuery = 'SELECT * FROM smt_work_orders';
        const params: any[] = [];

        if (search) {
            countQuery += ' WHERE id ILIKE $1 OR po_id ILIKE $1 OR remark ILIKE $1';
            dataQuery += ' WHERE id ILIKE $1 OR po_id ILIKE $1 OR remark ILIKE $1';
            params.push(`%${(search as string).trim()}%`);
        }

        dataQuery += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

        const countResult = await pool.query(countQuery, params);
        const total = parseInt(countResult.rows[0].count);

        const dataParams = [...params, limitNum, offset];
        const dataResult = await pool.query(dataQuery, dataParams);

        res.status(200).json({
            success: true,
            data: dataResult.rows,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum)
        });
    } catch (err) {
        logger.error("Error fetching work orders with pagination:", err);
        res.status(500).json({
            success: false,
            message: "Failed to fetch work orders"
        });
    }
};

export const registerWorkOrder = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { barcode_source } = req.body;
    try {
        const result = await pool.query(
            'UPDATE smt_work_orders SET is_registered = true, barcode_source = COALESCE($2, barcode_source) WHERE id = $1 RETURNING *',
            [id, barcode_source]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Work order not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error registering work order:", err);
        res.status(500).json({ error: "Failed to register work order" });
    }
};

export const deleteWorkOrder = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: "Only Super Admin is authorized to delete records.",
            error: "Only Super Admin is authorized to delete records."
        });
    }

    try {
        // 1. Fetch the file path if exists
        const fileQuery = await pool.query(
            'SELECT po_document_path FROM smt_work_orders WHERE id = $1',
            [id]
        );

        if (fileQuery.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Work order not found"
            });
        }

        const poPath = fileQuery.rows[0].po_document_path;

        // 2. Safe file deletion from uploads folder
        if (poPath) {
            logger.info(`Attempting file cleanup for WO ${id} (file: ${poPath})...`);
            await deletePoDocument(poPath);
            logger.info(`Audit: PO document cleanup completed for WO ${id}`);
        }

        // 3. Remove DB record
        const result = await pool.query('DELETE FROM smt_work_orders WHERE id = $1 RETURNING *', [id]);
        logger.info(`Audit: Work order deleted successfully from database: ${id}`);

        const sessionUser = {
            id: (req as any).user?.id || (req as any).user?.userId || null,
            name: (req as any).user?.name || (req as any).user?.email || 'Unknown User',
            role: userRole
        };

        // Write Audit Log
        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'DELETE',
                'WORK_ORDER',
                id.toString(),
                sessionUser.name,
                `Work order deleted successfully by Super Admin`,
                JSON.stringify({
                    userId: sessionUser.id,
                    userName: sessionUser.name,
                    userRole: sessionUser.role,
                    moduleName: 'Work Order Management',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        res.status(200).json({
            success: true,
            message: "Work order deleted successfully"
        });
    } catch (err) {
        logger.error("Error deleting work order:", err);
        res.status(500).json({
            success: false,
            message: "Failed to delete work order"
        });
    }
};

export const updateWorkOrder = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        po_id,
        remark,
        line_id,
        priority,
        product_name,
        product_description,
        quantity,
        panel_quantity,
        sides,
        po_document
    } = req.body;

    const normalizedPoId = typeof po_id === 'string' ? po_id.trim() : '';
    if (!normalizedPoId) {
        return res.status(400).json({
            success: false,
            message: "PO ID is required"
        });
    }
    if (!/^[a-zA-Z0-9\-_]+$/.test(normalizedPoId)) {
        return res.status(400).json({
            success: false,
            message: "PO ID can only contain letters, numbers, hyphens (-), and underscores (_)"
        });
    }

    if (!line_id || !priority || !product_name || !product_description || !quantity || !panel_quantity || !sides) {
        return res.status(400).json({
            success: false,
            message: "All mandatory fields are required."
        });
    }

    if (parseInt(quantity) <= 0 || parseInt(panel_quantity) <= 0) {
        return res.status(400).json({
            success: false,
            message: "Quantities must be greater than 0"
        });
    }

    const allowedSides = ['Top', 'Bottom', 'Top / Bottom'];
    if (!allowedSides.includes(sides)) {
        return res.status(400).json({
            success: false,
            message: "Sides must be Top, Bottom, or Top / Bottom"
        });
    }

    try {
        const currentQuery = await pool.query(
            'SELECT po_document_name, po_document_path, po_document_type, uploaded_at FROM smt_work_orders WHERE id = $1',
            [id]
        );
        if (currentQuery.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Work Order not found"
            });
        }

        let poName = currentQuery.rows[0].po_document_name;
        let poPath = currentQuery.rows[0].po_document_path;
        let poType = currentQuery.rows[0].po_document_type;
        let uploadedAt = currentQuery.rows[0].uploaded_at;

        if (po_document && po_document.data) {
            logger.info(`Processing updated PO document upload for WO ${id}...`);
            if (poPath) {
                await deletePoDocument(poPath).catch(err => logger.error("Failed to delete old file:", err));
            }
            const savedFile = await savePoDocument(po_document, id);
            poName = savedFile.originalName;
            poPath = savedFile.relativePath;
            poType = savedFile.mimeType;
            uploadedAt = new Date();
            logger.info(`Audit: PO document updated successfully for WO ${id}. Path: ${poPath}`);
        } else if (po_document === null) {
            if (poPath) {
                await deletePoDocument(poPath).catch(err => logger.error("Failed to delete file:", err));
            }
            poName = null;
            poPath = null;
            poType = null;
            uploadedAt = null;
        }

        const result = await pool.query(
            `UPDATE smt_work_orders 
             SET po_id = $1, remark = $2, line_id = $3, priority = $4, 
                 product_name = $5, product_description = $6, quantity = $7, 
                 panel_quantity = $8, sides = $9, po_document_name = $10, 
                 po_document_path = $11, po_document_type = $12, uploaded_at = $13
             WHERE id = $14
             RETURNING *`,
            [
                normalizedPoId,
                remark || null,
                line_id,
                priority,
                product_name,
                product_description,
                quantity,
                panel_quantity,
                sides,
                poName,
                poPath,
                poType,
                uploadedAt,
                id
            ]
        );

        logger.info(`Audit: Work order updated successfully: ${id}`);
        res.status(200).json({
            success: true,
            message: "Work order updated successfully",
            data: result.rows[0]
        });
    } catch (err: any) {
        logger.error("Error updating work order:", err);
        res.status(500).json({
            success: false,
            message: err.message || "Failed to update work order"
        });
    }
};

// === PO Document APIs ===

export const viewPoDocumentFile = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'SELECT po_document_name, po_document_path, po_document_type FROM smt_work_orders WHERE id = $1',
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Work Order not found" });
        }

        const { po_document_name, po_document_path, po_document_type } = result.rows[0];
        if (!po_document_path) {
            return res.status(404).json({ success: false, message: "No PO document uploaded for this Work Order" });
        }

        const uploadsDir = getUploadsDir();
        const path = require('path');
        const fs = require('fs');
        const normalizedPath = normalizePoPath(po_document_path);
        const absolutePath = path.join(uploadsDir, normalizedPath);

        logger.info(`[PO View] Database filename: ${po_document_name}`);
        logger.info(`[PO View] Resolved upload directory: ${uploadsDir}`);
        logger.info(`[PO View] Resolved physical file path: ${absolutePath}`);
        const exists = fs.existsSync(absolutePath);
        logger.info(`[PO View] File exists: ${exists}`);

        if (!exists) {
            return res.status(404).json({ success: false, message: "File not found on server" });
        }

        logger.info(`Audit: PO document view inline accessed for WO ${id}`);
        res.setHeader('Content-Type', po_document_type || 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${po_document_name}"`);

        fs.createReadStream(absolutePath).pipe(res);
    } catch (err: any) {
        logger.error("Error viewing PO document file:", err);
        res.status(500).json({ success: false, message: "Failed to view PO document" });
    }
};

export const downloadPoDocument = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'SELECT po_document_name, po_document_path, po_document_type FROM smt_work_orders WHERE id = $1',
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Work Order not found" });
        }

        const { po_document_name, po_document_path, po_document_type } = result.rows[0];
        if (!po_document_path) {
            return res.status(404).json({ success: false, message: "No PO document uploaded for this Work Order" });
        }

        const uploadsDir = getUploadsDir();
        const path = require('path');
        const fs = require('fs');
        const normalizedPath = normalizePoPath(po_document_path);
        const absolutePath = path.join(uploadsDir, normalizedPath);

        logger.info(`[PO Download] Database filename: ${po_document_name}`);
        logger.info(`[PO Download] Resolved upload directory: ${uploadsDir}`);
        logger.info(`[PO Download] Resolved physical file path: ${absolutePath}`);
        const exists = fs.existsSync(absolutePath);
        logger.info(`[PO Download] File exists: ${exists}`);

        if (!exists) {
            return res.status(404).json({ success: false, message: "File not found on server" });
        }

        logger.info(`Audit: PO document download event triggered for WO ${id}`);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${po_document_name}"`);

        fs.createReadStream(absolutePath).pipe(res);
    } catch (err: any) {
        logger.error("Error downloading PO document:", err);
        res.status(500).json({ success: false, message: "Failed to download PO document" });
    }
};

export const previewPoDocument = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'SELECT po_document_name, po_document_path, po_document_type FROM smt_work_orders WHERE id = $1',
            [id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: "Work Order not found" });
        }

        const { po_document_name, po_document_path, po_document_type } = result.rows[0];
        if (!po_document_path) {
            return res.status(404).json({ success: false, message: "No PO document uploaded for this Work Order" });
        }

        if (po_document_type === 'application/pdf') {
            logger.info(`Audit: PO document preview (PDF metadata) accessed for WO ${id}`);
            const authHeader = req.headers['authorization'];
            const token = (authHeader && authHeader.split(' ')[1]) || (req.query.token as string);
            const url = token
                ? `/api/smt/work-orders/${id}/view-po-file?token=${token}`
                : `/api/smt/work-orders/${id}/view-po-file`;

            return res.status(200).json({
                success: true,
                type: 'pdf',
                url: url,
                name: po_document_name
            });
        }

        // Excel file
        logger.info(`Audit: PO document preview (Excel parsing) accessed for WO ${id}`);
        const previewData = await parseExcelPreview(po_document_path, po_document_name, id);

        res.status(200).json({
            success: true,
            ...previewData
        });
    } catch (err: any) {
        logger.error("Error previewing PO document:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to generate preview" });
    }
};

export const getRegisteredWorkOrders = async (req: Request, res: Response) => {
    const { last_status } = req.query;
    try {
        let query = `
            SELECT 
                wo.*,
                (
                    SELECT COUNT(DISTINCT i.serial_id) 
                    FROM smt_inspections i 
                    JOIN smt_serial_numbers sn ON i.serial_id = sn.id 
                    WHERE sn.work_order_id = wo.id AND i.status = 'PASS'
                ) as scanned_count,
                (
                    SELECT COUNT(*)
                    FROM smt_serial_numbers sn4
                    WHERE sn4.work_order_id = wo.id
                ) as generated_qty,
                (
                    SELECT COUNT(*)
                    FROM smt_serial_numbers sn
                    JOIN (
                        SELECT DISTINCT ON (serial_id) serial_id, process_step, status
                        FROM smt_inspections
                        ORDER BY serial_id, scanned_at DESC
                    ) latest ON sn.id = latest.serial_id
                    WHERE sn.work_order_id = wo.id
                      AND latest.process_step = 'Post AOI'
                      AND latest.status = 'PASS'
                ) as passed_count,
                (
                    SELECT COUNT(*)
                    FROM smt_serial_numbers sn
                    JOIN (
                        SELECT DISTINCT ON (serial_id) serial_id, process_step, status
                        FROM smt_inspections
                        ORDER BY serial_id, scanned_at DESC
                    ) latest ON sn.id = latest.serial_id
                    WHERE sn.work_order_id = wo.id
                      AND latest.process_step = 'Post AOI'
                      AND latest.status = 'FAIL'
                ) as active_failed_count
            FROM smt_work_orders wo
            WHERE 1=1
        `;
        const params: any[] = [];

        if (last_status) {
            params.push(last_status);
            query += ` AND EXISTS (
                SELECT 1
                FROM smt_serial_numbers sn2
                JOIN (
                    SELECT DISTINCT ON (serial_id) serial_id, status
                    FROM smt_inspections
                    ORDER BY serial_id, scanned_at DESC
                ) latest ON sn2.id = latest.serial_id
                WHERE sn2.work_order_id = wo.id
                AND latest.status = $${params.length}
            )`;
        } else {
            query += ` AND (wo.is_registered = true OR EXISTS (SELECT 1 FROM smt_serial_numbers sn3 WHERE sn3.work_order_id = wo.id))`;
        }

        query += ` ORDER BY wo.created_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching registered work orders:", err);
        res.status(500).json({ error: "Failed to fetch registered work orders" });
    }
};

// === Serial Numbers ===
export const generateSerials = async (req: Request, res: Response) => {
    const { work_order_id, format, serials, created_by, barcode_source } = req.body;

    // Safety Layer: Aggressive cleaning - preserved dashes for traceability
    const cleanFormat = (format || "").toUpperCase();
    const cleanSerials = (serials || []).map((s: string) => s.toUpperCase());

    if (!cleanSerials || cleanSerials.length === 0) {
        // If it's "Barcode Already Available", we might just want to register it without serials
        if (barcode_source === 'PRE_EXISTING') {
            try {
                await pool.query('UPDATE smt_work_orders SET is_registered = true, barcode_source = $1 WHERE id = $2', [barcode_source, work_order_id]);
                return res.status(200).json({ message: "Work order registered with existing barcodes", inserted: 0, total: 0 });
            } catch (err) {
                logger.error("Error registering WO without serials:", err);
                return res.status(500).json({ error: "Failed to register work order" });
            }
        }
        return res.status(400).json({ error: "No serial numbers provided" });
    }

    try {
        await pool.query('BEGIN');

        // Update WO barcode source
        await pool.query('UPDATE smt_work_orders SET barcode_source = $1 WHERE id = $2', [barcode_source || 'GENERATED', work_order_id]);

        // 1. Bulk insert serial numbers, skipping duplicates
        const snValues: any[] = [];
        const snPlaceholders: string[] = [];
        let snParamIdx = 1;

        cleanSerials.forEach((serial: string) => {
            snPlaceholders.push(`($${snParamIdx++}, $${snParamIdx++}, $${snParamIdx++}, $${snParamIdx++})`);
            snValues.push(work_order_id, cleanFormat, serial, created_by);
        });

        const snQuery = `
            INSERT INTO smt_serial_numbers (work_order_id, serial_format, serial_number, created_by)
            VALUES ${snPlaceholders.join(', ')}
            ON CONFLICT (serial_number) DO NOTHING
            RETURNING id
        `;

        const snResult = await pool.query(snQuery, snValues);

        // 2. Bulk insert initial inspections for NEW serials only
        if (snResult.rows.length > 0) {
            const inspValues: any[] = [];
            const inspPlaceholders: string[] = [];
            let inspParamIdx = 1;

            snResult.rows.forEach((row: any) => {
                inspPlaceholders.push(`($${inspParamIdx++}, $${inspParamIdx++}, $${inspParamIdx++}, $${inspParamIdx++})`);
                inspValues.push(row.id, 'Serial Number', created_by, 'PASS');
            });

            const inspQuery = `
                INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status)
                VALUES ${inspPlaceholders.join(', ')}
            `;
            await pool.query(inspQuery, inspValues);
        }

        await pool.query('COMMIT');
        res.status(201).json({
            message: "Serials generated successfully",
            inserted: snResult.rows.length,
            total: cleanSerials.length
        });
    } catch (err) {
        await pool.query('ROLLBACK');
        logger.error("Error generating serials:", err);
        res.status(500).json({ error: "Failed to generate serials" });
    }
};

export const getSerials = async (req: Request, res: Response) => {
    const { work_order_id, filter_step, filter_status, current_step, last_status } = req.query;
    try {
        const params: any[] = [];
        const currentStep = typeof current_step === 'string' ? current_step : null;
        let completedHereSelect = `
            false as is_completed_here,
            null::text as step_status,
            null::text as step_scanned_by,
            null::timestamp as step_scanned_at,
            null::text as step_remark
        `;

        if (currentStep) {
            params.push(currentStep);
            completedHereSelect = `
                EXISTS (
                    SELECT 1
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    AND step_done.status = 'PASS'
                ) as is_completed_here,
                (
                    SELECT step_done.status
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_status,
                (
                    SELECT step_done.scanned_by
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_scanned_by,
                (
                    SELECT step_done.scanned_at
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_scanned_at,
                (
                    SELECT step_done.rework_reason
                    FROM smt_inspections step_done
                    WHERE step_done.serial_id = sn.id
                    AND step_done.process_step = $${params.length}
                    ORDER BY step_done.scanned_at DESC
                    LIMIT 1
                ) as step_remark
            `;
        }

        let query = `
            SELECT 
                sn.id,
                wo.id as work_order_id,
                sn.serial_number,
                sn.serial_format,
                sn.created_by,
                sn.created_at,
                wo.product_name, 
                wo.quantity as wo_qty, 
                wo.panel_quantity as panel_qty, 
                wo.created_by as wo_created_by,
                wo.is_registered,
                wo.barcode_source,
                last_insp.status as last_status,
                last_insp.process_step as last_step,
                last_insp.rework_reason,
                ${completedHereSelect}
            FROM smt_work_orders wo
            LEFT JOIN smt_serial_numbers sn ON wo.id = sn.work_order_id
            LEFT JOIN (
                SELECT DISTINCT ON (serial_id) serial_id, status, process_step, rework_reason, scanned_at
                FROM smt_inspections
                ORDER BY serial_id, scanned_at DESC
            ) last_insp ON sn.id = last_insp.serial_id
        `;
        const conditions: string[] = ["(wo.is_registered = true OR sn.id IS NOT NULL)"];

        if (work_order_id) {
            params.push(work_order_id);
            conditions.push(`wo.id = $${params.length}`);
        }

        if (filter_step && filter_status) {
            const steps = (filter_step as string).split(',');
            const stepPlaceholders = steps.map((_, i) => `$${params.length + i + 1}`).join(',');

            conditions.push(`EXISTS (
                SELECT 1 FROM smt_inspections insp_filter 
                WHERE insp_filter.serial_id = sn.id 
                AND insp_filter.process_step IN (${stepPlaceholders}) 
                AND insp_filter.status = $${params.length + steps.length + 1}
            )`);

            steps.forEach(step => params.push(step.trim()));
            params.push(filter_status);
        } else if (filter_status) {
            params.push(filter_status);
            conditions.push(`EXISTS (
                SELECT 1 FROM smt_inspections insp_filter 
                WHERE insp_filter.serial_id = sn.id 
                AND insp_filter.status = $${params.length}
            )`);
        }

        // Filter by the most-recent inspection status (latest record per serial)
        if (last_status) {
            params.push(last_status);
            conditions.push(`last_insp.status = $${params.length}`);
        }

        if (conditions.length > 0) {
            query += ` WHERE ` + conditions.join(' AND ');
        }

        query += ` ORDER BY sn.id ASC`;

        logger.info(`Executing getSerials query: ${query} with params: ${JSON.stringify(params)}`);
        const result = await pool.query(query, params);

        // Safety Layer: Clean API Response
        const cleanedRows = result.rows.map(row => ({
            ...row,
            serial_number: row.serial_number || "",
            serial_format: row.serial_format || ""
        }));

        res.status(200).json(cleanedRows);
    } catch (err) {
        logger.error("Error fetching serials:", err);
        res.status(500).json({ error: "Failed to fetch serials" });
    }
};

export const deleteSerials = async (req: Request, res: Response) => {
    const { work_order_id } = req.query;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: "Only Super Admin is authorized to delete records.",
            error: "Only Super Admin is authorized to delete records."
        });
    }

    try {
        if (work_order_id) {
            await pool.query('DELETE FROM smt_serial_numbers WHERE work_order_id = $1', [work_order_id]);
        } else {
            await pool.query('DELETE FROM smt_serial_numbers');
        }

        const sessionUser = {
            id: (req as any).user?.id || (req as any).user?.userId || null,
            name: (req as any).user?.name || (req as any).user?.email || 'Unknown User',
            role: userRole
        };

        // Write Audit Log
        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'DELETE',
                'SERIAL_NUMBERS',
                work_order_id ? work_order_id.toString() : 'ALL',
                sessionUser.name,
                `Serial numbers deleted by Super Admin`,
                JSON.stringify({
                    userId: sessionUser.id,
                    userName: sessionUser.name,
                    userRole: sessionUser.role,
                    moduleName: 'Serial Number Management',
                    recordId: work_order_id || 'ALL',
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        res.status(200).json({ message: "Serials deleted successfully" });
    } catch (err) {
        logger.error("Error deleting serials:", err);
        res.status(500).json({ error: "Failed to delete serials" });
    }
};

// === Printing Employees ===
export const createEmployee = async (req: Request, res: Response) => {
    const { name, user_id, password } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO smt_printing_employees (name, user_id, password) VALUES ($1, $2, $3) RETURNING *`,
            [name, user_id, password]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        logger.error("Error creating employee:", err);
        res.status(500).json({ error: "Failed to create employee" });
    }
};

export const getEmployees = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM smt_printing_employees ORDER BY created_at DESC');
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching employees:", err);
        res.status(500).json({ error: "Failed to fetch employees" });
    }
};

export const updateEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, user_id, password } = req.body;
    try {
        const result = await pool.query(
            `UPDATE smt_printing_employees SET name = $1, user_id = $2, password = $3 WHERE id = $4 RETURNING *`,
            [name, user_id, password, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Employee not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error updating employee:", err);
        res.status(500).json({ error: "Failed to update employee" });
    }
};

export const deleteEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: "Only Super Admin is authorized to delete records.",
            error: "Only Super Admin is authorized to delete records."
        });
    }

    try {
        await pool.query('DELETE FROM smt_printing_employees WHERE id = $1', [id]);

        const sessionUser = {
            id: (req as any).user?.id || (req as any).user?.userId || null,
            name: (req as any).user?.name || (req as any).user?.email || 'Unknown User',
            role: userRole
        };

        // Write Audit Log
        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'DELETE',
                'EMPLOYEE',
                id.toString(),
                sessionUser.name,
                `Employee deleted by Super Admin`,
                JSON.stringify({
                    userId: sessionUser.id,
                    userName: sessionUser.name,
                    userRole: sessionUser.role,
                    moduleName: 'Employee Management',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        res.status(200).json({ message: "Employee deleted" });
    } catch (err) {
        logger.error("Error deleting employee:", err);
        res.status(500).json({ error: "Failed to delete employee" });
    }
};

export const toggleEmployeeStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `UPDATE smt_printing_employees SET is_active = NOT is_active WHERE id = $1 RETURNING *`,
            [id]
        );
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error toggling status:", err);
        res.status(500).json({ error: "Failed to toggle status" });
    }
};

export const loginEmployee = async (req: Request, res: Response) => {
    const { userId, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT * FROM smt_printing_employees WHERE user_id = $1 AND password = $2`,
            [userId, password]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const employee = result.rows[0];
        if (!employee.is_active) {
            return res.status(403).json({ error: "Account deactivated. Please contact admin." });
        }

        res.status(200).json({ message: "Login successful", employee });
    } catch (err) {
        logger.error("Error during login:", err);
        res.status(500).json({ error: "Login failed" });
    }
};

export const updateSerialNumberStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const result = await pool.query(
            'UPDATE smt_serial_numbers SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: "Serial number not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        logger.error("Error updating serial status:", err);
        res.status(500).json({ error: "Failed to update serial status" });
    }
};

// === Inspections ===
export const deleteInspectionsForBatch = async (req: Request, res: Response) => {
    const { work_order_id, process_step } = req.query;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: "Only Super Admin is authorized to delete records.",
            error: "Only Super Admin is authorized to delete records."
        });
    }

    if (!work_order_id || !process_step) {
        return res.status(400).json({ error: "Missing work_order_id or process_step" });
    }

    try {
        const query = `
            DELETE FROM smt_inspections 
            WHERE process_step = $1 
            AND serial_id IN (
                SELECT id FROM smt_serial_numbers WHERE work_order_id = $2
            )
            RETURNING *
        `;
        const result = await pool.query(query, [process_step, work_order_id]);

        const sessionUser = {
            id: (req as any).user?.id || (req as any).user?.userId || null,
            name: (req as any).user?.name || (req as any).user?.email || 'Unknown User',
            role: userRole
        };

        // Write Audit Log
        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'DELETE',
                'INSPECTIONS_BATCH',
                work_order_id.toString(),
                sessionUser.name,
                `Inspections for process step ${process_step} deleted by Super Admin`,
                JSON.stringify({
                    userId: sessionUser.id,
                    userName: sessionUser.name,
                    userRole: sessionUser.role,
                    moduleName: 'Inspections Management',
                    recordId: work_order_id,
                    processStep: process_step,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        res.status(200).json({ message: "Scan session reset successfully", deleted_count: result.rowCount });
    } catch (err) {
        logger.error("Error deleting scan session:", err);
        res.status(500).json({ error: "Failed to delete scan session" });
    }
};

export const createInspection = async (req: Request, res: Response) => {
    const { serial_id, process_step, scanned_by, status, rework_reason } = req.body;
    try {
        // Duplicate validation check: BLOCK duplicate PASS scans
        if (status !== 'FAIL') {
            const dupCheck = await pool.query(
                `SELECT * FROM smt_inspections 
                 WHERE serial_id = $1 AND process_step = $2 
                 ORDER BY scanned_at DESC LIMIT 1`,
                [serial_id, process_step]
            );

            if ((dupCheck.rowCount ?? 0) > 0 && dupCheck.rows[0].status === 'PASS') {
                return res.status(400).json({ error: "Barcode already processed successfully" });
            }
        }

        if (process_step === 'Post AOI') {
            // Find the absolute latest inspection for this serial_id
            const latestRes = await pool.query(
                `SELECT * FROM smt_inspections WHERE serial_id = $1 ORDER BY scanned_at DESC LIMIT 1`,
                [serial_id]
            );

            if ((latestRes.rowCount ?? 0) > 0 && latestRes.rows[0].process_step === 'Post AOI') {
                const latestId = latestRes.rows[0].id;
                // Update the existing row instead of inserting a new one
                const result = await pool.query(
                    `UPDATE smt_inspections 
                     SET status = $1, rework_reason = $2, scanned_by = $3, scanned_at = CURRENT_TIMESTAMP
                     WHERE id = $4 RETURNING *`,
                    [status || 'PASS', rework_reason || null, scanned_by, latestId]
                );

                // Also update the main status in serial_numbers
                const serialStatus = status === 'FAIL' ? 'REWORK' : 'SCANNED';
                await pool.query(
                    'UPDATE smt_serial_numbers SET status = $1 WHERE id = $2',
                    [serialStatus, serial_id]
                );

                return res.status(200).json(result.rows[0]);
            }
        }

        let finalReworkReason = rework_reason || null;

        // Standard Insert Logic for other steps or new Post AOI / revalidation scans
        const result = await pool.query(
            `INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status, rework_reason) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [serial_id, process_step, scanned_by, status || 'PASS', finalReworkReason]
        );

        // Also update the main status in serial_numbers
        let serialStatus = status === 'FAIL' ? 'REWORK' : 'SCANNED';
        if (process_step === 'SMT FG' && (!status || status === 'PASS')) {
            serialStatus = 'COMPLETED';
        }

        await pool.query(
            'UPDATE smt_serial_numbers SET status = $1 WHERE id = $2',
            [serialStatus, serial_id]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        logger.error("Error creating inspection:", err);
        res.status(500).json({ error: "Failed to create inspection" });
    }
};

export const getInspections = async (req: Request, res: Response) => {
    const { serial_id, work_order_id, process_step } = req.query;
    try {
        let query = `
            SELECT i.*, sn.serial_number, sn.work_order_id 
            FROM smt_inspections i
            JOIN smt_serial_numbers sn ON i.serial_id = sn.id
            WHERE 1=1
        `;
        const params: any[] = [];
        if (serial_id) {
            params.push(serial_id);
            query += ` AND i.serial_id = $${params.length}`;
        }
        if (work_order_id) {
            params.push(work_order_id);
            query += ` AND sn.work_order_id = $${params.length}`;
        }
        if (process_step) {
            params.push(process_step);
            query += ` AND i.process_step = $${params.length}`;
        }
        query += ` ORDER BY i.scanned_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching inspections:", err);
        res.status(500).json({ error: "Failed to fetch inspections" });
    }
};

export const deleteInspection = async (req: Request, res: Response) => {
    const { serial_id, process_step } = req.query;
    try {
        if (!serial_id || !process_step) {
            return res.status(400).json({ error: "serial_id and process_step are required" });
        }
        await pool.query(
            `DELETE FROM smt_inspections WHERE serial_id = $1 AND process_step = $2`,
            [serial_id, process_step]
        );
        res.status(200).json({ message: "Inspection reset successfully" });
    } catch (err) {
        logger.error("Error deleting inspection:", err);
        res.status(500).json({ error: "Failed to reset inspection" });
    }
};

// === Process Setups (AOI, etc.) ===
export const createProcessSetup = async (req: Request, res: Response) => {
    const { work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side } = req.body;
    try {
        // Enforce Solder Paste Management completion for Printing process setup
        if (process_name === 'PRINTING') {
            const woCheck = await pool.query(
                `SELECT solder_paste_status, solder_paste_barcode FROM smt_work_orders WHERE id = $1`,
                [work_order_id]
            );

            if (woCheck.rows.length === 0) {
                return res.status(404).json({ error: "Work Order not found." });
            }

            const { solder_paste_status, solder_paste_barcode } = woCheck.rows[0];

            if (solder_paste_status !== 'Completed') {
                return res.status(400).json({
                    error: "Solder Paste Management is not completed for this Work Order! Solder paste must be mixed and completed first."
                });
            }

            if (solder_paste !== solder_paste_barcode) {
                return res.status(400).json({
                    error: `Invalid Solder Paste barcode. Enforced barcode is: ${solder_paste_barcode}`
                });
            }
        }

        const insertResult = await pool.query(
            `INSERT INTO smt_process_setups (work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [work_order_id, process_name, product_name, quantity, stencil_name, squeegee_number, solder_paste, side]
        );

        const newId = insertResult.rows[0].id;
        const joinedResult = await pool.query(
            `SELECT ps.*, wo.panel_quantity as panel_qty 
             FROM smt_process_setups ps
             LEFT JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             WHERE ps.id = $1`,
            [newId]
        );

        res.status(201).json(joinedResult.rows[0]);
    } catch (err) {
        logger.error("Error creating process setup:", err);
        res.status(500).json({ error: "Failed to create process setup" });
    }
};

export const getProcessSetups = async (req: Request, res: Response) => {
    const { process_name } = req.query;
    try {
        let query = `
            SELECT ps.*, wo.panel_quantity as panel_qty 
            FROM smt_process_setups ps
            LEFT JOIN smt_work_orders wo ON ps.work_order_id = wo.id
        `;
        const params = [];
        if (process_name) {
            query += ' WHERE ps.process_name = $1';
            params.push(process_name);
        }
        query += ' ORDER BY ps.timestamp DESC';
        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching process setups:", err);
        res.status(500).json({ error: "Failed to fetch process setups" });
    }
};

export const deleteProcessSetup = async (req: Request, res: Response) => {
    const { id } = req.params;
    const userRole = (req as any).user?.role;

    if (userRole !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: "Only Super Admin is authorized to delete records.",
            error: "Only Super Admin is authorized to delete records."
        });
    }

    try {
        await pool.query('DELETE FROM smt_process_setups WHERE id = $1', [id]);

        const sessionUser = {
            id: (req as any).user?.id || (req as any).user?.userId || null,
            name: (req as any).user?.name || (req as any).user?.email || 'Unknown User',
            role: userRole
        };

        // Write Audit Log
        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'DELETE',
                'PROCESS_SETUP',
                id.toString(),
                sessionUser.name,
                `Process setup deleted by Super Admin`,
                JSON.stringify({
                    userId: sessionUser.id,
                    userName: sessionUser.name,
                    userRole: sessionUser.role,
                    moduleName: 'Process Setup Management',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        res.status(200).json({ message: "Process setup deleted" });
    } catch (err) {
        logger.error("Error deleting process setup:", err);
        res.status(500).json({ error: "Failed to delete process setup" });
    }
};

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
                COALESCE(passed.passed_count, 0)::int as completed_qty,
                (wo.quantity - COALESCE(passed.passed_count, 0))::int as balance_qty,
                CASE 
                    WHEN COALESCE(passed.passed_count, 0) >= wo.quantity THEN 'COMPLETED'
                    WHEN COALESCE(passed.passed_count, 0) > 0 THEN 'ACTIVE'
                    ELSE 'INACTIVE'
                END as status,
                wo.created_by,
                wo.created_at as run_date_time
            FROM smt_work_orders wo
            LEFT JOIN (
                SELECT sn.work_order_id, COUNT(*) as passed_count
                FROM smt_serial_numbers sn
                JOIN (
                    SELECT DISTINCT ON (serial_id) serial_id, process_step, status
                    FROM smt_inspections
                    ORDER BY serial_id, scanned_at DESC
                ) latest ON sn.id = latest.serial_id
                WHERE latest.process_step = 'SMT FG' AND latest.status = 'PASS'
                GROUP BY sn.work_order_id
            ) passed ON wo.id = passed.work_order_id
            WHERE wo.area_id = $1
        `;
        const params: any[] = [areaId || 'SMT'];

        if (lineId && lineId !== 'ALL') {
            params.push(lineId);
            query += ` AND wo.line_id = $${params.length}`;
        }

        if (fromDate) {
            params.push(fromDate);
            query += ` AND wo.created_at >= $${params.length}`;
        }

        if (toDate) {
            params.push(`${toDate} 23:59:59`);
            query += ` AND wo.created_at <= $${params.length}`;
        }

        query += ` GROUP BY wo.id, passed.passed_count ORDER BY wo.created_at DESC`;

        const result = await pool.query(query, params);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error("Error fetching work order history:", err);
        res.status(500).json({ error: "Failed to fetch work order history" });
    }
};

export const downloadSmtReport = async (req: Request, res: Response) => {
    const { work_order_id, process_step } = req.query as { work_order_id?: string; process_step?: string };
    if (!work_order_id || !process_step) {
        return res.status(400).json({ error: 'work_order_id and process_step are required.' });
    }

    try {
        const woRes = await pool.query(
            'SELECT * FROM smt_work_orders WHERE id = $1',
            [work_order_id]
        );
        if (woRes.rows.length === 0) {
            return res.status(404).json({ error: 'Work Order not found.' });
        }
        const wo = woRes.rows[0];

        let query = '';
        let params: any[] = [work_order_id, process_step];

        if (process_step === 'Rework') {
            query = `
                SELECT 
                    sn.serial_number AS barcode,
                    r.scanned_by AS scanned_by,
                    r.scanned_at AS scan_date_time,
                    'ACCEPTED' AS status,
                    (
                        SELECT f.rework_reason 
                        FROM smt_inspections f 
                        WHERE f.serial_id = sn.id 
                          AND f.status = 'FAIL' 
                          AND f.scanned_at < r.scanned_at 
                        ORDER BY f.scanned_at DESC LIMIT 1
                    ) AS failure_remark,
                    r.scanned_at AS repair_time,
                    COALESCE(r.rework_reason, '-') AS repair_remark
                FROM smt_serial_numbers sn
                JOIN smt_inspections r ON sn.id = r.serial_id AND r.process_step = 'Rework' AND r.status = 'PASS'
                WHERE sn.work_order_id = $1
                ORDER BY r.scanned_at DESC
            `;
            params = [work_order_id];
        } else {
            query = `
                SELECT DISTINCT ON (sn.serial_number)
                    sn.serial_number AS barcode,
                    COALESCE(i.scanned_by, '-') AS scanned_by,
                    i.scanned_at AS scan_date_time,
                    COALESCE(i.status, 'PENDING') AS status,
                    COALESCE(i.rework_reason, '-') AS failure_remark,
                    '-' AS repair_time,
                    '-' AS repair_remark
                FROM smt_serial_numbers sn
                LEFT JOIN smt_inspections i ON sn.id = i.serial_id AND i.process_step = $2
                WHERE sn.work_order_id = $1
                ORDER BY sn.serial_number ASC, i.scanned_at DESC
            `;
        }

        const result = await pool.query(query, params);
        const rows = result.rows;

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`${process_step} Report`);

        const labelStyle: Partial<ExcelJS.Style> = {
            font: { bold: true, color: { argb: 'FF595959' }, name: 'Segoe UI', size: 10 },
            alignment: { horizontal: 'left' }
        };
        const valueStyle: Partial<ExcelJS.Style> = {
            font: { bold: true, name: 'Segoe UI', size: 10 },
            alignment: { horizontal: 'left' }
        };
        const borderStyle: Partial<ExcelJS.Borders> = {
            top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };

        const metadata = [
            { label: 'WO Number:', val: wo.id },
            { label: 'Customer:', val: 'N/A' },
            { label: 'Quantity:', val: wo.quantity },
            { label: 'Model:', val: wo.product_name },
            { label: 'Stage/Page Name:', val: process_step },
            { label: 'Downloaded Date & Time:', val: new Date().toLocaleString() }
        ];

        metadata.forEach((item, idx) => {
            const rowNumber = idx + 1;
            worksheet.getCell(`A${rowNumber}`).value = item.label;
            worksheet.getCell(`A${rowNumber}`).style = labelStyle;
            worksheet.getCell(`B${rowNumber}`).value = item.val;
            worksheet.getCell(`B${rowNumber}`).style = valueStyle;
        });

        worksheet.addRow([]);

        const tableHeaders = [
            'BARCODE',
            'SCANNED BY',
            'DATE & TIME',
            'STATUS',
            'FAILURE REMARK',
            'REPAIR TIME',
            'REPAIR REMARK'
        ];
        const headerRow = worksheet.addRow(tableHeaders);
        headerRow.height = 26;

        const headerFill: ExcelJS.Fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2B579A' }
        };

        headerRow.eachCell((cell: ExcelJS.Cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = headerFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        rows.forEach((r: any) => {
            const formatTime = (time: string | Date | null) => {
                if (!time || time === '-') return '-';
                return new Date(time).toLocaleString();
            };

            let displayStatus = r.status || 'PENDING';
            if (displayStatus === 'PASS') displayStatus = 'ACCEPTED';
            if (displayStatus === 'FAIL') displayStatus = 'REWORK';

            const dataRow = worksheet.addRow([
                r.barcode,
                r.scanned_by,
                formatTime(r.scan_date_time),
                displayStatus,
                r.failure_remark || '-',
                formatTime(r.repair_time),
                r.repair_remark || '-'
            ]);
            dataRow.height = 20;

            const isRework = displayStatus === 'REWORK';

            dataRow.eachCell((cell: ExcelJS.Cell, colNumber: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;

                if (colNumber === 3 || colNumber === 4 || colNumber === 6) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                } else {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                }

                if (isRework) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFF9C4' }
                    };
                }

                if (colNumber === 4) {
                    if (displayStatus === 'ACCEPTED') {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (displayStatus === 'REWORK') {
                        cell.font = { color: { argb: 'FFFFAF33' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (displayStatus === 'PENDING') {
                        cell.font = { color: { argb: 'FF808080' }, italic: true, name: 'Segoe UI', size: 10 };
                    }
                }
            });
        });

        worksheet.columns.forEach((column: any) => {
            let maxLen = 0;
            column.eachCell!({ includeEmpty: true }, (cell: ExcelJS.Cell) => {
                if (cell.row && (cell.row as any).number <= 7) return;
                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
            column.width = maxLen < 14 ? 14 : maxLen + 5;
        });

        worksheet.getColumn(1).width = 25;
        worksheet.getColumn(2).width = 25;

        worksheet.views = [{ state: 'frozen', ySplit: 8 }];

        const safeWoId = work_order_id.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `SMT_${process_step}_Report_${safeWoId}_${nowStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error('Error generating Excel file for SMT:', err);
        return res.status(500).json({ error: 'Failed to generate SMT Excel report: ' + err.message });
    }
};

