import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { parseExcelFile, ParsedSheet } from '../services/excelParserService';
import { getClient, pool } from '../utils/db';
import { createLogger } from '../utils/logger';
import { getUploadsDir } from '../utils/uploads';

const logger = createLogger('MasterDataController');

// Helper to sanitize Work Order ID for filenames
export const sanitizeWorkOrderId = (woId: string): string => {
    return woId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
};

// Periodic & Startup cleanup for abandoned temp files
export const cleanupAbandonedTempFiles = () => {
    try {
        const tempDir = path.join(getUploadsDir(), 'rrh', 'temp');
        if (!fs.existsSync(tempDir)) return;

        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        const maxAgeMs = 30 * 60 * 1000; // 30 minutes TTL

        for (const file of files) {
            const filePath = path.join(tempDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > maxAgeMs) {
                    fs.unlinkSync(filePath);
                    logger.info(`[TempCleanup] Cleaned up abandoned temp file: ${file}`);
                }
            } catch (err: any) {
                logger.warn(`[TempCleanup] Failed to stat/unlink file ${file}: ${err.message}`);
            }
        }
    } catch (err: any) {
        logger.error(`[TempCleanup] Error running temp cleanup: ${err.message}`);
    }
};

// Run on module load and every 30 minutes
cleanupAbandonedTempFiles();
setInterval(cleanupAbandonedTempFiles, 30 * 60 * 1000);

const parseSafeDate = (val: string | null | undefined): string | null => {
    if (!val || !val.trim()) return null;
    const trimmed = val.trim();
    try {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
            return d.toISOString().split('T')[0];
        }
        const parts = trimmed.split(/[-/]/);
        if (parts.length === 3) {
            if (parts[2].length === 4) {
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const year = parseInt(parts[2], 10);
                const pd = new Date(year, month, day);
                if (!isNaN(pd.getTime())) {
                    return pd.toISOString().split('T')[0];
                }
            }
        }
    } catch {}
    return null;
};


/**
 * POST /api/rrh/work-orders/parse-excel
 * POST /api/rrh/work-orders/:id/master/preview
 * Uploads to temp, parses, validates, and returns exact preview structure.
 * Automatically deletes temp file immediately on error.
 */
export const previewMasterData = async (req: Request, res: Response) => {
    let filePath: string | null = null;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No Excel file was uploaded.' });
        }

        filePath = req.file.path;
        logger.info(`Preview requested for file: ${req.file.originalname} (temp: ${req.file.filename})`);

        const parsedData = await parseExcelFile(filePath);

        return res.status(200).json({
            success: true,
            message: 'Preview generated successfully.',
            fileName: req.file.filename,
            originalName: req.file.originalname,
            totalRows: parsedData.totalRows,
            totalColumns: parsedData.totalColumns,
            fileHash: parsedData.fileHash,
            fileSize: parsedData.fileSize,
            data: parsedData
        });
    } catch (error: any) {
        logger.error(`Preview Error: ${error.message}`);
        // Mandatory cleanup: Delete temporary file immediately on error
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                logger.info(`[Cleanup] Deleted invalid temp file: ${filePath}`);
            } catch (unlinkErr: any) {
                logger.warn(`[Cleanup] Could not unlink invalid temp file: ${unlinkErr.message}`);
            }
        }
        return res.status(400).json({
            success: false,
            error: error.message || 'Unable to parse Excel file. Please ensure it follows the approved template.'
        });
    }
};

/**
 * DELETE /api/rrh/work-orders/temp-file/:fileName
 * Proactively unlinks a temporary file when user clicks Remove File, Clear, or cancels.
 */
