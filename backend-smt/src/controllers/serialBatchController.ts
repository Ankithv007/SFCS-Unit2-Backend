import { Request, Response } from 'express';
import fs from 'fs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import * as ExcelJS from 'exceljs';
import {
    formatSerialNumber,
    checkFileIntegrity,
    compressAndSaveLaserMachineFile,
    parseSerialsFromFile
} from '../services/serialGenerationService';

const logger = createLogger('SERIAL_GENERATION_RECORD_CONTROLLER');

// Helper to extract operator details
const getOperator = (req: Request) => {
    const user = (req as any).user;
    return {
        id: user?.id || user?.userId || null,
        username: user?.email || user?.username || 'unknown_operator',
        name: user?.name || 'Unknown Operator',
        role: user?.role || 'Operator'
    };
};

// Helper for standardized error responses
const sendError = (res: Response, status: number, error: string, code: string, details: any = null) => {
    logger.warn(`API Error [${code}] Status ${status}: ${error}`);
    return res.status(status).json({
        success: false,
        error,
        code,
        details
    });
};

/**
 * POST /api/smt/v1/smt/serial-generation-records
 * Creates a serial generation record and generates or stores serial numbers within a transaction.
 */
export const createSerialGenerationRecord = async (req: Request, res: Response) => {
    const startTime = new Date();
    const operator = getOperator(req);
    const {
        work_order_id,
        barcode_source, // 'GENERATE' | 'CUSTOMER' | 'LASER'
        remarks,
        additional_notes,
        // GENERATE configuration details
        prefix,
        suffix,
        separator, // 'None' | 'Hyphen (-)' | 'Underscore (_)' | 'Slash (/' | 'Space'
        starting_number,
        ending_number,
        number_length,
        // CUSTOMER scan details
        scanned_barcodes,
        duplicate_scan_count,
        duplicate_scan_log,
        // LASER validation details
        temp_file_path,
        original_filename,
        serials
    } = req.body;

    // 1. Basic Validations
    if (!work_order_id || !barcode_source) {
        return sendError(res, 400, 'Work Order ID and Barcode Source are required.', 'VALIDATION_ERROR');
    }

    if (!['GENERATE', 'CUSTOMER', 'LASER'].includes(barcode_source)) {
        return sendError(res, 400, 'Invalid Barcode Source value.', 'VALIDATION_ERROR');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 2. Concurrency Lock: SELECT FOR UPDATE
        const woRes = await client.query('SELECT * FROM smt_work_orders WHERE id = $1 FOR UPDATE', [work_order_id]);
        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return sendError(res, 404, 'Work Order not found.', 'RESOURCE_NOT_FOUND');
        }
        const workOrder = woRes.rows[0];

        // 3. Calculate Cumulative Quantity & Remaining Quantity
        const activeQtyRes = await client.query(`
            SELECT COALESCE(SUM(generated_quantity), 0) AS total_generated
            FROM smt_serial_batches
            WHERE work_order_id = $1
              AND is_deleted = false
        `, [work_order_id]);

        const totalGeneratedSoFar = parseInt(activeQtyRes.rows[0].total_generated, 10);
        const remainingQuantity = workOrder.quantity - totalGeneratedSoFar;

        let recordQty = 0;
        let serialsToInsert: string[] = [];

        // Check if there is an existing active CUSTOMER batch for this WO
        let existingBatch = null;
        let isExisting = false;

        if (barcode_source === 'CUSTOMER') {
            const existingBatchRes = await client.query(`
                SELECT id, generated_quantity, status 
                FROM smt_serial_batches 
                WHERE work_order_id = $1 
                  AND barcode_source = 'CUSTOMER' 
                  AND is_deleted = false 
                LIMIT 1
            `, [work_order_id]);

            if (existingBatchRes.rows.length > 0) {
                existingBatch = existingBatchRes.rows[0];
                isExisting = true;

                // Guard: check if already completed
                if (existingBatch.status === 'Completed' || parseInt(existingBatch.generated_quantity, 10) >= workOrder.quantity) {
                    await client.query('ROLLBACK');
                    return sendError(res, 422, 'Work Order customer serial generation is already completed.', 'QUANTITY_LIMIT_EXCEEDED');
                }
            }
        }

        // 4. Source Specific Business Rules & Duplicate Checks
        if (barcode_source === 'GENERATE') {
            if (!starting_number || !ending_number || !separator) {
                await client.query('ROLLBACK');
                return sendError(res, 400, 'Starting number, ending number, and separator are required for GENERATE.', 'VALIDATION_ERROR');
            }

            const startVal = parseInt(starting_number, 10);
            const endVal = parseInt(ending_number, 10);
            if (isNaN(startVal) || isNaN(endVal) || startVal > endVal) {
                await client.query('ROLLBACK');
                return sendError(res, 400, 'Invalid starting or ending number range.', 'VALIDATION_ERROR');
            }

            recordQty = endVal - startVal + 1;
            if (recordQty > remainingQuantity) {
                await client.query('ROLLBACK');
                return sendError(res, 422, `Requested quantity (${recordQty}) exceeds Remaining Quantity (${remainingQuantity}).`, 'QUANTITY_LIMIT_EXCEEDED');
            }

            // Format serials
            for (let i = startVal; i <= endVal; i++) {
                serialsToInsert.push(formatSerialNumber(prefix, suffix, separator, i, starting_number, number_length ? parseInt(number_length, 10) : null));
            }

            // Global Duplicity Check
            const dupCheckRes = await client.query(`
                SELECT serial_number FROM smt_serial_numbers WHERE serial_number = ANY($1)
            `, [serialsToInsert]);

            if (dupCheckRes.rows.length > 0) {
                const duplicates = dupCheckRes.rows.map(r => r.serial_number);
                await client.query('ROLLBACK');
                return sendError(res, 409, `Duplicate serial numbers detected in database: ${duplicates.slice(0, 5).join(', ')}`, 'DUPLICATE_SERIAL_CONFLICT', { duplicates });
            }

        } else if (barcode_source === 'CUSTOMER') {
            if (!Array.isArray(scanned_barcodes) || scanned_barcodes.length === 0) {
                await client.query('ROLLBACK');
                return sendError(res, 400, 'Scanned barcodes list is required for CUSTOMER.', 'VALIDATION_ERROR');
            }

            recordQty = scanned_barcodes.length;
            if (recordQty > remainingQuantity) {
                await client.query('ROLLBACK');
                return sendError(res, 422, `Scanned quantity (${recordQty}) exceeds Remaining Quantity (${remainingQuantity}).`, 'QUANTITY_LIMIT_EXCEEDED');
            }

            serialsToInsert = scanned_barcodes.map((s: any) => String(s).trim());

            // Global Duplicity Check
            const dupCheckRes = await client.query(`
                SELECT serial_number FROM smt_serial_numbers WHERE serial_number = ANY($1)
            `, [serialsToInsert]);

            if (dupCheckRes.rows.length > 0) {
                const duplicates = dupCheckRes.rows.map(r => r.serial_number);
                await client.query('ROLLBACK');
                return sendError(res, 409, `Duplicate customer barcodes detected in database: ${duplicates.slice(0, 5).join(', ')}`, 'DUPLICATE_SERIAL_CONFLICT', { duplicates });
            }

        } else if (barcode_source === 'LASER') {
            if (!temp_file_path || !original_filename || !Array.isArray(serials) || serials.length === 0) {
                await client.query('ROLLBACK');
                return sendError(res, 400, 'Laser Machine validation details are required.', 'VALIDATION_ERROR');
            }

            if (!fs.existsSync(temp_file_path)) {
                await client.query('ROLLBACK');
                return sendError(res, 400, 'Temp file does not exist on server.', 'VALIDATION_ERROR');
            }

            serialsToInsert = serials.map((s: any) => String(s).trim());
            recordQty = serialsToInsert.length;

            // Global Duplicity Check
            const dupCheckRes = await client.query(`
                SELECT serial_number FROM smt_serial_numbers WHERE serial_number = ANY($1)
            `, [serialsToInsert]);

            if (dupCheckRes.rows.length > 0) {
                const duplicates = dupCheckRes.rows.map(r => r.serial_number);
                await client.query('ROLLBACK');
                return sendError(res, 409, `Duplicate laser barcodes detected in database: ${duplicates.slice(0, 5).join(', ')}`, 'DUPLICATE_SERIAL_CONFLICT', { duplicates });
            }
        }

        // 5. Insert/Update Serial Generation Record (smt_serial_batches)
        const newTotalQty = isExisting ? (parseInt(existingBatch.generated_quantity, 10) + recordQty) : recordQty;
        const finalStatus = newTotalQty === workOrder.quantity ? 'Completed' : 'Generated';
        const endTimePlaceholder = new Date();
        const durationPlaceholder = endTimePlaceholder.getTime() - startTime.getTime();

        let record;
        if (isExisting) {
            const updateBatchRes = await client.query(`
                UPDATE smt_serial_batches
                SET generated_quantity = $1,
                    status = $2,
                    serial_generation_remarks = CASE WHEN $3::text IS NOT NULL AND $3::text <> '' THEN $3::text ELSE serial_generation_remarks END,
                    additional_notes = CASE WHEN $4::text IS NOT NULL AND $4::text <> '' THEN $4::text ELSE additional_notes END,
                    updated_by = $5,
                    updated_by_name = $6,
                    updated_at = NOW()
                WHERE id = $7
                RETURNING id, status, generated_quantity
            `, [
                newTotalQty,
                finalStatus,
                remarks || null,
                additional_notes || null,
                operator.username,
                operator.name,
                existingBatch.id
            ]);
            record = updateBatchRes.rows[0];
        } else {
            const batchRes = await client.query(`
                INSERT INTO smt_serial_batches (
                    work_order_id, po_id, work_order_number, product_name, product_description,
                    work_order_quantity, panel_quantity, sides, line_id, work_order_remarks,
                    barcode_source, generation_source, status, generated_quantity,
                    serial_generation_remarks, additional_notes,
                    generation_start_time, generation_end_time, generation_duration_ms,
                    created_by, created_by_name
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                RETURNING id, status, generated_quantity
            `, [
                work_order_id,
                workOrder.po_id || '—',
                workOrder.id, // work_order_number
                workOrder.product_name,
                workOrder.product_description || '',
                workOrder.quantity,
                workOrder.panel_quantity || 1,
                workOrder.sides || 'TOP',
                workOrder.line_id || 'Line 1',
                workOrder.remark || '',
                barcode_source,
                barcode_source,
                finalStatus,
                recordQty,
                remarks || null,
                additional_notes || null,
                startTime,
                endTimePlaceholder,
                durationPlaceholder,
                operator.username,
                operator.name
            ]);

            record = batchRes.rows[0];
        }

        // 6. Bulk Insert Serial Numbers & Inspection step
        if (barcode_source === 'GENERATE' || barcode_source === 'CUSTOMER' || barcode_source === 'LASER') {
            const formatStr = barcode_source === 'GENERATE' ? 'Generate Barcode' : barcode_source === 'CUSTOMER' ? 'Customer Barcode' : 'Laser Machine';
            
            // Bulk insert serials
            const serialInsertPromises = serialsToInsert.map(serial => {
                return client.query(`
                    INSERT INTO smt_serial_numbers (work_order_id, serial_format, serial_number, status, created_by, batch_id)
                    VALUES ($1, $2, $3, 'Generated', $4, $5)
                    RETURNING id, serial_number
                `, [work_order_id, formatStr, serial, operator.username, record.id]);
            });
            const insertedSerials = await Promise.all(serialInsertPromises);

            // Bulk insert inspections (PASS step for serial validation)
            const inspectionPromises = insertedSerials.map(res => {
                const serialId = res.rows[0].id;
                return client.query(`
                    INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status)
                    VALUES ($1, 'Serial Number', $2, 'PASS')
                `, [serialId, operator.username]);
            });
            await Promise.all(inspectionPromises);
        }

        // 7. Save Configurations, Scans, or Documents
        if (barcode_source === 'GENERATE') {
            const sampleFormat = serialsToInsert[0] || '—';
            await client.query(`
                INSERT INTO smt_serial_batch_configs (
                    batch_id, prefix, suffix, separator, starting_number, ending_number, number_length, generation_format
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                record.id,
                prefix || null,
                suffix || null,
                separator,
                starting_number,
                ending_number,
                number_length ? parseInt(number_length, 10) : null,
                sampleFormat
            ]);
        } else if (barcode_source === 'CUSTOMER') {
            if (isExisting) {
                // Fetch existing scan summary
                const scanRes = await client.query(
                    'SELECT duplicate_scan_count, duplicate_scan_log FROM smt_serial_batch_scans WHERE batch_id = $1',
                    [existingBatch.id]
                );
                let existingDupCount = 0;
                let existingDupLog: any[] = [];
                if (scanRes.rows.length > 0) {
                    existingDupCount = parseInt(scanRes.rows[0].duplicate_scan_count || 0, 10);
                    try {
                        existingDupLog = typeof scanRes.rows[0].duplicate_scan_log === 'string'
                            ? JSON.parse(scanRes.rows[0].duplicate_scan_log)
                            : (scanRes.rows[0].duplicate_scan_log || []);
                    } catch (e) {
                        existingDupLog = [];
                    }
                }

                const mergedDupCount = existingDupCount + (duplicate_scan_count || 0);
                const newDupLog = duplicate_scan_log || [];
                const mergedDupLog = [...existingDupLog, ...newDupLog];

                await client.query(`
                    UPDATE smt_serial_batch_scans
                    SET total_scanned = $1,
                        duplicate_scan_count = $2,
                        duplicate_scan_log = $3
                    WHERE batch_id = $4
                `, [
                    newTotalQty,
                    mergedDupCount,
                    JSON.stringify(mergedDupLog),
                    existingBatch.id
                ]);
            } else {
                await client.query(`
                    INSERT INTO smt_serial_batch_scans (
                        batch_id, total_scanned, duplicate_scan_count, duplicate_scan_log
                    ) VALUES ($1, $2, $3, $4)
                `, [
                    record.id,
                    recordQty,
                    duplicate_scan_count || 0,
                    JSON.stringify(duplicate_scan_log || [])
                ]);
            }
        } else if (barcode_source === 'LASER') {
            // Compress and move file
            const fileResult = await compressAndSaveLaserMachineFile(temp_file_path, original_filename, record.id);
            
            await client.query(`
                INSERT INTO smt_serial_batch_documents (
                    batch_id, original_filename, compressed_filename, file_path, original_size, compressed_size, is_compressed, uploaded_by
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [
                record.id,
                original_filename,
                fileResult.fileName,
                fileResult.savedPath,
                fileResult.originalSize,
                fileResult.compressedSize,
                fileResult.isCompressed,
                operator.username
            ]);
        }

        // 8. Log Generation Record Activity
        const logAction = isExisting ? 'Record Updated' : 'Record Created';
        const logDetails = isExisting
            ? `Resumed scanning and appended ${recordQty} Customer Barcodes. New total: ${newTotalQty} for Work Order ${workOrder.id}.`
            : `Serial Generation Record created for Work Order ${workOrder.id} using source ${barcode_source}. Quantity: ${recordQty}.`;

        await client.query(`
            INSERT INTO smt_serial_batch_activity_logs (
                batch_id, action, details, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            record.id,
            logAction,
            logDetails,
            operator.username,
            operator.name
        ]);

        // 9. Update Duration & COMMIT
        const endTime = new Date();
        const durationMs = endTime.getTime() - startTime.getTime();
        
        await client.query(`
            UPDATE smt_serial_batches
            SET generation_end_time = $1,
                generation_duration_ms = COALESCE(generation_duration_ms, 0) + $2
            WHERE id = $3
        `, [endTime, durationMs, record.id]);

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            record: {
                id: record.id,
                generated_quantity: record.generated_quantity,
                status: record.status
            }
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error generating serial record:', err);
        return sendError(res, 500, `Failed to generate serial record: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    } finally {
        client.release();
    }
};

/**
 * GET /api/smt/v1/smt/serial-generation-records
 * Retrieves paginated list of serial generation records.
 */
export const getSerialGenerationRecords = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';
    const sortBy = req.query.sortBy as string || 'created_at';
    const sortOrder = req.query.sortOrder as string || 'DESC';

    // Allowed sort columns
    const allowedSort = ['work_order_number', 'product_name', 'work_order_quantity', 'panel_quantity', 'created_at'];
    const finalSortBy = allowedSort.includes(sortBy) ? sortBy : 'created_at';
    const finalSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
        let query = `
            SELECT id, work_order_number, product_name, work_order_quantity, panel_quantity, barcode_source, status, generated_quantity, created_at, created_by, created_by_name
            FROM smt_serial_batches
            WHERE is_deleted = false
        `;

        const params: any[] = [];

        if (search.trim()) {
            query += ` AND (work_order_number ILIKE $1 OR product_name ILIKE $1)`;
            params.push(`%${search.trim()}%`);
        }

        // Count query
        const countRes = await pool.query(`SELECT COUNT(*) FROM (${query}) AS temp`, params);
        const totalRows = parseInt(countRes.rows[0].count, 10);
        const totalPages = Math.ceil(totalRows / limit);

        // Sorting & pagination
        query += ` ORDER BY ${finalSortBy} ${finalSortOrder} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const recordsRes = await pool.query(query, params);

        return res.json({
            success: true,
            records: recordsRes.rows,
            pagination: {
                currentPage: page,
                limit,
                totalRows,
                totalPages
            }
        });
    } catch (err: any) {
        logger.error('Error in getSerialGenerationRecords:', err);
        return sendError(res, 500, `Failed to retrieve records: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    }
};