export const deleteTempFile = async (req: Request, res: Response) => {
    try {
        const rawFileName = req.params.fileName;
        if (!rawFileName) {
            return res.status(400).json({ success: false, error: 'File name is required.' });
        }

        // Prevent path traversal
        const fileName = path.basename(rawFileName);
        const tempDir = path.join(getUploadsDir(), 'rrh', 'temp');
        const targetPath = path.join(tempDir, fileName);

        if (fs.existsSync(targetPath)) {
            fs.unlinkSync(targetPath);
            logger.info(`[Cleanup] Explicitly deleted temp file: ${fileName}`);
            return res.status(200).json({ success: true, message: 'Temporary file deleted successfully.' });
        }

        return res.status(200).json({ success: true, message: 'File not present or already removed.' });
    } catch (error: any) {
        logger.error(`Delete temp file error: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Failed to delete temporary file.' });
    }
};

/**
 * Unified batch insertion helper for Master Data.
 * Uses UNNEST and pre-allocated sequence IDs to guarantee 100% deterministic
 * row-to-cell and parent-to-child foreign key mappings.
 */
export const insertMasterDataIntoDb = async (
    client: any,
    importId: number,
    sheetId: number,
    parsedData: ParsedSheet
) => {
    // 1. Insert Merged Cells
    if (parsedData.merges.length > 0) {
        const mRange = parsedData.merges.map(m => m.rangeReference);
        const mStartRow = parsedData.merges.map(m => m.startRow);
        const mStartCol = parsedData.merges.map(m => m.startColumn);
        const mEndRow = parsedData.merges.map(m => m.endRow);
        const mEndCol = parsedData.merges.map(m => m.endColumn);
        const mRowSpan = parsedData.merges.map(m => m.rowSpan);
        const mColSpan = parsedData.merges.map(m => m.colSpan);
        const mSheetIds = parsedData.merges.map(() => sheetId);

        await client.query(
            `INSERT INTO rrh_excel_merged_cells 
             (sheet_id, range_reference, start_row, start_column, end_row, end_column, row_span, column_span)
             SELECT * FROM UNNEST($1::int[], $2::text[], $3::int[], $4::int[], $5::int[], $6::int[], $7::int[], $8::int[])`,
            [mSheetIds, mRange, mStartRow, mStartCol, mEndRow, mEndCol, mRowSpan, mColSpan]
        );
    }

    // 2. Batch Insert Rows with explicit row_number mapping
    const rowParams = {
        sheetId: parsedData.rows.map(() => sheetId),
        rowNumber: parsedData.rows.map(r => r.rowNumber),
        rowType: parsedData.rows.map(r => r.rowType)
    };

    const rowsInsertRes = await client.query(
        `INSERT INTO rrh_excel_rows (sheet_id, row_number, row_type)
         SELECT * FROM UNNEST($1::int[], $2::int[], $3::text[])
         RETURNING id, row_number`,
        [rowParams.sheetId, rowParams.rowNumber, rowParams.rowType]
    );

    // Explicit Map: row_number -> DB row_id
    const rowIdMap = new Map<number, number>();
    for (const row of rowsInsertRes.rows) {
        rowIdMap.set(parseInt(row.row_number, 10), parseInt(row.id, 10));
    }

    // 3. Batch Insert Cells (attached strictly to dbRowId resolved by row_number)
    const allCellRowIds: number[] = [];
    const allCellColNums: number[] = [];
    const allCellColLetters: string[] = [];
    const allCellRawValues: (string | null)[] = [];
    const allCellDisplayValues: (string | null)[] = [];
    const allCellDataTypes: string[] = [];

    for (const r of parsedData.rows) {
        const dbRowId = rowIdMap.get(r.rowNumber);
        if (!dbRowId) continue;
        for (const c of r.cells) {
            allCellRowIds.push(dbRowId);
            allCellColNums.push(c.columnNumber);
            allCellColLetters.push(c.columnLetter);
            allCellRawValues.push(c.rawValue !== undefined ? c.rawValue : null);
            allCellDisplayValues.push(c.displayValue !== undefined ? c.displayValue : null);
            allCellDataTypes.push(c.dataType || 'string');
        }
    }

    if (allCellRowIds.length > 0) {
        const CHUNK = 5000;
        for (let i = 0; i < allCellRowIds.length; i += CHUNK) {
            const s = <T>(arr: T[]): T[] => arr.slice(i, i + CHUNK);
            await client.query(
                `INSERT INTO rrh_excel_cells (row_id, column_number, column_letter, raw_value, display_value, data_type)
                 SELECT * FROM UNNEST($1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[])`,
                [s(allCellRowIds), s(allCellColNums), s(allCellColLetters), s(allCellRawValues), s(allCellDisplayValues), s(allCellDataTypes)]
            );
        }
    }

    // 4. Batch Insert Normalized Inventory Data (Row 3+)
    const dataRows = parsedData.rows.filter(r => r.rowType === 'DATA');
    if (dataRows.length > 0) {
        const getVal = (r: any, colNum: number) => {
            const cell = r.cells.find((cl: any) => cl.columnNumber === colNum);
            return cell && cell.displayValue ? cell.displayValue.trim() : null;
        };

        // Pre-allocate inventory IDs from the sequence to guarantee 1-to-1 deterministic relationship
        const idRes = await client.query(
            "SELECT nextval('public.rrh_inventory_id_seq')::int AS id FROM generate_series(1, $1)",
            [dataRows.length]
        );
        const inventoryIds = idRes.rows.map((row: any) => parseInt(row.id, 10));

        // Log warning if any data row's value equals column header names (without changing ingestion behavior)
        for (const r of dataRows) {
            const sl = getVal(r, 1);
            const band = getVal(r, 5);
            if (sl && (sl.toLowerCase() === 'sl no' || sl.toLowerCase() === 'sl_no' || sl.toLowerCase() === 'sl.no.')) {
                logger.warn(`[HeaderCollisionWarning] Row ${r.rowNumber} has sl_no equal to header text: '${sl}'. Ingesting per protocol.`);
            }
            if (band && (band.toLowerCase() === 'band serial no' || band.toLowerCase() === 'band_serial_no')) {
                logger.warn(`[HeaderCollisionWarning] Row ${r.rowNumber} has band_serial_no equal to header text: '${band}'. Ingesting per protocol.`);
            }
        }

        await client.query(
            `INSERT INTO rrh_inventory 
             (id, import_id, sl_no, tejas_dc_no, tejas_obd_no, physical_tpn, band_serial_no, pr_no, 
              invoice_rma_no, vendor_name_for_rework, coordinator_name, issued_date, lot, remarks, failure_description, remarks_2)
             SELECT * FROM UNNEST($1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[], $12::date[], $13::text[], $14::text[], $15::text[], $16::text[])`,
            [
                inventoryIds,
                dataRows.map(() => importId),
                dataRows.map(r => getVal(r, 1)),
                dataRows.map(r => getVal(r, 2)),
                dataRows.map(r => getVal(r, 3)),
                dataRows.map(r => getVal(r, 4)),
                dataRows.map(r => getVal(r, 5)),
                dataRows.map(r => getVal(r, 6)),
                dataRows.map(r => getVal(r, 7)),
                dataRows.map(r => getVal(r, 8)),
                dataRows.map(r => getVal(r, 9)),
                dataRows.map(r => parseSafeDate(getVal(r, 10))),
                dataRows.map(r => getVal(r, 11)),
                dataRows.map(r => getVal(r, 12)),
                dataRows.map(r => getVal(r, 13)),
                dataRows.map(r => getVal(r, 14))
            ]
        );

        await client.query(
            `INSERT INTO rrh_existing_inventory 
             (inventory_id, rfpc_no, pam0_sl_no, pam1_sl_no, pam2_sl_no, pam3_sl_no, lna_sl_no, rfpc_model_no, sw_version, sfp0_serial_no, sfp1_serial_no)
             SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[], $11::text[])`,
            [
                inventoryIds,
                dataRows.map(r => getVal(r, 15)),
                dataRows.map(r => getVal(r, 16)),
                dataRows.map(r => getVal(r, 17)),
                dataRows.map(r => getVal(r, 18)),
                dataRows.map(r => getVal(r, 19)),
                dataRows.map(r => getVal(r, 20)),
                dataRows.map(r => getVal(r, 21)),
                dataRows.map(r => getVal(r, 22)),
                dataRows.map(r => getVal(r, 23)),
                dataRows.map(r => getVal(r, 24))
            ]
        );

        await client.query(
            `INSERT INTO rrh_replaced_inventory 
             (inventory_id, rfpc_no, pam0_sl_no, pam1_sl_no, pam2_sl_no, pam3_sl_no, lna_sl_no, sfp0_serial_no, sfp1_serial_no)
             SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::text[])`,
            [
                inventoryIds,
                dataRows.map(r => getVal(r, 25)),
                dataRows.map(r => getVal(r, 26)),
                dataRows.map(r => getVal(r, 27)),
                dataRows.map(r => getVal(r, 28)),
                dataRows.map(r => getVal(r, 29)),
                dataRows.map(r => getVal(r, 30)),
                dataRows.map(r => getVal(r, 31)),
                dataRows.map(r => getVal(r, 32))
            ]
        );
    }
};

/**
 * POST /api/rrh/work-orders
 * Creates or updates a Work Order, supporting optional direct upload or previewed temp file.
 */
export const createWorkOrder = async (req: Request, res: Response) => {
    let client;
    let tempPathToCleanup: string | null = null;
    try {
        const rawWoId = req.body.work_order_id || req.body.workOrderId;
        const woDate = req.body.work_order_date || req.body.date || new Date().toISOString().split('T')[0];
        const lotQty = parseInt(req.body.lot_quantity || req.body.lotQuantity, 10);
        const tempFileName = req.body.temp_filename || req.body.tempFileName;
        const originalName = req.body.original_filename || req.body.originalName || req.file?.originalname;
        const createdBy = (req as any).user?.name || (req as any).user?.email || 'System';

        if (!rawWoId || !rawWoId.trim()) {
            return res.status(400).json({ success: false, error: 'Work Order ID is required.' });
        }
        if (isNaN(lotQty) || lotQty <= 0) {
            return res.status(400).json({ success: false, error: 'Lot Quantity must be a positive number.' });
        }

        const cleanWoId = sanitizeWorkOrderId(rawWoId);
        logger.info(`Processing Work Order creation/import for: "${cleanWoId}"`);

        // Check if there is an Excel file to process (either direct file or tempFileName)
        let excelSourcePath: string | null = null;
        if (req.file) {
            excelSourcePath = req.file.path;
            tempPathToCleanup = excelSourcePath;
        } else if (tempFileName) {
            const candidate = path.join(getUploadsDir(), 'rrh', 'temp', path.basename(tempFileName));
            if (fs.existsSync(candidate)) {
                excelSourcePath = candidate;
                tempPathToCleanup = candidate;
            } else {
                return res.status(404).json({
                    success: false,
                    error: 'Temporary preview file expired or not found. Please select the file again.'
                });
            }
        }

        client = await getClient();
        await client.query('BEGIN');

        // Check if work order already exists
        const woCheck = await client.query(
            'SELECT id, work_order_id, active_import_id FROM rrh_work_orders WHERE work_order_id = $1 FOR UPDATE',
            [cleanWoId]
        );

        let woId: number;
        const isExisting = woCheck.rows.length > 0;

        if (isExisting) {
            woId = woCheck.rows[0].id;
            await client.query(
                `UPDATE rrh_work_orders 
                 SET work_order_date = $1, date = $1, lot_quantity = $2, updated_at = NOW() 
                 WHERE id = $3`,
                [woDate, lotQty, woId]
            );
        } else {
            const insertWo = await client.query(
                `INSERT INTO rrh_work_orders (work_order_id, work_order_date, date, lot_quantity, status, created_by)
                 VALUES ($1, $2, $2, $3, $4, $5) RETURNING id`,
                [cleanWoId, woDate, lotQty, 'CREATED', createdBy]
            );
            woId = insertWo.rows[0].id;
        }

        // If an Excel source is provided, perform complete Master Data replacement
        let importId: number | null = null;
        let parsedData: ParsedSheet | null = null;

        if (excelSourcePath) {
            parsedData = await parseExcelFile(excelSourcePath);

            // Re-upload rule: Completely remove previous master data for this work order
            if (isExisting) {
                const scanCheck = await client.query(
                    'SELECT 1 FROM rrh_inward_scans WHERE work_order_id = $1 AND is_deleted = false LIMIT 1',
                    [cleanWoId]
                );
                if (scanCheck.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        error: `Cannot overwrite master data for work order "${cleanWoId}" because inward scans have already been recorded.`
                    });
                }
                logger.info(`Work Order "${cleanWoId}" already exists. Completely replacing previous master data.`);
                await client.query('DELETE FROM rrh_excel_imports WHERE work_order_id = $1', [woId]);
            }

            const storedFilename = `${cleanWoId}.xlsx`;
            const relativeStoredPath = `rrh/${storedFilename}`;
            const finalFilePath = path.join(getUploadsDir(), 'rrh', storedFilename);

            // 1. Insert into rrh_excel_imports
            const importRes = await client.query(
                `INSERT INTO rrh_excel_imports 
                 (work_order_id, revision, original_filename, stored_filename, file_path, file_hash, status, confirmed_at)
                 VALUES ($1, 1, $2, $3, $4, $5, 'CONFIRMED', NOW()) RETURNING id`,
                [woId, originalName || storedFilename, storedFilename, relativeStoredPath, parsedData.fileHash]
            );
            importId = importRes.rows[0].id;

            // 2. Insert Sheet
            const sheetRes = await client.query(
                `INSERT INTO rrh_excel_sheets (import_id, sheet_name, sheet_index, total_rows, total_columns)
                 VALUES ($1, $2, 1, $3, $4) RETURNING id`,
                [importId, parsedData.sheetName, parsedData.totalRows, parsedData.totalColumns]
            );
            const sheetId = sheetRes.rows[0].id;

            // 3. Insert Master Data rows/cells/inventory using shared helper
            await insertMasterDataIntoDb(client, importId!, sheetId, parsedData);

            // Update Work Order with Master references
            await client.query(
                `UPDATE rrh_work_orders 
                 SET active_import_id = $1, 
                     status = 'COMPLETED',
                     excel_filename = $2,
                     excel_file_path = $3,
                     excel_file_size = $4,
                     total_excel_rows = $5,
                     updated_at = NOW()
                 WHERE id = $6`,
                [importId, originalName || storedFilename, relativeStoredPath, parsedData.fileSize, parsedData.totalRows, woId]
            );

            // Promote physical file
            fs.copyFileSync(excelSourcePath, finalFilePath);
            try {
                fs.unlinkSync(excelSourcePath);
            } catch {}
            tempPathToCleanup = null;
            logger.info(`Physical file promoted cleanly to: ${finalFilePath}`);
        }

        await client.query('COMMIT');

        // Fetch refreshed record
        const finalWo = await client.query('SELECT * FROM rrh_work_orders WHERE id = $1', [woId]);

        return res.status(201).json({
            success: true,
            message: isExisting
                ? `RRH Work Order "${cleanWoId}" and Master Data replaced successfully.`
                : `RRH Work Order "${cleanWoId}" created successfully.`,
            data: finalWo.rows[0],
            importId
        });
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Create/Import Work Order Error: ${error.message}`);

        // Cleanup temporary file on failure
        if (tempPathToCleanup && fs.existsSync(tempPathToCleanup)) {
            try {
                fs.unlinkSync(tempPathToCleanup);
                logger.info(`[Cleanup] Deleted temporary file after failure: ${tempPathToCleanup}`);
            } catch {}
        }

        if (error.code === '23505') {
            return res.status(409).json({
                success: false,
                error: `Work Order already exists. Please use confirmation to update.`
            });
        }

        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to save RRH Work Order.'
        });
    } finally {
        if (client) client.release();
    }
};