/**
 * GET /api/smt/v1/smt/serial-generation-records/:id
 * Retrieves full details of a serial generation record.
 */
export const getSerialGenerationRecordDetails = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const recordRes = await pool.query(`
            SELECT * FROM smt_serial_batches
            WHERE id = $1 AND is_deleted = false
        `, [id]);

        if (recordRes.rows.length === 0) {
            return sendError(res, 404, 'Serial Generation Record not found.', 'RESOURCE_NOT_FOUND');
        }

        const record = recordRes.rows[0];

        // Fetch source config depending on source
        let sourceConfig = null;
        if (record.barcode_source === 'GENERATE') {
            const configRes = await pool.query(`
                SELECT * FROM smt_serial_batch_configs WHERE batch_id = $1
            `, [id]);
            sourceConfig = configRes.rows[0] || null;
        } else if (record.barcode_source === 'CUSTOMER') {
            const scanRes = await pool.query(`
                SELECT * FROM smt_serial_batch_scans WHERE batch_id = $1
            `, [id]);
            sourceConfig = scanRes.rows[0] || null;
        } else if (record.barcode_source === 'LASER') {
            const docRes = await pool.query(`
                SELECT * FROM smt_serial_batch_documents WHERE batch_id = $1
            `, [id]);
            sourceConfig = docRes.rows[0] || null;
        }

        // Fetch audit / activity logs
        const auditRes = await pool.query(`
            SELECT * FROM smt_serial_batch_activity_logs
            WHERE batch_id = $1
            ORDER BY created_at DESC
        `, [id]);

        // Cumulative generated count for this Work Order
        const cumulativeRes = await pool.query(`
            SELECT COALESCE(SUM(generated_quantity), 0) AS cumulative_generated
            FROM smt_serial_batches
            WHERE work_order_id = $1
              AND is_deleted = false
        `, [record.work_order_id]);
        const cumulativeGenerated = parseInt(cumulativeRes.rows[0].cumulative_generated, 10);
        const remainingQuantity = Math.max(0, record.work_order_quantity - cumulativeGenerated);

        return res.json({
            success: true,
            record,
            sourceConfig,
            activityLogs: auditRes.rows,
            cumulativeGenerated,
            remainingQuantity
        });
    } catch (err: any) {
        logger.error('Error in getSerialGenerationRecordDetails:', err);
        return sendError(res, 500, `Failed to retrieve record details: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    }
};

/**
 * GET /api/smt/v1/smt/serial-generation-records/:id/serials
 * Retrieves paginated list of generated serial numbers.
 */
export const getGeneratedSerialNumbers = async (req: Request, res: Response) => {
    const { id } = req.params;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search as string || '';

    try {
        let query = `
            SELECT id, serial_number, status, created_at, created_by
            FROM smt_serial_numbers
            WHERE batch_id = $1
        `;
        const params: any[] = [id];

        if (search.trim()) {
            query += ` AND serial_number ILIKE $2`;
            params.push(`%${search.trim()}%`);
        }

        // Count query
        const countRes = await pool.query(`SELECT COUNT(*) FROM (${query}) AS temp`, params);
        const totalRows = parseInt(countRes.rows[0].count, 10);
        const totalPages = Math.ceil(totalRows / limit);

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const serialsRes = await pool.query(query, params);

        return res.json({
            success: true,
            serials: serialsRes.rows,
            pagination: {
                currentPage: page,
                limit,
                totalRows,
                totalPages
            }
        });
    } catch (err: any) {
        logger.error('Error in getGeneratedSerialNumbers:', err);
        return sendError(res, 500, `Failed to retrieve serial numbers: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    }
};