/**
 * POST /api/rrh/work-orders/:id/master/confirm
 * Atomically confirms, replaces, and promotes Master Excel data for a Work Order.
 */
export const confirmMasterData = async (req: Request, res: Response) => {
    let client;
    let tempPathToCleanup: string | null = null;
    try {
        const rawWoId = req.params.id || req.body.workOrderId || req.body.work_order_id;
        const fileName = req.body.fileName || req.body.tempFileName || req.body.temp_filename;
        const originalName = req.body.originalName || req.body.originalFileName || req.body.original_filename || fileName;

        if (!rawWoId || !fileName) {
            return res.status(400).json({ success: false, error: 'Work Order ID and fileName are required.' });
        }

        const cleanWoId = sanitizeWorkOrderId(rawWoId);
        const tempFilePath = path.join(getUploadsDir(), 'rrh', 'temp', path.basename(fileName));

        if (!fs.existsSync(tempFilePath)) {
            return res.status(404).json({
                success: false,
                error: 'Temporary Excel file not found or expired. Please upload again.'
            });
        }

        tempPathToCleanup = tempFilePath;
        logger.info(`Confirming Master Data for WO "${cleanWoId}" using temp: ${fileName}`);

        // Parse file to ensure data integrity
        const parsedData = await parseExcelFile(tempFilePath);

        client = await getClient();
        await client.query('BEGIN');

        // Concurrency lock: support both numeric id and work_order_id string
        const numId = parseInt(rawWoId, 10);
        let woRes;
        if (!isNaN(numId) && String(numId) === String(rawWoId).trim()) {
            woRes = await client.query(
                'SELECT id, work_order_id FROM rrh_work_orders WHERE id = $1 FOR UPDATE',
                [numId]
            );
        } else {
            woRes = await client.query(
                'SELECT id, work_order_id FROM rrh_work_orders WHERE work_order_id = $1 FOR UPDATE',
                [cleanWoId]
            );
        }

        let woId: number;
        let finalWoStr: string;
        if (woRes.rows.length === 0) {
            const insertWo = await client.query(
                `INSERT INTO rrh_work_orders (work_order_id, status) VALUES ($1, 'IMPORTING') RETURNING id, work_order_id`,
                [cleanWoId]
            );
            woId = insertWo.rows[0].id;
            finalWoStr = cleanWoId;
        } else {
            woId = woRes.rows[0].id;
            finalWoStr = woRes.rows[0].work_order_id;
            // Guard: Check if active inward scans exist for this work order
            const scanCheck = await client.query(
                'SELECT 1 FROM rrh_inward_scans WHERE work_order_id = $1 AND is_deleted = false LIMIT 1',
                [finalWoStr]
            );
            if (scanCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: `Cannot overwrite master data for work order "${finalWoStr}" because inward scans have already been recorded.`
                });
            }
            // Complete replacement: delete previous import cascade
            await client.query('DELETE FROM rrh_excel_imports WHERE work_order_id = $1', [woId]);
        }

        const storedFilename = `${finalWoStr}.xlsx`;
        const relativeStoredPath = `rrh/${storedFilename}`;
        const finalFilePath = path.join(getUploadsDir(), 'rrh', storedFilename);

        // 1. Insert Import
        const importRes = await client.query(
            `INSERT INTO rrh_excel_imports 
             (work_order_id, revision, original_filename, stored_filename, file_path, file_hash, status, confirmed_at)
             VALUES ($1, 1, $2, $3, $4, $5, 'CONFIRMED', NOW()) RETURNING id`,
            [woId, originalName, storedFilename, relativeStoredPath, parsedData.fileHash]
        );
        const importId = importRes.rows[0].id;

        // 2. Insert Sheets
        const sheetRes = await client.query(
            `INSERT INTO rrh_excel_sheets (import_id, sheet_name, sheet_index, total_rows, total_columns)
             VALUES ($1, $2, 1, $3, $4) RETURNING id`,
            [importId, parsedData.sheetName, parsedData.totalRows, parsedData.totalColumns]
        );
        const sheetId = sheetRes.rows[0].id;

        // 3. Insert Master Data rows/cells/inventory using shared helper
        await insertMasterDataIntoDb(client, importId, sheetId, parsedData);

        // Update Work Order
        await client.query(
            `UPDATE rrh_work_orders 
             SET active_import_id = $1, 
                 status = 'COMPLETED',
                 excel_filename = $2,
                 excel_file_path = $3,
                 excel_file_size = $4,
                 total_excel_rows = $5,
                 updated_at = NOW()
             WHERE id = $6`,
            [importId, originalName, relativeStoredPath, parsedData.fileSize, parsedData.totalRows, woId]
        );

        // Commit database transaction
        await client.query('COMMIT');
        logger.info(`Database transaction committed successfully for WO: ${cleanWoId}`);

        // Promote physical file
        fs.copyFileSync(tempFilePath, finalFilePath);
        try {
            fs.unlinkSync(tempFilePath);
        } catch {}
        tempPathToCleanup = null;
        logger.info(`Promoted confirmed file to: ${finalFilePath}`);

        return res.status(200).json({
            success: true,
            message: 'Master Data successfully confirmed and saved.',
            importId
        });
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Confirm Master Data Error: ${error.message}`);

        if (tempPathToCleanup && fs.existsSync(tempPathToCleanup)) {
            try {
                fs.unlinkSync(tempPathToCleanup);
            } catch {}
        }

        return res.status(500).json({
            success: false,
            error: error.message || 'Transaction failed. Existing master data preserved.'
        });
    } finally {
        if (client) client.release();
    }
};

/**
 * GET /api/rrh/work-orders
 * Lists RRH Work Orders with pagination, search by ID, and date filter.
 */
export const getWorkOrders = async (req: Request, res: Response) => {
    let client;
    try {
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limitParam = req.query.limit as string;
        let limit = 15;
        if (limitParam === 'all' || limitParam === '-1') {
            limit = 10000;
        } else {
            const parsedLimit = parseInt(limitParam, 10);
            if (!isNaN(parsedLimit) && parsedLimit > 0) {
                limit = Math.min(parsedLimit, 10000);
            }
        }
        const offset = (page - 1) * limit;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';

        client = await getClient();

        const whereClauses: string[] = [];
        const params: any[] = [];

        if (search) {
            params.push(`%${search}%`);
            whereClauses.push(`work_order_id ILIKE $${params.length}`);
        }
        if (date) {
            params.push(date);
            whereClauses.push(`(work_order_date = $${params.length} OR date = $${params.length})`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const countRes = await client.query(`SELECT COUNT(*)::int AS total FROM rrh_work_orders ${whereSql}`, params);
        const total = countRes.rows[0]?.total || 0;

        const dataQuery = `
            SELECT 
                id, 
                work_order_id, 
                COALESCE(work_order_date, date) as work_order_date,
                lot_quantity, 
                status,
                excel_filename, 
                excel_file_size, 
                total_excel_rows, 
                created_by, 
                created_at, 
                updated_at
            FROM rrh_work_orders
            ${whereSql}
            ORDER BY created_at DESC, id DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const dataRes = await client.query(dataQuery, [...params, limit, offset]);
        const totalPages = Math.ceil(total / limit) || 1;

        return res.status(200).json({
            success: true,
            data: dataRes.rows,
            total,
            page,
            limit,
            totalPages
        });
    } catch (error: any) {
        logger.error(`Get Work Orders Error: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Error fetching work orders.' });
    } finally {
        if (client) client.release();
    }
};

/**
 * GET /api/rrh/work-orders/:id
 * Fetches Work Order details along with full active structural dataset from DB.
 */
export const getWorkOrderById = async (req: Request, res: Response) => {
    let client;
    try {
        const paramId = req.params.id;
        if (!paramId || !paramId.trim()) {
            return res.status(400).json({ success: false, error: 'Invalid Work Order ID.' });
        }

        client = await getClient();
        const numId = parseInt(paramId, 10);
        let woRes;
        if (!isNaN(numId) && String(numId) === paramId.trim()) {
            woRes = await client.query('SELECT * FROM rrh_work_orders WHERE id = $1', [numId]);
        } else {
            woRes = await client.query('SELECT * FROM rrh_work_orders WHERE work_order_id = $1', [paramId.trim()]);
        }

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found.' });
        }

        const wo = woRes.rows[0];
        let structuralData: any = null;

        if (wo.active_import_id) {
            // Fetch Sheet
            const sheetRes = await client.query(
                'SELECT * FROM rrh_excel_sheets WHERE import_id = $1 LIMIT 1',
                [wo.active_import_id]
            );

            if (sheetRes.rows.length > 0) {
                const sheet = sheetRes.rows[0];

                // Fetch Merges
                const mergesRes = await client.query(
                    'SELECT range_reference, start_row, start_column, end_row, end_column, row_span, column_span FROM rrh_excel_merged_cells WHERE sheet_id = $1',
                    [sheet.id]
                );

                // Fetch Rows & Cells
                const rowsRes = await client.query(
                    `SELECT r.id as row_id, r.row_number, r.row_type,
                            c.column_number, c.column_letter, c.raw_value, c.display_value, c.data_type
                     FROM rrh_excel_rows r
                     LEFT JOIN rrh_excel_cells c ON r.id = c.row_id
                     WHERE r.sheet_id = $1
                     ORDER BY r.row_number ASC, c.column_number ASC`,
                    [sheet.id]
                );

                // Reconstruct exact spreadsheet structure
                const rowMap = new Map<number, any>();
                const mergeLookup = new Map<string, any>();
                for (const m of mergesRes.rows) {
                    for (let r = m.start_row; r <= m.end_row; r++) {
                        for (let c = m.start_column; c <= m.end_column; c++) {
                            const isMaster = (r === m.start_row && c === m.start_column);
                            mergeLookup.set(`${r}:${c}`, { m, isMaster });
                        }
                    }
                }

                for (const rowItem of rowsRes.rows) {
                    if (!rowMap.has(rowItem.row_number)) {
                        rowMap.set(rowItem.row_number, {
                            rowNumber: rowItem.row_number,
                            rowType: rowItem.row_type,
                            cells: []
                        });
                    }

                    if (rowItem.column_number !== null) {
                        const mInfo = mergeLookup.get(`${rowItem.row_number}:${rowItem.column_number}`);
                        const isMerged = !!mInfo;
                        const mergeType = isMerged ? (mInfo.isMaster ? 'MASTER' : 'SLAVE') : 'NONE';
                        const rowSpan = mInfo && mInfo.isMaster ? (mInfo.m.row_span || 1) : 1;
                        const colSpan = mInfo && mInfo.isMaster ? (mInfo.m.column_span || 1) : 1;

                        rowMap.get(rowItem.row_number).cells.push({
                            columnNumber: rowItem.column_number,
                            c: rowItem.column_number,
                            columnLetter: rowItem.column_letter,
                            rawValue: rowItem.raw_value,
                            displayValue: rowItem.display_value,
                            v: rowItem.display_value,
                            dataType: rowItem.data_type,
                            t: rowItem.data_type,
                            isMerged,
                            mergeType,
                            rowSpan,
                            colSpan
                        });
                    }
                }

                structuralData = {
                    sheetName: sheet.sheet_name,
                    totalRows: sheet.total_rows,
                    totalColumns: sheet.total_columns,
                    merges: mergesRes.rows.map(m => ({
                        rangeReference: m.range_reference,
                        startRow: m.start_row,
                        startColumn: m.start_column,
                        endRow: m.end_row,
                        endColumn: m.end_column,
                        rowSpan: m.row_span,
                        colSpan: m.column_span
                    })),
                    rows: Array.from(rowMap.values())
                };
            }
        }

        return res.status(200).json({
            success: true,
            data: {
                ...wo,
                work_order_date: wo.work_order_date || wo.date,
                excel_structure: structuralData
            }
        });
    } catch (error: any) {
        logger.error(`Get Work Order Detail Error: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Failed to fetch Work Order details.' });
    } finally {
        if (client) client.release();
    }
};