/**
 * DELETE /api/smt/v1/smt/serial-generation-records/:id
 * Performs soft delete of a serial generation record.
 */
export const deleteSerialGenerationRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getOperator(req);

    // Verify Super Admin permission
    if (operator.role !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: "Only Super Admin is authorized to delete records.",
            error: "Only Super Admin is authorized to delete records."
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if record exists
        const checkRes = await client.query(`
            SELECT work_order_number FROM smt_serial_batches
            WHERE id = $1 AND is_deleted = false
        `, [id]);

        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return sendError(res, 404, 'Serial Generation Record not found or already deleted.', 'RESOURCE_NOT_FOUND');
        }

        const workOrderNumber = checkRes.rows[0].work_order_number;

        // Perform soft delete on the record
        await client.query(`
            UPDATE smt_serial_batches
            SET is_deleted = true,
                deleted_by = $1,
                deleted_by_name = $2,
                deleted_at = NOW()
            WHERE id = $3
        `, [operator.username, operator.name, id]);

        // Log deletion activity in the local activity log
        await client.query(`
            INSERT INTO smt_serial_batch_activity_logs (
                batch_id, action, details, performed_by, performed_by_name
            ) VALUES ($1, 'Record Deleted', $2, $3, $4)
        `, [
            id,
            `Serial Generation Record for Work Order ${workOrderNumber} was deleted.`,
            operator.username,
            operator.name
        ]);

        // Write Audit Log to centralized audit_log table
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'DELETE',
                'SERIAL_GENERATION_RECORD',
                id.toString(),
                operator.name,
                `Serial Generation Record for Work Order ${workOrderNumber} was deleted by Super Admin.`,
                JSON.stringify(checkRes.rows[0]),
                JSON.stringify({
                    userId: operator.id,
                    userName: operator.name,
                    userRole: operator.role,
                    moduleName: 'Serial Generation Record',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        await client.query('COMMIT');

        return res.json({
            success: true,
            message: `Serial Generation Record for Work Order ${workOrderNumber} has been successfully deleted.`
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error deleting serial generation record:', err);
        return sendError(res, 500, `Failed to delete record: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    } finally {
        client.release();
    }
};

/**
 * GET /api/smt/v1/smt/serial-generation-records/:id/document/download
 * Downloads original laser mapping document file.
 */
export const downloadLaserDocument = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const docRes = await pool.query(`
            SELECT file_path, original_filename FROM smt_serial_batch_documents WHERE batch_id = $1
        `, [id]);

        if (docRes.rows.length === 0) {
            return sendError(res, 404, 'Laser document mapping file not found.', 'RESOURCE_NOT_FOUND');
        }

        const doc = docRes.rows[0];
        if (!fs.existsSync(doc.file_path)) {
            return sendError(res, 404, 'Laser document file does not exist on disk.', 'FILE_NOT_FOUND');
        }

        res.setHeader('Content-Disposition', `attachment; filename="${doc.original_filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        fs.createReadStream(doc.file_path).pipe(res);
    } catch (err: any) {
        logger.error('Error in downloadLaserDocument:', err);
        return sendError(res, 500, `Failed to download file: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    }
};

/**
 * GET /api/smt/v1/smt/serial-generation-records/check-serial/:serialNumber
 * Checks if a serial number already exists in the database.
 */
export const checkSerialNumberExists = async (req: Request, res: Response) => {
    const { serialNumber } = req.params;
    try {
        const checkRes = await pool.query(
            'SELECT id FROM smt_serial_numbers WHERE serial_number = $1',
            [serialNumber.trim()]
        );
        return res.json({
            success: true,
            exists: checkRes.rows.length > 0
        });
    } catch (err: any) {
        logger.error('Error checking serial number existence:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/smt/v1/smt/serial-generation-records/active-customer/:workOrderId
 * Retrieves the active customer barcode batch for a work order, along with its scanned serials.
 */
export const getActiveCustomerBatch = async (req: Request, res: Response) => {
    const { workOrderId } = req.params;
    try {
        const batchRes = await pool.query(
            `SELECT id, work_order_id, generated_quantity, status, serial_generation_remarks, additional_notes, work_order_quantity
             FROM smt_serial_batches
             WHERE work_order_id = $1 
               AND barcode_source = 'CUSTOMER' 
               AND is_deleted = false
             LIMIT 1`,
            [workOrderId]
        );

        if (batchRes.rows.length === 0) {
            return res.json({
                success: true,
                hasExisting: false
            });
        }

        const batch = batchRes.rows[0];

        // Fetch scanned serials for this batch
        const serialsRes = await pool.query(
            `SELECT serial_number 
             FROM smt_serial_numbers 
             WHERE batch_id = $1 
             ORDER BY created_at DESC`,
            [batch.id]
        );

        const serials = serialsRes.rows.map(r => r.serial_number);

        return res.json({
            success: true,
            hasExisting: true,
            batch,
            serials
        });
    } catch (err: any) {
        logger.error('Error fetching active customer batch:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
};


/**
 * POST /api/smt/v1/smt/serial-generation-records/:id/scans
 * Appends a scanned customer barcode to the record.
 */
export const addScannedBarcode = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { barcode } = req.body;
    const operator = getOperator(req);

    if (!barcode) {
        return sendError(res, 400, 'Barcode is required.', 'VALIDATION_ERROR');
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Get the Serial Generation Record & lock it
        const recordRes = await client.query(
            'SELECT * FROM smt_serial_batches WHERE id = $1 AND is_deleted = false FOR UPDATE',
            [id]
        );

        if (recordRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return sendError(res, 404, 'Serial Generation Record not found.', 'RESOURCE_NOT_FOUND');
        }

        const record = recordRes.rows[0];
        if (record.barcode_source !== 'CUSTOMER') {
            await client.query('ROLLBACK');
            return sendError(res, 400, 'Scans can only be appended to Customer Barcode records.', 'VALIDATION_ERROR');
        }

        // Check current count vs Work Order quantity
        const currentScanned = record.generated_quantity;
        if (currentScanned >= record.work_order_quantity) {
            await client.query('ROLLBACK');
            return sendError(res, 400, 'Work Order quantity limit already reached.', 'VALIDATION_ERROR');
        }

        const cleanBarcode = barcode.trim();

        // 1. Global Duplicity Check
        const dupCheckRes = await client.query(
            'SELECT id FROM smt_serial_numbers WHERE serial_number = $1',
            [cleanBarcode]
        );
        if (dupCheckRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return sendError(res, 409, 'This barcode has already been scanned. Duplicate barcode is not allowed.', 'DUPLICATE_SERIAL_CONFLICT');
        }

        // 2. Insert into smt_serial_numbers
        const serialRes = await client.query(`
            INSERT INTO smt_serial_numbers (work_order_id, serial_format, serial_number, status, created_by, batch_id)
            VALUES ($1, 'Customer Barcode', $2, 'Generated', $3, $4)
            RETURNING id, serial_number
        `, [record.work_order_id, cleanBarcode, operator.username, record.id]);

        const serialId = serialRes.rows[0].id;

        // 3. Insert inspection step (PASS for 'Serial Number')
        await client.query(`
            INSERT INTO smt_inspections (serial_id, process_step, scanned_by, status)
            VALUES ($1, 'Serial Number', $2, 'PASS')
        `, [serialId, operator.username]);

        // 4. Update smt_serial_batches (generated_quantity = generated_quantity + 1)
        const newQty = currentScanned + 1;
        await client.query(`
            UPDATE smt_serial_batches
            SET generated_quantity = $1,
                updated_by = $2,
                updated_by_name = $3,
                updated_at = NOW()
            WHERE id = $4
        `, [newQty, operator.username, operator.name, record.id]);

        // 5. Update smt_serial_batch_scans
        const scanMetaRes = await client.query(
            'SELECT id FROM smt_serial_batch_scans WHERE batch_id = $1',
            [record.id]
        );
        if (scanMetaRes.rows.length > 0) {
            await client.query(`
                UPDATE smt_serial_batch_scans
                SET total_scanned = $1
                WHERE batch_id = $2
            `, [newQty, record.id]);
        } else {
            await client.query(`
                INSERT INTO smt_serial_batch_scans (batch_id, total_scanned, duplicate_scan_count, duplicate_scan_log)
                VALUES ($1, $2, 0, '[]'::jsonb)
            `, [record.id, newQty]);
        }

        // 6. Log Activity
        await client.query(`
            INSERT INTO smt_serial_batch_activity_logs (
                batch_id, action, details, performed_by, performed_by_name
            ) VALUES ($1, 'Barcode Scanned', $2, $3, $4)
        `, [
            record.id,
            `Appended newly scanned Customer Barcode: ${cleanBarcode}. Scanned Count: ${newQty}, Pending Count: ${record.work_order_quantity - newQty}.`,
            operator.username,
            operator.name
        ]);

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: 'Barcode added successfully.',
            scannedCount: newQty,
            pendingCount: record.work_order_quantity - newQty
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error adding scanned customer barcode:', err);
        return sendError(res, 500, `Failed to add barcode: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    } finally {
        client.release();
    }
};

/**
 * POST /api/smt/v1/smt/serial-generation-records/laser/validate
 * Uploads a laser file, extracts serial numbers, and validates size/magic-bytes/integrity.
 */
export const validateLaserFile = async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
        return sendError(res, 400, 'Laser Machine upload requires a document file.', 'VALIDATION_ERROR');
    }

    try {
        // Validate File Type and Size
        const allowedExts = ['.pdf', '.xls', '.xlsx', '.csv', '.zip', '.txt'];
        const fileExt = allowedExts.find(ext => file.originalname.toLowerCase().endsWith(ext));
        if (!fileExt) {
            try { fs.unlinkSync(file.path); } catch (e) {}
            return sendError(res, 400, 'File extension is not allowed.', 'FILE_TYPE_REJECTED');
        }

        // Validate size (50MB limit)
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            try { fs.unlinkSync(file.path); } catch (e) {}
            return sendError(res, 400, 'File size exceeds maximum 50MB limit.', 'FILE_SIZE_REJECTED');
        }

        // Check Magic Byte Integrity
        const isValid = await checkFileIntegrity(file.path, file.originalname);
        if (!isValid) {
            try { fs.unlinkSync(file.path); } catch (e) {}
            return sendError(res, 422, 'Uploaded file is empty, corrupted, or does not match extension header.', 'FILE_CORRUPTED');
        }

        // Parse serial numbers
        const serials = await parseSerialsFromFile(file.path, file.originalname);

        return res.json({
            success: true,
            serialCount: serials.length,
            serials,
            temp_file_path: file.path,
            original_filename: file.originalname
        });
    } catch (err: any) {
        try { fs.unlinkSync(file.path); } catch (e) {}
        logger.error('Error validating laser file:', err);
        return sendError(res, 500, `Failed to validate laser file: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    }
};

/**
 * POST /api/smt/v1/smt/serial-generation-records/laser/cleanup-temp
 * Deletes a temp file from disk if the user cancels.
 */
export const cleanupTempFile = async (req: Request, res: Response) => {
    const { temp_file_path } = req.body;
    if (temp_file_path && fs.existsSync(temp_file_path)) {
        try {
            fs.unlinkSync(temp_file_path);
        } catch (e) {}
    }
    return res.json({ success: true });
};

/**
 * PUT /v1/smt/serial-generation-records/:id/customer-barcode
 * Updates a single customer barcode / serial number within a transaction.
 */
export const updateCustomerBarcode = async (req: Request, res: Response) => {
    const { id } = req.params;
    let { customerBarcode } = req.body;
    const operator = getOperator(req);

    // 1. Validate: Barcode is not empty after trimming
    if (customerBarcode === undefined || customerBarcode === null) {
        return sendError(res, 400, 'Customer barcode cannot be empty.', 'VALIDATION_ERROR');
    }
    if (typeof customerBarcode !== 'string') {
        return sendError(res, 400, 'Customer barcode must be a string.', 'VALIDATION_ERROR');
    }
    customerBarcode = customerBarcode.trim();
    if (!customerBarcode) {
        return sendError(res, 400, 'Customer barcode cannot be empty.', 'VALIDATION_ERROR');
    }

    const client = await pool.connect();
    try {
        // Fetch the serial number and its associated batch/record details
        const querySerial = `
            SELECT sn.id, sn.serial_number, sn.batch_id, sb.barcode_source, sb.work_order_number
            FROM smt_serial_numbers sn
            JOIN smt_serial_batches sb ON sn.batch_id = sb.id
            WHERE sn.id = $1 AND sb.is_deleted = false
        `;
        const serialRes = await client.query(querySerial, [id]);
        if (serialRes.rows.length === 0) {
            client.release();
            return sendError(res, 404, 'Serial number record not found.', 'NOT_FOUND');
        }

        const serialRecord = serialRes.rows[0];
        const oldBarcode = serialRecord.serial_number;
        const batchId = serialRecord.batch_id;
        const barcodeSource = serialRecord.barcode_source;
        const workOrderNumber = serialRecord.work_order_number;

        // 2. Validate: Barcode Source is CUSTOMER
        if (barcodeSource !== 'CUSTOMER') {
            client.release();
            return sendError(res, 422, 'Editing is only allowed for Customer Barcode records.', 'UNPROCESSABLE_ENTITY');
        }

        // 3. Validate: Barcode is different from the current value
        if (oldBarcode === customerBarcode) {
            client.release();
            return sendError(res, 400, 'No changes detected.', 'NO_CHANGES');
        }

        // 4. Validate: Barcode is unique across all records
        const queryUnique = `SELECT id FROM smt_serial_numbers WHERE serial_number = $1 AND id <> $2`;
        const uniqueRes = await client.query(queryUnique, [customerBarcode, id]);
        if (uniqueRes.rows.length > 0) {
            client.release();
            return sendError(res, 409, 'Barcode already exists.', 'DUPLICATE_ERROR');
        }

        // 5. Start transaction
        await client.query('BEGIN');

        // Update the serial number
        const updateSerialQuery = `
            UPDATE smt_serial_numbers
            SET serial_number = $1
            WHERE id = $2
            RETURNING *
        `;
        const updateRes = await client.query(updateSerialQuery, [customerBarcode, id]);

        // Update batch audit metadata
        const updateBatchQuery = `
            UPDATE smt_serial_batches
            SET updated_by = $1, updated_by_name = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
        `;
        await client.query(updateBatchQuery, [operator.username, operator.name, batchId]);

        // Insert batch activity log
        const activityQuery = `
            INSERT INTO smt_serial_batch_activity_logs (
                batch_id, action, details, changed_fields, performed_by, performed_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `;
        const activityDetails = `Customer Barcode updated from '${oldBarcode}' to '${customerBarcode}' for Work Order ${workOrderNumber}.`;
        const changedFields = JSON.stringify({
            serial_number: {
                old: oldBarcode,
                new: customerBarcode
            }
        });
        await client.query(activityQuery, [
            batchId,
            'Barcode Updated',
            activityDetails,
            changedFields,
            operator.username,
            operator.name
        ]);

        // Insert audit log
        const auditQuery = `
            INSERT INTO audit_log (
                event_type, entity_type, entity_id, actor, description, old_value, new_value
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        const auditDescription = `Customer Barcode updated from '${oldBarcode}' to '${customerBarcode}' for Work Order ${workOrderNumber} by ${operator.name}.`;
        const oldValJson = JSON.stringify({
            serial_number_id: id,
            batch_id: batchId,
            work_order_number: workOrderNumber,
            serial_number: oldBarcode,
            updated_by: operator.username,
            updated_at: new Date().toISOString()
        });
        const newValJson = JSON.stringify({
            serial_number_id: id,
            batch_id: batchId,
            work_order_number: workOrderNumber,
            serial_number: customerBarcode,
            updated_by: operator.username,
            updated_at: new Date().toISOString()
        });
        await client.query(auditQuery, [
            'UPDATE',
            'CUSTOMER_BARCODE',
            id.toString(),
            operator.name,
            auditDescription,
            oldValJson,
            newValJson
        ]);

        await client.query('COMMIT');
        client.release();

        return res.status(200).json({
            success: true,
            message: 'Barcode updated successfully.',
            record: updateRes.rows[0]
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        client.release();
        logger.error('Error updating customer barcode:', err);
        return sendError(res, 500, `Unexpected server error: ${err.message}`, 'INTERNAL_SERVER_ERROR');
    }
};

/**
 * GET /v1/smt/serial-generation-records/:id/export/excel
 * Exports a serial generation batch to a professionally formatted Excel spreadsheet.
 */
export const exportSerialGenerationExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getOperator(req);

    // Validate UUID format before querying to avoid postgres errors
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
        return sendError(res, 404, 'Serial Generation Record not found.', 'RESOURCE_NOT_FOUND');
    }

    try {
        // 1. Fetch batch details
        const batchRes = await pool.query(`
            SELECT * FROM smt_serial_batches
            WHERE id = $1 AND is_deleted = false
        `, [id]);

        if (batchRes.rows.length === 0) {
            return sendError(res, 404, 'Serial Generation Record not found.', 'RESOURCE_NOT_FOUND');
        }
        const batch = batchRes.rows[0];

        // 2. Fetch all generated serial numbers
        const serialsRes = await pool.query(`
            SELECT serial_number, status, created_at, created_by
            FROM smt_serial_numbers
            WHERE batch_id = $1
            ORDER BY created_at ASC
        `, [id]);
        const serials = serialsRes.rows;

        // Check for empty serial generation record business rule
        if (serials.length === 0) {
            return sendError(res, 400, 'Serial generation record has no generated serial numbers.', 'EMPTY_RECORD');
        }

        // Create workbook and stream it
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SFCS SMT System';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('Serial Numbers Report', {
            pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true }
        });

        // Formatting definitions
        const NAVY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        const BLUE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
        const LIGHT_GRAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        const WHITE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        const WHITE_FONT = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' }, bold: true };
        const DARK_FONT = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        const BOLD_DARK = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' }, bold: true };

        const thinBorder: Partial<ExcelJS.Borders> = {
            top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        };

        const formatExcelDate = (dateVal: Date | string | null | undefined): string => {
            if (!dateVal) return '';
            const date = new Date(dateVal);
            if (isNaN(date.getTime())) return '';
            
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const day = String(date.getDate()).padStart(2, '0');
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            
            let hours = date.getHours();
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            const strTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
            
            return `${day}-${month}-${year} ${strTime}`;
        };

        let r = 1;

        // Title Banner
        ws.getRow(r).height = 35;
        const titleCell = ws.getCell(`A${r}`);
        titleCell.value = '🔢 SMT SERIAL NUMBER GENERATION REPORT';
        titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = NAVY;
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:F${r}`); // merged up to F since there are 6 columns in the table
        r++;

        // Spacer
        r++;

        // Metadata KV Helper
        const addKVRow = (label: string, value: any) => {
            const row = ws.getRow(r);
            row.height = 20;
            const lCell = ws.getCell(`A${r}`);
            lCell.value = label;
            lCell.font = BOLD_DARK;
            lCell.fill = LIGHT_GRAY;
            lCell.border = thinBorder;
            lCell.alignment = { vertical: 'middle', indent: 1 };
            ws.mergeCells(`A${r}:B${r}`);

            const vCell = ws.getCell(`C${r}`);
            vCell.value = value !== null && value !== undefined ? value : '';
            vCell.font = DARK_FONT;
            vCell.fill = WHITE_FILL;
            vCell.border = thinBorder;
            vCell.alignment = { vertical: 'middle', indent: 1, wrapText: true };
            ws.mergeCells(`C${r}:F${r}`);
            r++;
        };

        addKVRow('Serial Number Generated Date', formatExcelDate(batch.created_at));
        addKVRow('Work Order Number', batch.work_order_number);
        addKVRow('PO ID', batch.po_id);
        addKVRow('Product Name', batch.product_name);
        addKVRow('Product Description', batch.product_description);
        addKVRow('Work Order Qty', batch.work_order_quantity);
        addKVRow('Panel Qty', batch.panel_quantity);
        addKVRow('Number of Sides', batch.sides);
        addKVRow('Line ID', batch.line_id);
        addKVRow('Work Order Remarks', batch.work_order_remarks);

        // Spacer
        r++;

        // Table Header
        const headerRowIndex = r;
        ws.getRow(headerRowIndex).height = 24;

        const tableHeaders = [
            'Sl. No.',
            'Serial Number',
            'Customer Barcode (if available)',
            'Barcode Source',
            'Generated Date & Time',
            'Generated By'
        ];

        tableHeaders.forEach((h, i) => {
            const colLetter = String.fromCharCode(65 + i);
            const cell = ws.getCell(`${colLetter}${headerRowIndex}`);
            cell.value = h;
            cell.font = WHITE_FONT;
            cell.fill = BLUE;
            cell.border = thinBorder;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        r++;

        // Data Rows
        serials.forEach((s, idx) => {
            const row = ws.getRow(r);
            row.height = 18;
            const rowFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };

            const setCell = (colLetter: string, val: any, align: Partial<ExcelJS.Alignment> = {}) => {
                const cell = ws.getCell(`${colLetter}${r}`);
                cell.value = val !== null && val !== undefined ? val : '';
                cell.font = DARK_FONT;
                cell.fill = rowFill;
                cell.border = thinBorder;
                cell.alignment = { vertical: 'middle', wrapText: true, ...align };
            };

            const isCust = batch.barcode_source === 'CUSTOMER';
            const barcodeSrcLabel = 
                batch.barcode_source === 'GENERATE' ? 'Generate Barcode' :
                batch.barcode_source === 'CUSTOMER' ? 'Customer Barcode' :
                batch.barcode_source === 'LASER' ? 'Laser Machine' : batch.barcode_source;

            setCell('A', idx + 1, { horizontal: 'center' }); // Sl. No. (numeric) - centered
            setCell('B', s.serial_number, { horizontal: 'left', indent: 1 });
            setCell('C', isCust ? s.serial_number : '', { horizontal: 'left', indent: 1 });
            setCell('D', barcodeSrcLabel, { horizontal: 'center' });
            setCell('E', formatExcelDate(s.created_at), { horizontal: 'center' });
            setCell('F', s.created_by || batch.created_by_name || '', { horizontal: 'left', indent: 1 });

            r++;
        });

        // Set freeze view below header row
        ws.views = [{ state: 'frozen', xSplit: 0, ySplit: headerRowIndex, activeCell: `A${headerRowIndex + 1}` }];

        // Auto-adjust column widths based on data rows
        const colLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
        const defaultWidths = [10, 25, 35, 20, 25, 20];
        colLetters.forEach((colLetter, i) => {
            let maxLen = tableHeaders[i].length;
            for (let rowIdx = headerRowIndex + 1; rowIdx < r; rowIdx++) {
                const val = ws.getCell(`${colLetter}${rowIdx}`).value;
                if (val !== null && val !== undefined) {
                    maxLen = Math.max(maxLen, String(val).length);
                }
            }
            ws.getColumn(colLetter).width = Math.min(50, Math.max(defaultWidths[i], maxLen + 4));
        });

        // Audit Log
        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description) VALUES ($1, $2, $3, $4, $5)`,
            ['EXPORT', 'SERIAL_GENERATION_RECORD', id, operator.name, `Exported serial generation record (Work Order ${batch.work_order_number}) to Excel.`]
        );

        // Stream direct to client response
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${batch.work_order_number}_Serial_Generation.xlsx`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error('Error exporting serial generation record to Excel:', err);
        return res.status(500).json({ success: false, error: 'Internal server error while exporting Excel.' });
    }
};