/**
 * GET /api/rrh/work-orders/:id/download
 * Safely streams the physical Master Excel file.
 */
export const downloadWorkOrderExcel = async (req: Request, res: Response) => {
    try {
        const rawId = (req.params.id || '').trim();
        if (!rawId) {
            return res.status(400).json({ success: false, error: 'Work Order identifier is required.' });
        }

        const client = await getClient();
        const woRes = await client.query(
            'SELECT work_order_id, excel_filename FROM rrh_work_orders WHERE id::text = $1 OR work_order_id = $1 LIMIT 1',
            [rawId]
        );
        client.release();

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found.' });
        }

        const { work_order_id, excel_filename } = woRes.rows[0];
        const cleanWoId = sanitizeWorkOrderId(work_order_id);
        const filePath = path.join(getUploadsDir(), 'rrh', `${cleanWoId}.xlsx`);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, error: 'Master Excel file not found on server disk.' });
        }

        return res.download(filePath, excel_filename || `${cleanWoId}.xlsx`);
    } catch (error: any) {
        logger.error(`Download Master Excel Error: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Failed to download Excel file.' });
    }
};

/**
 * DELETE /api/rrh/work-orders/:id
 * Deletes Work Order, cascades database records, and unlinks physical file.
 */
export const deleteWorkOrder = async (req: Request, res: Response) => {
    let client;
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ success: false, error: 'Invalid Work Order ID.' });
        }

        client = await getClient();
        await client.query('BEGIN');

        const woRes = await client.query('SELECT work_order_id FROM rrh_work_orders WHERE id = $1 FOR UPDATE', [id]);
        if (woRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Work Order not found.' });
        }

        const cleanWoId = sanitizeWorkOrderId(woRes.rows[0].work_order_id);

        await client.query('DELETE FROM rrh_work_orders WHERE id = $1', [id]);
        await client.query('COMMIT');

        const filePath = path.join(getUploadsDir(), 'rrh', `${cleanWoId}.xlsx`);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                logger.info(`Unlinked physical file: ${filePath}`);
            } catch (err: any) {
                logger.warn(`Could not unlink file ${filePath}: ${err.message}`);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Work Order "${cleanWoId}" and its Master Excel data deleted successfully.`
        });
    } catch (error: any) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Delete Work Order Error: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Failed to delete Work Order.' });
    } finally {
        if (client) client.release();
    }
};

/**
 * GET /api/rrh/work-orders/:id/master-view
 * Dedicated endpoint for the Full-Page Master Excel Viewer.
 * Supports server-side pagination, filtering/search, and exact structural reconstruction.
 */
export const getMasterViewData = async (req: Request, res: Response) => {
    let client;
    try {
        const rawId = req.params.id;
        if (!rawId) {
            return res.status(400).json({ success: false, error: 'Work Order ID is required.' });
        }

        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limitParam = req.query.limit as string;
        let limit = 50;
        let isAll = false;
        if (limitParam === 'all' || limitParam === '-1') {
            isAll = true;
            limit = 10000;
        } else {
            const parsedLimit = parseInt(limitParam, 10);
            if (!isNaN(parsedLimit) && parsedLimit > 0) {
                limit = Math.min(parsedLimit, 1000);
            }
        }
        const offset = (page - 1) * limit;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        client = await getClient();

        // 1. Fetch Work Order
        const numId = parseInt(rawId, 10);
        let woRes;
        if (!isNaN(numId) && String(numId) === rawId.trim()) {
            woRes = await client.query('SELECT * FROM rrh_work_orders WHERE id = $1', [numId]);
        } else {
            woRes = await client.query('SELECT * FROM rrh_work_orders WHERE work_order_id = $1', [rawId]);
        }

        if (woRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Work Order not found.' });
        }

        const wo = woRes.rows[0];

        if (!wo.active_import_id) {
            return res.status(200).json({
                success: true,
                data: {
                    ...wo,
                    work_order_date: wo.work_order_date || wo.date,
                    excel_structure: null,
                    pagination: {
                        page: 1,
                        limit,
                        totalDataRows: 0,
                        filteredDataRows: 0,
                        totalPages: 1
                    }
                }
            });
        }

        // 2. Fetch Sheet
        const sheetRes = await client.query(
            'SELECT * FROM rrh_excel_sheets WHERE import_id = $1 LIMIT 1',
            [wo.active_import_id]
        );

        if (sheetRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Master Excel sheet not found for this Work Order.' });
        }

        const sheet = sheetRes.rows[0];
        const sheetId = sheet.id;

        // 3. Fetch Merges
        const mergesRes = await client.query(
            `SELECT range_reference, start_row, start_column, end_row, end_column, row_span, column_span 
             FROM rrh_excel_merged_cells WHERE sheet_id = $1`,
            [sheetId]
        );

        const mergeLookup = new Map<string, any>();
        for (const m of mergesRes.rows) {
            for (let r = m.start_row; r <= m.end_row; r++) {
                for (let c = m.start_column; c <= m.end_column; c++) {
                    const isMaster = (r === m.start_row && c === m.start_column);
                    mergeLookup.set(`${r}:${c}`, { m, isMaster });
                }
            }
        }

        // Helper to format cells
        const formatCell = (rowNum: number, c: any) => {
            const mInfo = mergeLookup.get(`${rowNum}:${c.column_number}`);
            const isMerged = !!mInfo;
            const mergeType = isMerged ? (mInfo.isMaster ? 'MASTER' : 'SLAVE') : 'NONE';
            const rowSpan = mInfo && mInfo.isMaster ? (mInfo.m.row_span || 1) : 1;
            const colSpan = mInfo && mInfo.isMaster ? (mInfo.m.column_span || 1) : 1;

            return {
                columnNumber: c.column_number,
                c: c.column_number,
                columnLetter: c.column_letter,
                rawValue: c.raw_value,
                displayValue: c.display_value,
                v: c.display_value,
                dataType: c.data_type,
                t: c.data_type,
                isMerged,
                mergeType,
                rowSpan,
                colSpan
            };
        };

        // 4. Fetch Header Rows (Row 1 & Row 2) unconditionally
        const headerRowsRes = await client.query(
            `SELECT r.id as row_id, r.row_number, r.row_type,
                    c.column_number, c.column_letter, c.raw_value, c.display_value, c.data_type
             FROM rrh_excel_rows r
             LEFT JOIN rrh_excel_cells c ON r.id = c.row_id
             WHERE r.sheet_id = $1 AND (r.row_type IN ('HEADER', 'SUB_HEADER') OR r.row_number <= 2)
             ORDER BY r.row_number ASC, c.column_number ASC`,
            [sheetId]
        );

        const headerRowMap = new Map<number, any>();
        for (const rItem of headerRowsRes.rows) {
            if (!headerRowMap.has(rItem.row_number)) {
                headerRowMap.set(rItem.row_number, {
                    rowNumber: rItem.row_number,
                    rowType: rItem.row_type,
                    cells: []
                });
            }
            if (rItem.column_number !== null) {
                headerRowMap.get(rItem.row_number).cells.push(formatCell(rItem.row_number, rItem));
            }
        }
        const headerRows = Array.from(headerRowMap.values());

        // 5. Total Data Rows in Sheet (row_number > 2)
        const totalDataRowsRes = await client.query(
            `SELECT COUNT(*) FROM rrh_excel_rows WHERE sheet_id = $1 AND row_number > 2`,
            [sheetId]
        );
        const totalDataRows = parseInt(totalDataRowsRes.rows[0].count, 10) || 0;

        // 6. Filtered Data Rows Count & Slice
        let countSql = `SELECT COUNT(*) FROM rrh_excel_rows r WHERE r.sheet_id = $1 AND r.row_number > 2`;
        let dataRowSql = `SELECT r.id, r.row_number, r.row_type FROM rrh_excel_rows r WHERE r.sheet_id = $1 AND r.row_number > 2`;
        const queryParams: any[] = [sheetId];

        if (search) {
            const searchParam = `%${search}%`;
            queryParams.push(searchParam);
            const searchClause = ` AND EXISTS (
                SELECT 1 FROM rrh_excel_cells c 
                WHERE c.row_id = r.id 
                  AND (c.display_value ILIKE $2 OR c.raw_value ILIKE $2)
            )`;
            countSql += searchClause;
            dataRowSql += searchClause;
        }

        const filteredCountRes = await client.query(countSql, queryParams);
        const filteredDataRows = parseInt(filteredCountRes.rows[0].count, 10) || 0;

        // Pagination limit/offset
        dataRowSql += ` ORDER BY r.row_number ASC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        const paginatedDataRowsRes = await client.query(dataRowSql, [...queryParams, limit, offset]);

        const dataRows: any[] = [];
        if (paginatedDataRowsRes.rows.length > 0) {
            const rowIds = paginatedDataRowsRes.rows.map((r: any) => r.id);
            const cellsRes = await client.query(
                `SELECT row_id, column_number, column_letter, raw_value, display_value, data_type
                 FROM rrh_excel_cells
                 WHERE row_id = ANY($1)
                 ORDER BY column_number ASC`,
                [rowIds]
            );

            const cellMapByRowId = new Map<number, any[]>();
            for (const c of cellsRes.rows) {
                if (!cellMapByRowId.has(c.row_id)) {
                    cellMapByRowId.set(c.row_id, []);
                }
                cellMapByRowId.get(c.row_id)!.push(c);
            }

            for (const r of paginatedDataRowsRes.rows) {
                const rawCells = cellMapByRowId.get(r.id) || [];
                const formattedCells = rawCells.map((c: any) => formatCell(r.row_number, c));
                dataRows.push({
                    rowNumber: r.row_number,
                    rowType: r.row_type,
                    cells: formattedCells
                });
            }
        }

        const totalPages = Math.ceil(filteredDataRows / limit) || 1;

        return res.status(200).json({
            success: true,
            data: {
                ...wo,
                work_order_date: wo.work_order_date || wo.date,
                pagination: {
                    page,
                    limit,
                    isAll,
                    totalDataRows,
                    filteredDataRows,
                    totalPages
                },
                excel_structure: {
                    sheetName: sheet.sheet_name,
                    totalRows: sheet.total_rows,
                    totalColumns: sheet.total_columns,
                    merges: mergesRes.rows.map(m => ({
                        rangeReference: m.range_reference,
                        startRow: m.start_row,
                        startColumn: m.start_column,
                        endRow: m.end_row,
                        endColumn: m.end_column,
                        rowSpan: m.row_span,
                        colSpan: m.column_span
                    })),
                    headerRows,
                    dataRows,
                    rows: [...headerRows, ...dataRows]
                }
            }
        });
    } catch (error: any) {
        logger.error(`Get Master View Data Error: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Failed to fetch Master View data.' });
    } finally {
        if (client) client.release();
    }
};
