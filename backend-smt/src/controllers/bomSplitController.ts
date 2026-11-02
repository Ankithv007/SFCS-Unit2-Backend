import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import multer from 'multer';
import ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import { getUploadsDir } from '../utils/uploads';

const logger = createLogger('BOMSplitController');

// Retrieve uploads directory dynamically
const uploadsDir = getUploadsDir();
const BOM_SPLIT_DIR = path.join(uploadsDir, 'BOM-Split');
const TEMP_DIR = path.join(BOM_SPLIT_DIR, 'Temp');
const ORIGINAL_DIR = path.join(BOM_SPLIT_DIR, 'Original');
const PROCESSED_DIR = path.join(BOM_SPLIT_DIR, 'Processed');

// Ensure directories exist
const ensureDirectories = () => {
    [TEMP_DIR, ORIGINAL_DIR, PROCESSED_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        ensureDirectories();
        cb(null, TEMP_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `BOM-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const fileFilter = (req: any, file: any, cb: any) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
        return cb(new Error('Only Excel workbooks (.xlsx, .xls) are allowed.'), false);
    }
    cb(null, true);
};

export const uploadExcel = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: fileFilter
});

// Helper for column matching (case-insensitive and space-insensitive)
const matchColumn = (header: string, target: string): boolean => {
    if (!header) return false;
    const cleanedHeader = header.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanedTarget = target.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (cleanedTarget === 'customerpartnumber') {
        return ['customerpartnumber', 'customerpartno', 'cpn'].includes(cleanedHeader) || 
               cleanedHeader.includes('customerpart') || 
               cleanedHeader.includes('cpn');
    }
    if (cleanedTarget === 'description') {
        return ['description', 'desc'].includes(cleanedHeader) || 
               cleanedHeader.includes('description') || 
               cleanedHeader.includes('desc');
    }
    if (cleanedTarget === 'mfr') {
        return ['mfr', 'manufacturer', 'mfg', 'make'].includes(cleanedHeader) || 
               cleanedHeader === 'mfr' || 
               cleanedHeader === 'mfg' || 
               cleanedHeader === 'make' || 
               cleanedHeader.includes('manufacturer');
    }
    if (cleanedTarget === 'mfrpartno') {
        return ['mfrpartno', 'mfrpartnumber', 'manufacturerpartnumber', 'manufacturerpartno', 'mpn'].includes(cleanedHeader) || 
               cleanedHeader.includes('mfrpart') || 
               cleanedHeader.includes('mpn') || 
               cleanedHeader.includes('manufacturerpart');
    }
    if (cleanedTarget === 'ref') {
        return ['ref', 'reference', 'refdesignator', 'designator'].includes(cleanedHeader) || 
               cleanedHeader.includes('ref') || 
               cleanedHeader.includes('designator');
    }
    if (cleanedTarget === 'qty') {
        return ['qty', 'quantity', 'qtyperproduct'].includes(cleanedHeader) || 
               cleanedHeader.includes('qty') || 
               cleanedHeader.includes('quantity');
    }
    return cleanedHeader === cleanedTarget;
};

// Reusable formatting helper for display names
const formatEmployee = (name?: string | null, code?: string | null): string => {
    const hasName = name && name.trim() !== '' && name.toLowerCase() !== 'null' && name.toLowerCase() !== 'undefined';
    const hasCode = code && code.trim() !== '' && code.toLowerCase() !== 'null' && code.toLowerCase() !== 'undefined';

    if (hasName && hasCode) {
        return `${name.trim()} (${code.trim()})`;
    }
    if (hasName) {
        return name.trim();
    }
    if (hasCode) {
        return code.trim();
    }
    return 'Unknown';
};

// Helper to clean empty directories recursively
const cleanEmptyDirs = (dirPath: string) => {
    try {
        if (!fs.existsSync(dirPath)) return;
        if (dirPath === BOM_SPLIT_DIR || dirPath === ORIGINAL_DIR || dirPath === PROCESSED_DIR || dirPath === TEMP_DIR || dirPath === uploadsDir) return;
        const files = fs.readdirSync(dirPath);
        if (files.length === 0) {
            fs.rmdirSync(dirPath);
            cleanEmptyDirs(path.dirname(dirPath));
        }
    } catch (e: any) {
        logger.error(`Error cleaning directory ${dirPath}: ${e.message}`);
    }
};

// Log helper to create database audit logs
const writeAuditLog = async (
    client: any,
    bomHistoryId: number | null,
    version: string,
    action: string,
    req: Request,
    status: string,
    processingDuration: number,
    fileName: string | null,
    fileSize: number | null,
    remarks: string
) => {
    const user = (req as any).user || {};
    const employeeId = user.id || user.userId || 'unknown';
    const employeeName = user.name || 'Unknown User';
    const employeeRole = user.role || 'Operator';
    const employeeCode = user.employee_code || null;
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    await client.query(`
        INSERT INTO bom_split_audit_logs (
            bom_history_id, version, action, employee_id, employee_name, employee_role, employee_code,
            status, processing_duration, ip_address, file_name, file_size, remarks,
            action_date, action_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_DATE, CURRENT_TIME)
    `, [
        bomHistoryId, version, action, employeeId, employeeName, employeeRole, employeeCode,
        status, processingDuration, ipAddress, fileName, fileSize, remarks
    ]);
};

/**
 * POST /api/bom-split/parse
 * Uploads, validates, parses and transforms the BOM Excel workbook in memory.
 * Compresses and stores the files, then returns preview data.
 */
export const parseBomWorkbook = async (req: Request, res: Response) => {
    ensureDirectories();
    const startTime = Date.now();
    const file = req.file;
    const isReupload = req.query.reupload === 'true' || req.body.reupload === 'true';
    const existingId = req.query.existingId ? parseInt(req.query.existingId as string, 10) : (req.body.existingId ? parseInt(req.body.existingId as string, 10) : null);
    
    const user = (req as any).user || {};
    const employeeId = user.id || user.userId || 'unknown';
    const employeeName = user.name || 'Unknown User';
    const employeeRole = user.role || 'Operator';
    const employeeCode = user.employee_code || null;

    if (!file) {
        return res.status(400).json({ success: false, error: 'Excel workbook file is required.' });
    }

    const tempFilePath = file.path;
    const originalFileName = file.originalname;
    const originalFileSize = file.size;

    const client = await pool.connect();
    
    // Variables for clean-up on error
    let generatedTempPath: string | null = null;
    let finalOriginalPath: string | null = null;
    let finalProcessedPath: string | null = null;
    let oldOriginalPath: string | null = null;
    let oldProcessedPath: string | null = null;
    let tempOriginalPath: string | null = null;
    let tempProcessedPath: string | null = null;
    let finalVersion = '1.0';

    try {
        // 1. Read the workbook
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(tempFilePath);

        // 2. Validate sheet exists
        const sheet = workbook.getWorksheet('COI info');
        if (!sheet) {
            throw new Error("Missing worksheet 'COI info'.");
        }

        if (sheet.rowCount <= 1) {
            throw new Error("The worksheet 'COI info' is empty.");
        }

        // 3. Find headers
        let headerRowIndex = 1;
        let headerRow = sheet.getRow(1);
        let cpnColIndex = -1;
        let descColIndex = -1;
        let mfrColIndex = -1;
        let mfrPartColIndex = -1;
        let qtyColIndex = -1;
        let refColIndex = -1;
        let vendorCodeColIndex = -1;

        // Scan first 15 rows for header row containing CPN/Customer Part Number
        for (let r = 1; r <= Math.min(15, sheet.rowCount); r++) {
            const row = sheet.getRow(r);
            let hasCpn = false;
            let tempCpnIdx = -1;
            let tempMfrIdx = -1;
            let tempMfrPartIdx = -1;

            row.eachCell((cell, colNumber) => {
                const val = cell.text;
                if (matchColumn(val, 'Customer Part Number')) {
                    hasCpn = true;
                    tempCpnIdx = colNumber;
                }
                if (matchColumn(val, 'Mfr')) {
                    tempMfrIdx = colNumber;
                }
                if (matchColumn(val, 'Mfr. Part No')) {
                    tempMfrPartIdx = colNumber;
                }
            });

            if (hasCpn) {
                headerRowIndex = r;
                headerRow = row;
                cpnColIndex = tempCpnIdx;
                mfrColIndex = tempMfrIdx;
                mfrPartColIndex = tempMfrPartIdx;
                break;
            }
        }

        if (cpnColIndex === -1) {
            throw new Error("Required column 'Customer Part Number' was not found in 'COI info' sheet.");
        }

        // Map rest of columns on the selected header row
        headerRow.eachCell((cell, colNumber) => {
            const val = cell.text;
            if (colNumber === cpnColIndex) return;
            if (colNumber === mfrColIndex) return;
            if (colNumber === mfrPartColIndex) return;

            if (matchColumn(val, 'Description')) descColIndex = colNumber;
            else if (matchColumn(val, 'Mfr')) mfrColIndex = colNumber;
            else if (matchColumn(val, 'Mfr. Part No')) mfrPartColIndex = colNumber;
            else if (matchColumn(val, 'Qty')) qtyColIndex = colNumber;
            else if (matchColumn(val, 'Ref')) refColIndex = colNumber;
            else if (val.toString().toLowerCase().replace(/[^a-z0-9]/g, '') === 'vendorcode') {
                vendorCodeColIndex = colNumber;
            }
        });

        // Validate required columns
        const missingCols: string[] = [];
        if (cpnColIndex === -1) missingCols.push('Customer Part Number');
        if (descColIndex === -1) missingCols.push('Description');
        if (mfrColIndex === -1) missingCols.push('Mfr');
        if (mfrPartColIndex === -1) missingCols.push('Mfr. Part No');
        if (qtyColIndex === -1) missingCols.push('Qty');
        if (refColIndex === -1) missingCols.push('Ref');

        if (missingCols.length > 0) {
            throw new Error(`Required columns are missing: ${missingCols.join(', ')}.`);
        }

        // Get all headers for mapping other columns in order, EXCLUDING Vendor Code
        const totalColumns = sheet.columnCount;
        const originalHeaders: string[] = [];
        for (let col = 1; col <= totalColumns; col++) {
            if (col === vendorCodeColIndex) continue;
            originalHeaders.push(headerRow.getCell(col).text || '');
        }

        // 4. Parse rows
        const parsedRows: any[] = [];
        const originalRowsCount = sheet.rowCount - headerRowIndex;

        for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const cpn = (row.getCell(cpnColIndex).text || '').trim();
            
            // Ignore completely blank rows
            let isRowEmpty = true;
            row.eachCell({ includeEmpty: true }, (cell) => {
                const val = cell.value;
                if (val !== null && val !== undefined && val !== '') {
                    isRowEmpty = false;
                }
            });

            if (!cpn && isRowEmpty) {
                continue;
            }

            const description = row.getCell(descColIndex).text || '';
            const mfr = row.getCell(mfrColIndex).text || '';
            const mfrPartNo = row.getCell(mfrPartColIndex).text || '';
            const qty = (row.getCell(qtyColIndex).text || '').trim();
            const ref = (row.getCell(refColIndex).text || '').trim();

            // Store full row values for reconstruction (excluding Vendor Code)
            const originalValues: any[] = [];
            for (let col = 1; col <= totalColumns; col++) {
                if (col === vendorCodeColIndex) continue;
                originalValues.push(row.getCell(col).value);
            }

            parsedRows.push({
                cpn,
                description,
                mfr,
                mfrPartNo,
                qty,
                ref,
                originalValues
            });
        }

        if (parsedRows.length === 0) {
            throw new Error("The worksheet 'COI info' contains no data rows.");
        }

        // 5. Group and Deduplicate
        const groupsMap = new Map<string, any[]>();
        const groupOrder: string[] = [];

        for (const row of parsedRows) {
            const cpn = row.cpn;
            if (!groupsMap.has(cpn)) {
                groupsMap.set(cpn, []);
                groupOrder.push(cpn);
            }
            groupsMap.get(cpn)!.push(row);
        }

        const processedRows: any[] = [];
        let displayOrder = 1;
        let duplicateRowsRemoved = 0;

        for (const cpn of groupOrder) {
            const groupRows = groupsMap.get(cpn)!;

            // Deduplicate by Mfr + Mfr. Part No
            const seenMfrPart = new Set<string>();
            const uniqueGroupRows: any[] = [];

            for (const r of groupRows) {
                const key = `${(r.mfr || '').trim().toLowerCase()}|${(r.mfrPartNo || '').trim().toLowerCase()}`;
                if (!seenMfrPart.has(key)) {
                    seenMfrPart.add(key);
                    uniqueGroupRows.push(r);
                } else {
                    duplicateRowsRemoved++;
                }
            }

            // Identify first non-empty Qty and Ref for CPN-level values
            let groupQty = '';
            let groupRef = '';
            for (const r of uniqueGroupRows) {
                if (r.qty && !groupQty) groupQty = r.qty;
                if (r.ref && !groupRef) groupRef = r.ref;
            }
            if (!groupQty && uniqueGroupRows.length > 0) groupQty = uniqueGroupRows[0].qty || '';
            if (!groupRef && uniqueGroupRows.length > 0) groupRef = uniqueGroupRows[0].ref || '';

            const groupSize = uniqueGroupRows.length;

            for (let i = 0; i < groupSize; i++) {
                const r = uniqueGroupRows[i];
                processedRows.push({
                    cpn: r.cpn,
                    description: r.description,
                    mfr: r.mfr,
                    mfrPartNo: r.mfrPartNo,
                    qty: groupQty,
                    ref: groupRef,
                    display_order: displayOrder++,
                    originalValues: r.originalValues
                });
            }
        }

        // 6. File Naming
        const fileExt = path.extname(originalFileName).toLowerCase() || '.xlsx';

        // Versioning Configuration
        let isUpdate = false;

        if (isReupload && existingId) {
            // Reupload of the same BOM session
            const findRecord = await client.query(`
                SELECT version, original_file_path, processed_file_path FROM bom_history WHERE id = $1 FOR UPDATE
            `, [existingId]);

            if (findRecord.rows.length > 0) {
                isUpdate = true;
                const prevVersion = findRecord.rows[0].version;
                oldOriginalPath = path.join(uploadsDir, findRecord.rows[0].original_file_path);
                oldProcessedPath = path.join(uploadsDir, findRecord.rows[0].processed_file_path);

                // Increment version sequentially: 1.0 -> 1.1 -> 1.2
                const [major, minor] = prevVersion.split('.');
                const nextMinor = parseInt(minor, 10) + 1;
                finalVersion = `${major}.${nextMinor}`;
            }
        }

        let dbId: number;
        if (isUpdate && existingId) {
            dbId = existingId;
        } else {
            // Pre-fetch the next ID from the sequence for initial upload
            const seqRes = await client.query("SELECT nextval('bom_history_id_seq') as next_id");
            dbId = parseInt(seqRes.rows[0].next_id, 10);
        }

        const paddedId = dbId.toString().padStart(6, '0');
        
        const storedOriginalName = `BOM_${paddedId}_V${finalVersion}${fileExt}`;
        const storedOriginalPath = path.join('BOM-Split', 'Original', storedOriginalName);
        finalOriginalPath = path.join(ORIGINAL_DIR, storedOriginalName);

        const storedProcessedName = `BOM_${paddedId}_V${finalVersion}_Processed.xlsx`;
        const storedProcessedPath = path.join('BOM-Split', 'Processed', storedProcessedName);
        finalProcessedPath = path.join(PROCESSED_DIR, storedProcessedName);

        // Define temporary paths in the Temp folder
        const uniqueSuffixForFiles = Date.now() + '-' + Math.round(Math.random() * 1e9);
        tempOriginalPath = path.join(TEMP_DIR, `TEMP_Original_${uniqueSuffixForFiles}${fileExt}`);
        tempProcessedPath = path.join(TEMP_DIR, `TEMP_Processed_${uniqueSuffixForFiles}.xlsx`);

        // Copy original workbook to Temp directory first
        fs.copyFileSync(tempFilePath, tempOriginalPath);

        await client.query('BEGIN');

        if (isUpdate && existingId) {
            // Update DB row for Re-upload
            await client.query(`
                UPDATE bom_history
                SET version = $1, original_file_name = $2, stored_original_file_name = $3, original_file_path = $4,
                    processed_file_name = $5, processed_file_path = $6, file_size = $7, compressed_file_size = $8,
                    uploaded_by_id = $9, uploaded_by_name = $10, uploaded_by_role = $11, uploaded_by_code = $12,
                    uploaded_date = CURRENT_DATE, uploaded_time = CURRENT_TIME, upload_date = CURRENT_DATE, upload_time = CURRENT_TIME,
                    workbook_status = 'Valid', parse_status = 'SUCCESS', processing_duration = $13, original_rows = $14,
                    processed_rows = $15, duplicate_rows_removed = $16, remarks = $17, original_headers = $18
                WHERE id = $19
            `, [
                finalVersion, originalFileName, storedOriginalName, storedOriginalPath,
                storedProcessedName, storedProcessedPath, originalFileSize, originalFileSize,
                employeeId, employeeName, employeeRole, employeeCode, (Date.now() - startTime),
                 originalRowsCount, groupOrder.length, duplicateRowsRemoved, 'Re-uploaded new version',
                JSON.stringify(originalHeaders), dbId
            ]);
            
            // Delete old items for reupload
            await client.query(`DELETE FROM bom_split_items WHERE bom_history_id = $1`, [dbId]);
        } else {
            // Initial upload
            await client.query(`
                INSERT INTO bom_history (
                    id, version, original_file_name, stored_original_file_name, original_file_path,
                    processed_file_name, processed_file_path, file_size, compressed_file_size,
                    uploaded_by_id, uploaded_by_name, uploaded_by_role, uploaded_by_code,
                    uploaded_date, uploaded_time, workbook_status, parse_status,
                    processing_duration, original_rows, processed_rows, duplicate_rows_removed, remarks, original_headers
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_DATE, CURRENT_TIME, $14, $15, $16, $17, $18, $19, $20, $21)
            `, [
                dbId, '1.0', originalFileName, storedOriginalName, storedOriginalPath,
                storedProcessedName, storedProcessedPath, originalFileSize, originalFileSize,
                employeeId, employeeName, employeeRole, employeeCode, 'Valid', 'SUCCESS',
                (Date.now() - startTime), originalRowsCount, groupOrder.length, duplicateRowsRemoved,
                'Initial upload', JSON.stringify(originalHeaders)
            ]);
        }

        // Insert new items into bom_split_items via optimized bulk insert
        if (processedRows.length > 0) {
            const valuesPlaceholder = [];
            const flatValues = [];
            let index = 1;
            for (const item of processedRows) {
                valuesPlaceholder.push(`($${index}, $${index+1}, $${index+2}, $${index+3}, $${index+4}, $${index+5}, $${index+6}, $${index+7}, $${index+8})`);
                flatValues.push(
                    dbId,
                    item.cpn,
                    item.description,
                    item.mfr,
                    item.mfrPartNo,
                    item.qty,
                    item.ref,
                    item.display_order,
                    employeeName
                );
                index += 9;
            }
            await client.query(`
                INSERT INTO bom_split_items (
                    bom_history_id, cpn, description, mfr, mfr_part_no, qty, ref,
                    display_order, created_by
                ) VALUES ${valuesPlaceholder.join(', ')}
            `, flatValues);
        }

        // Generate processed workbook with the latest DB items & save it to Temp
        const processedWorkbook = await generateProcessedExcelInServer(client, dbId, req);
        await processedWorkbook.xlsx.writeFile(tempProcessedPath);

        // Create Audit Logs
        const actionType = isUpdate ? 'RE-UPLOAD' : 'UPLOAD';
        const logRemarks = isUpdate 
            ? `Re-uploaded workbook to version ${finalVersion}. Duplicate rows removed: ${duplicateRowsRemoved}.`
            : `Uploaded workbook. Initial version 1.0. Duplicate rows removed: ${duplicateRowsRemoved}.`;

        await writeAuditLog(client, dbId, finalVersion, actionType, req, 'SUCCESS', Date.now() - startTime, originalFileName, originalFileSize, logRemarks);
        await writeAuditLog(client, dbId, finalVersion, 'PARSE', req, 'SUCCESS', Date.now() - startTime, originalFileName, originalFileSize, `Successfully parsed sheet 'COI info'. Rows: ${originalRowsCount} -> ${processedRows.length}.`);

        await client.query('COMMIT');

        // Delete old versions physically on replacement success
        if (isUpdate && oldOriginalPath && fs.existsSync(oldOriginalPath)) {
            try { fs.unlinkSync(oldOriginalPath); } catch (e: any) {}
        }
        if (isUpdate && oldProcessedPath && fs.existsSync(oldProcessedPath)) {
            try { fs.unlinkSync(oldProcessedPath); } catch (e: any) {}
        }

        // Move the new files from Temp directory into target folders
        try {
            if (finalOriginalPath && tempOriginalPath) {
                fs.renameSync(tempOriginalPath, finalOriginalPath);
            }
            if (finalProcessedPath && tempProcessedPath) {
                fs.renameSync(tempProcessedPath, finalProcessedPath);
            }
        } catch (err: any) {
            logger.error(`Failed to move files from Temp to target folder: ${err.message}`);
            throw new Error(`Failed to move files to target folders: ${err.message}`);
        }

        // Return detail view structure
        const bomDetail = await getBomDetailRecord(client, dbId);
        res.status(200).json({
            success: true,
            message: isUpdate ? 'Re-upload successful.' : 'BOM uploaded successfully.',
            ...bomDetail
        });

    } catch (err: any) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (e) {}
            try {
                await client.query('BEGIN');
                await writeAuditLog(client, existingId, isReupload ? finalVersion : '1.0', isReupload ? 'RE-UPLOAD' : 'UPLOAD', req, 'FAILED', Date.now() - startTime, originalFileName, originalFileSize, `Failed: ${err.message}`);
                await client.query('COMMIT');
            } catch (e) {}
        }

        logger.error(`Error parsing BOM workbook: ${err.message}`);

        // Cleanup temporary files in Temp directory
        if (tempOriginalPath && fs.existsSync(tempOriginalPath)) {
            try { fs.unlinkSync(tempOriginalPath); } catch (e) {}
        }
        if (tempProcessedPath && fs.existsSync(tempProcessedPath)) {
            try { fs.unlinkSync(tempProcessedPath); } catch (e) {}
        }

        res.status(400).json({ success: false, error: err.message || 'Failed to parse BOM Excel workbook.' });
    } finally {
        // Cleanup temp file uploaded by user
        if (fs.existsSync(tempFilePath)) {
            try { fs.unlinkSync(tempFilePath); } catch (e) {}
        }
        if (generatedTempPath && fs.existsSync(generatedTempPath)) {
            try { fs.unlinkSync(generatedTempPath); } catch (e) {}
        }
        client.release();
    }
};

/**
 * GET /api/bom-split/history
 */
export const getBomHistoryList = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const offset = (page - 1) * limit;

    const searchFileName = (req.query.fileName as string || '').trim();
    const searchVersion = (req.query.version as string || '').trim();
    const searchEmployee = (req.query.uploadedBy as string || '').trim();
    const filterDate = (req.query.uploadDate as string || '').trim();
    const filterStatus = (req.query.parseStatus as string || '').trim();

    try {
        let countQuery = `SELECT COUNT(*) FROM bom_history WHERE is_deleted = false`;
        let selectQuery = `SELECT * FROM bom_history WHERE is_deleted = false`;
        const queryParams: any[] = [];
        let paramIndex = 1;

        const clauses: string[] = [];

        if (searchFileName) {
            clauses.push(`original_file_name ILIKE $${paramIndex}`);
            queryParams.push(`%${searchFileName}%`);
            paramIndex++;
        }
        if (searchVersion) {
            clauses.push(`version = $${paramIndex}`);
            queryParams.push(searchVersion);
            paramIndex++;
        }
        if (searchEmployee) {
            clauses.push(`uploaded_by_name ILIKE $${paramIndex} OR uploaded_by_code ILIKE $${paramIndex}`);
            queryParams.push(`%${searchEmployee}%`);
            paramIndex++;
        }
        if (filterDate) {
            clauses.push(`upload_date = $${paramIndex}`);
            queryParams.push(filterDate);
            paramIndex++;
        }
        if (filterStatus) {
            clauses.push(`parse_status = $${paramIndex}`);
            queryParams.push(filterStatus);
            paramIndex++;
        }

        if (clauses.length > 0) {
            const joinClause = ' AND ' + clauses.join(' AND ');
            countQuery += joinClause;
            selectQuery += joinClause;
        }

        selectQuery += ` ORDER BY id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const queryParamsWithPagination = [...queryParams, limit, offset];

        const totalRes = await pool.query(countQuery, queryParams);
        const recordsRes = await pool.query(selectQuery, queryParamsWithPagination);

        const totalItems = parseInt(totalRes.rows[0].count, 10);
        res.status(200).json({
            success: true,
            totalItems,
            page,
            limit,
            records: recordsRes.rows
        });
    } catch (err: any) {
        logger.error(`Error loading BOM history: ${err.message}`);
        res.status(500).json({ success: false, error: 'Failed to fetch BOM history list.' });
    }
};

/**
 * GET /api/bom-split/detail/:id
 */
export const getBomDetail = async (req: Request, res: Response) => {
    const recordId = parseInt(req.params.id, 10);
    if (isNaN(recordId)) {
        return res.status(400).json({ success: false, error: 'Invalid BOM history ID.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const detail = await getBomDetailRecord(client, recordId);
        
        if (!detail) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'BOM history record not found.' });
        }

        // Audit log for View
        await writeAuditLog(client, recordId, detail.bom.version, 'VIEW', req, 'SUCCESS', 0, detail.bom.original_file_name, detail.bom.file_size, `Viewed details of BOM History ID ${recordId}.`);

        await client.query('COMMIT');
        res.status(200).json({ success: true, ...detail });
    } catch (err: any) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Error loading BOM details: ${err.message}`);
        res.status(500).json({ success: false, error: 'Failed to fetch BOM details.' });
    } finally {
        client.release();
    }
};

/**
 * PUT /api/bom-split/items/:itemId
 */
export const updateBomSplitItem = async (req: Request, res: Response) => {
    const itemId = parseInt(req.params.itemId, 10);
    const { qty, ref } = req.body;

    if (isNaN(itemId)) {
        return res.status(400).json({ success: false, error: 'Invalid item ID.' });
    }

    const user = (req as any).user || {};
    const employeeId = user.id || user.userId || 'unknown';
    const employeeName = user.name || 'Unknown User';
    const employeeCode = user.employee_code || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Fetch existing item
        const itemRes = await client.query(`
            SELECT i.*, h.version, h.original_file_name, h.processed_file_path
            FROM bom_split_items i
            JOIN bom_history h ON i.bom_history_id = h.id
            WHERE i.id = $1
        `, [itemId]);

        if (itemRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'BOM component item not found.' });
        }

        const item = itemRes.rows[0];
        const bomHistoryId = item.bom_history_id;
        const oldQty = item.qty || '';
        const oldRef = item.ref || '';
        const newQty = qty !== undefined ? qty.toString().trim() : oldQty;
        const newRef = ref !== undefined ? ref.toString().trim() : oldRef;

        // Update all items for this Customer Part Number (CPN) in this BOM session
        await client.query(`
            UPDATE bom_split_items
            SET qty = $1, ref = $2, updated_by_id = $3, updated_by_name = $4, updated_by_code = $5,
                updated_date = CURRENT_DATE, updated_time = CURRENT_TIME
            WHERE bom_history_id = $6 AND cpn = $7
        `, [newQty, newRef, employeeId, employeeName, employeeCode, bomHistoryId, item.cpn]);

        // Audit Logs comparing values
        const version = item.version;
        if (oldQty !== newQty) {
            await writeAuditLog(client, bomHistoryId, version, 'UPDATE QTY', req, 'SUCCESS', 0, item.original_file_name, null, `Updated component ${item.cpn} Qty from "${oldQty}" to "${newQty}".`);
        }
        if (oldRef !== newRef) {
            await writeAuditLog(client, bomHistoryId, version, 'UPDATE REF', req, 'SUCCESS', 0, item.original_file_name, null, `Updated component ${item.cpn} Ref from "${oldRef}" to "${newRef}".`);
        }

        // Regenerate the processed workbook with updated values, saving it back to processed_file_path
        const processedWorkbook = await generateProcessedExcelInServer(client, bomHistoryId, req);
        const destPath = path.join(uploadsDir, item.processed_file_path);
        await processedWorkbook.xlsx.writeFile(destPath);

        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'BOM component updated successfully.' });
    } catch (err: any) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Error updating BOM component item: ${err.message}`);
        res.status(500).json({ success: false, error: 'Failed to update component item.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/bom-split/parse-again/:id
 */
export const parseAgain = async (req: Request, res: Response) => {
    const recordId = parseInt(req.params.id, 10);
    if (isNaN(recordId)) {
        return res.status(400).json({ success: false, error: 'Invalid BOM history ID.' });
    }

    const startTime = Date.now();
    const user = (req as any).user || {};
    const employeeId = user.id || user.userId || 'unknown';
    const employeeName = user.name || 'Unknown User';
    const employeeRole = user.role || 'Operator';
    const employeeCode = user.employee_code || null;

    const client = await pool.connect();
    let tempProcessedPath: string | null = null;
    let oldProcessedPath: string | null = null;

    try {
        // Fetch existing history record
        const findRecord = await client.query(`SELECT * FROM bom_history WHERE id = $1 AND is_deleted = false FOR UPDATE`, [recordId]);
        if (findRecord.rows.length === 0) {
            throw new Error('BOM history record not found.');
        }

        const record = findRecord.rows[0];
        const originalPath = path.join(uploadsDir, record.original_file_path);
        if (!fs.existsSync(originalPath)) {
            throw new Error('Original file does not exist on storage.');
        }

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);

        // Parse
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(originalPath);
        const sheet = workbook.getWorksheet('COI info');
        if (!sheet) throw new Error("Missing worksheet 'COI info' in the original workbook.");

        let headerRowIndex = 1;
        let cpnColIndex = -1;
        let descColIndex = -1;
        let mfrColIndex = -1;
        let mfrPartColIndex = -1;
        let qtyColIndex = -1;
        let refColIndex = -1;
        let vendorCodeColIndex = -1;

        for (let r = 1; r <= Math.min(15, sheet.rowCount); r++) {
            const row = sheet.getRow(r);
            let hasCpn = false;
            let tempCpnIdx = -1;
            let tempMfrIdx = -1;
            let tempMfrPartIdx = -1;

            row.eachCell((cell, colNumber) => {
                const val = cell.text;
                if (matchColumn(val, 'Customer Part Number')) {
                    hasCpn = true;
                    tempCpnIdx = colNumber;
                }
                if (matchColumn(val, 'Mfr')) {
                    tempMfrIdx = colNumber;
                }
                if (matchColumn(val, 'Mfr. Part No')) {
                    tempMfrPartIdx = colNumber;
                }
            });

            if (hasCpn) {
                headerRowIndex = r;
                cpnColIndex = tempCpnIdx;
                mfrColIndex = tempMfrIdx;
                mfrPartColIndex = tempMfrPartIdx;
                break;
            }
        }

        if (cpnColIndex === -1) {
            throw new Error("Required column 'Customer Part Number' was not found in original sheet.");
        }

        const headerRow = sheet.getRow(headerRowIndex);
        headerRow.eachCell((cell, colNumber) => {
            const val = cell.text;
            if (colNumber === cpnColIndex) return;
            if (colNumber === mfrColIndex) return;
            if (colNumber === mfrPartColIndex) return;

            if (matchColumn(val, 'Description')) descColIndex = colNumber;
            else if (matchColumn(val, 'Mfr')) mfrColIndex = colNumber;
            else if (matchColumn(val, 'Mfr. Part No')) mfrPartColIndex = colNumber;
            else if (matchColumn(val, 'Qty')) qtyColIndex = colNumber;
            else if (matchColumn(val, 'Ref')) refColIndex = colNumber;
            else if (val.toString().toLowerCase().replace(/[^a-z0-9]/g, '') === 'vendorcode') {
                vendorCodeColIndex = colNumber;
            }
        });

        const missingCols: string[] = [];
        if (descColIndex === -1) missingCols.push('Description');
        if (mfrColIndex === -1) missingCols.push('Mfr');
        if (mfrPartColIndex === -1) missingCols.push('Mfr. Part No');
        if (qtyColIndex === -1) missingCols.push('Qty');
        if (refColIndex === -1) missingCols.push('Ref');

        if (missingCols.length > 0) {
            throw new Error(`Required columns are missing: ${missingCols.join(', ')}.`);
        }

        // Get headers (excluding Vendor Code)
        const totalColumns = sheet.columnCount;
        const originalHeaders: string[] = [];
        for (let col = 1; col <= totalColumns; col++) {
            if (col === vendorCodeColIndex) continue;
            originalHeaders.push(headerRow.getCell(col).text || '');
        }

        const parsedRows: any[] = [];
        for (let r = headerRowIndex + 1; r <= sheet.rowCount; r++) {
            const row = sheet.getRow(r);
            const cpn = (row.getCell(cpnColIndex).text || '').trim();
            
            let isRowEmpty = true;
            row.eachCell({ includeEmpty: true }, (cell) => {
                const val = cell.value;
                if (val !== null && val !== undefined && val !== '') isRowEmpty = false;
            });

            if (!cpn && isRowEmpty) continue;

            const description = row.getCell(descColIndex).text || '';
            const mfr = row.getCell(mfrColIndex).text || '';
            const mfrPartNo = row.getCell(mfrPartColIndex).text || '';
            const qty = (row.getCell(qtyColIndex).text || '').trim();
            const ref = (row.getCell(refColIndex).text || '').trim();

            const originalValues: any[] = [];
            for (let col = 1; col <= totalColumns; col++) {
                if (col === vendorCodeColIndex) continue;
                originalValues.push(row.getCell(col).value);
            }

            parsedRows.push({ cpn, description, mfr, mfrPartNo, qty, ref, originalValues });
        }

        const groupsMap = new Map<string, any[]>();
        const groupOrder: string[] = [];
        for (const row of parsedRows) {
            const cpn = row.cpn;
            if (!groupsMap.has(cpn)) {
                groupsMap.set(cpn, []);
                groupOrder.push(cpn);
            }
            groupsMap.get(cpn)!.push(row);
        }

        const processedRows: any[] = [];
        let displayOrder = 1;
        let duplicateRowsRemoved = 0;

        for (const cpn of groupOrder) {
            const groupRows = groupsMap.get(cpn)!;
            const seenMfrPart = new Set<string>();
            const uniqueGroupRows: any[] = [];

            for (const r of groupRows) {
                const key = `${(r.mfr || '').trim().toLowerCase()}|${(r.mfrPartNo || '').trim().toLowerCase()}`;
                if (!seenMfrPart.has(key)) {
                    seenMfrPart.add(key);
                    uniqueGroupRows.push(r);
                } else {
                    duplicateRowsRemoved++;
                }
            }

            // Identify first non-empty Qty and Ref for CPN-level values
            let groupQty = '';
            let groupRef = '';
            for (const r of uniqueGroupRows) {
                if (r.qty && !groupQty) groupQty = r.qty;
                if (r.ref && !groupRef) groupRef = r.ref;
            }
            if (!groupQty && uniqueGroupRows.length > 0) groupQty = uniqueGroupRows[0].qty || '';
            if (!groupRef && uniqueGroupRows.length > 0) groupRef = uniqueGroupRows[0].ref || '';

            for (let i = 0; i < uniqueGroupRows.length; i++) {
                const r = uniqueGroupRows[i];
                processedRows.push({
                    cpn: r.cpn,
                    description: r.description,
                    mfr: r.mfr,
                    mfrPartNo: r.mfrPartNo,
                    qty: groupQty,
                    ref: groupRef,
                    display_order: displayOrder++,
                    originalValues: r.originalValues
                });
            }
        }

        // Version increment
        const prevVersion = record.version;
        const [major, minor] = prevVersion.split('.');
        const finalVersion = `${major}.${parseInt(minor, 10) + 1}`;

        const paddedId = recordId.toString().padStart(6, '0');
        const storedProcessedName = `BOM_${paddedId}_V${finalVersion}_Processed.xlsx`;
        const storedProcessedPath = path.join('BOM-Split', 'Processed', storedProcessedName);
        const finalProcessedPath = path.join(PROCESSED_DIR, storedProcessedName);
        oldProcessedPath = path.join(uploadsDir, record.processed_file_path);

        tempProcessedPath = path.join(TEMP_DIR, `TEMP_Processed_Again_${uniqueSuffix}.xlsx`);

        await client.query('BEGIN');

        // Delete old items & insert new parsed items
        await client.query(`DELETE FROM bom_split_items WHERE bom_history_id = $1`, [recordId]);

        // Insert new items into bom_split_items via optimized bulk insert
        if (processedRows.length > 0) {
            const valuesPlaceholder = [];
            const flatValues = [];
            let index = 1;
            for (const item of processedRows) {
                valuesPlaceholder.push(`($${index}, $${index+1}, $${index+2}, $${index+3}, $${index+4}, $${index+5}, $${index+6}, $${index+7}, $${index+8})`);
                flatValues.push(
                    recordId,
                    item.cpn,
                    item.description,
                    item.mfr,
                    item.mfrPartNo,
                    item.qty,
                    item.ref,
                    item.display_order,
                    employeeName
                );
                index += 9;
            }
            await client.query(`
                INSERT INTO bom_split_items (
                    bom_history_id, cpn, description, mfr, mfr_part_no, qty, ref,
                    display_order, created_by
                ) VALUES ${valuesPlaceholder.join(', ')}
            `, flatValues);
        }

        // Update bom_history row
        await client.query(`
            UPDATE bom_history
            SET version = $1, processed_file_name = $2, processed_file_path = $3,
                uploaded_by_id = $4, uploaded_by_name = $5, uploaded_by_role = $6, uploaded_by_code = $7,
                uploaded_date = CURRENT_DATE, uploaded_time = CURRENT_TIME, upload_date = CURRENT_DATE, upload_time = CURRENT_TIME,
                processing_duration = $8, original_rows = $9, processed_rows = $10,
                duplicate_rows_removed = $11, remarks = 'Parsed original BOM workbook again.', original_headers = $12
            WHERE id = $13
        `, [
            finalVersion, storedProcessedName, storedProcessedPath,
            employeeId, employeeName, employeeRole, employeeCode,
            (Date.now() - startTime), (sheet.rowCount - headerRowIndex), groupOrder.length,
            duplicateRowsRemoved, JSON.stringify(originalHeaders), recordId
        ]);

        // Generate processed file
        const processedWorkbook = await generateProcessedExcelInServer(client, recordId, req);
        await processedWorkbook.xlsx.writeFile(tempProcessedPath);

        // Audit Log
        await writeAuditLog(client, recordId, finalVersion, 'PARSE AGAIN', req, 'SUCCESS', Date.now() - startTime, record.original_file_name, record.file_size, `Parsed original BOM workbook again. Promoted to V${finalVersion}.`);

        await client.query('COMMIT');

        // Delete old processed workbook
        if (oldProcessedPath && fs.existsSync(oldProcessedPath)) {
            try { fs.unlinkSync(oldProcessedPath); } catch (e) {}
        }

        // Rename temp processed file to final destination
        if (finalProcessedPath && tempProcessedPath) {
            fs.renameSync(tempProcessedPath, finalProcessedPath);
        }

        // Return details
        const detail = await getBomDetailRecord(client, recordId);
        res.status(200).json({
            success: true,
            message: 'Original BOM workbook parsed again successfully.',
            ...detail
        });

    } catch (err: any) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (e) {}
            try {
                await client.query('BEGIN');
                await writeAuditLog(client, recordId, '1.0', 'PARSE AGAIN', req, 'FAILED', Date.now() - startTime, null, null, `Failed: ${err.message}`);
                await client.query('COMMIT');
            } catch (e) {}
        }

        logger.error(`Error during Parse Again: ${err.message}`);

        if (tempProcessedPath && fs.existsSync(tempProcessedPath)) {
            try { fs.unlinkSync(tempProcessedPath); } catch (e) {}
        }

        res.status(400).json({ success: false, error: err.message || 'Failed to parse original BOM again.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/bom-split/download/:id/:type
 */
export const downloadBomFile = async (req: Request, res: Response) => {
    const { id, type } = req.params;
    const recordId = parseInt(id, 10);

    if (isNaN(recordId)) {
        return res.status(400).json({ success: false, error: 'Invalid BOM history ID.' });
    }

    if (type !== 'original' && type !== 'processed') {
        return res.status(400).json({ success: false, error: "Invalid type. Must be 'original' or 'processed'." });
    }

    const client = await pool.connect();
    try {
        const findRecord = await client.query(`SELECT * FROM bom_history WHERE id = $1 AND is_deleted = false`, [recordId]);
        if (findRecord.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'BOM record not found.' });
        }

        const record = findRecord.rows[0];
        const relativeFilePath = type === 'original' ? record.original_file_path : record.processed_file_path;
        const originalName = type === 'original' ? record.original_file_name : `BOM_Split_V${record.version}_Processed.xlsx`;
        const fullPath = path.join(uploadsDir, relativeFilePath);

        if (!fs.existsSync(fullPath)) {
            return res.status(404).json({ success: false, error: 'Physical file not found.' });
        }

        // Record Audit Log
        const actionType = type === 'original' ? 'DOWNLOAD ORIGINAL' : 'DOWNLOAD PROCESSED';
        await writeAuditLog(client, recordId, record.version, actionType, req, 'SUCCESS', 0, originalName, record.file_size, `Downloaded ${type} Excel workbook.`);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);

        const fileBuffer = fs.readFileSync(fullPath);
        res.send(fileBuffer);
    } catch (err: any) {
        logger.error(`Error downloading BOM file: ${err.message}`);
        res.status(500).json({ success: false, error: 'Failed to download Excel workbook.' });
    } finally {
        client.release();
    }
};

/**
 * DELETE /api/bom-split/history/:id
 */
export const deleteBomHistory = async (req: Request, res: Response) => {
    const recordId = parseInt(req.params.id, 10);
    if (isNaN(recordId)) {
        return res.status(400).json({ success: false, error: 'Invalid BOM history ID.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const findRecord = await client.query(`SELECT * FROM bom_history WHERE id = $1 FOR UPDATE`, [recordId]);
        if (findRecord.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'BOM history record not found.' });
        }

        const record = findRecord.rows[0];
        const origFullPath = path.join(uploadsDir, record.original_file_path);
        const procFullPath = path.join(uploadsDir, record.processed_file_path);

        // Delete physical files
        if (fs.existsSync(origFullPath)) {
            try { fs.unlinkSync(origFullPath); } catch (e) {}
        }
        if (fs.existsSync(procFullPath)) {
            try { fs.unlinkSync(procFullPath); } catch (e) {}
        }

        // Clean up empty directories
        cleanEmptyDirs(path.dirname(origFullPath));
        cleanEmptyDirs(path.dirname(procFullPath));

        // Hard Delete history. CASCADE drops items and audit logs.
        await client.query(`DELETE FROM bom_history WHERE id = $1`, [recordId]);

        // Write global Audit Log of deletion (no history FK constraint so it isn't deleted)
        await writeAuditLog(client, null, record.version, 'DELETE BOM', req, 'SUCCESS', 0, record.original_file_name, record.file_size, `Permanently deleted BOM History ID ${recordId} (File: ${record.original_file_name}).`);

        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'BOM History record and all associated files/items deleted successfully.' });
    } catch (err: any) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Error deleting BOM history record: ${err.message}`);
        res.status(500).json({ success: false, error: 'Failed to delete BOM history.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/bom-split/audit-logs
 */
export const getAuditLogs = async (req: Request, res: Response) => {
    const bomHistoryId = req.query.bomHistoryId ? parseInt(req.query.bomHistoryId as string, 10) : null;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const offset = (page - 1) * limit;

    const searchQuery = req.query.search ? (req.query.search as string).trim() : '';
    
    let sortBy = req.query.sortBy as string || 'id';
    const allowedSortColumns = [
        'id', 'bom_history_id', 'version', 'action', 'status',
        'employee_id', 'employee_name', 'employee_role', 'employee_code',
        'ip_address', 'remarks', 'created_at'
    ];
    if (!allowedSortColumns.includes(sortBy)) {
        sortBy = 'id';
    }
    const sortOrder = (req.query.sortOrder as string || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    try {
        let countQuery = `SELECT COUNT(*) FROM bom_split_audit_logs`;
        let selectQuery = `SELECT * FROM bom_split_audit_logs`;
        const params: any[] = [];
        let paramIndex = 1;

        const conditions: string[] = [];

        if (bomHistoryId) {
            conditions.push(`bom_history_id = $${paramIndex}`);
            params.push(bomHistoryId);
            paramIndex++;
        }

        if (searchQuery) {
            conditions.push(`(
                remarks ILIKE $${paramIndex} OR
                action ILIKE $${paramIndex} OR
                employee_name ILIKE $${paramIndex} OR
                employee_code ILIKE $${paramIndex} OR
                status ILIKE $${paramIndex} OR
                version ILIKE $${paramIndex}
            )`);
            params.push(`%${searchQuery}%`);
            paramIndex++;
        }

        if (conditions.length > 0) {
            const whereClause = ' WHERE ' + conditions.join(' AND ');
            countQuery += whereClause;
            selectQuery += whereClause;
        }

        selectQuery += ` ORDER BY ${sortBy} ${sortOrder} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        const queryParams = [...params, limit, offset];

        const totalRes = await pool.query(countQuery, params);
        const logsRes = await pool.query(selectQuery, queryParams);

        res.status(200).json({
            success: true,
            totalItems: parseInt(totalRes.rows[0].count, 10),
            page,
            limit,
            logs: logsRes.rows
        });
    } catch (err: any) {
        logger.error(`Error loading audit logs: ${err.message}`);
        res.status(500).json({ success: false, error: 'Failed to fetch audit logs.' });
    }
};

/**
 * POST /api/bom-split/reset
 */
export const recordResetAction = async (req: Request, res: Response) => {
    const { version, fileName, fileSize } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await writeAuditLog(
            client,
            null,
            version || '1.0',
            'RESET',
            req,
            'SUCCESS',
            0,
            fileName || null,
            fileSize || null,
            'Reset BOM Split module session.'
        );
        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'Reset logged.' });
    } catch (err: any) {
        if (client) await client.query('ROLLBACK');
        logger.error(`Error logging reset: ${err.message}`);
        res.status(500).json({ success: false, error: 'Failed to log reset action.' });
    } finally {
        client.release();
    }
};

/**
 * Helper to build/regenerate the Processed Excel in ExcelJS
 */
const generateProcessedExcelInServer = async (client: any, bomHistoryId: number, req: Request): Promise<ExcelJS.Workbook> => {
    // 1. Fetch history record
    const historyRes = await client.query(`SELECT * FROM bom_history WHERE id = $1`, [bomHistoryId]);
    if (historyRes.rows.length === 0) {
        throw new Error('BOM history record not found.');
    }

    // 2. Fetch items
    const itemsRes = await client.query(`
        SELECT * FROM bom_split_items
        WHERE bom_history_id = $1
        ORDER BY display_order ASC, id ASC
    `, [bomHistoryId]);
    const items = itemsRes.rows;

    // 3. Create Workbook & sheet
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('BOM Split');

    const headers = [
        'Sl No',
        'Customer Part Number',
        'Description',
        'Manufacturer',
        'Manufacturer Part Number',
        'Qty',
        'Ref'
    ];

    // Page setup for professional printing
    sheet.pageSetup = {
        paperSize: 9, // A4
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
    };

    const fontName = 'Segoe UI';

    // Header Row (Row 1)
    const headerRowIdx = 1;
    const headerRow = sheet.getRow(headerRowIdx);
    headerRow.values = headers;
    headerRow.height = 24;

    for (let col = 1; col <= headers.length; col++) {
        const cell = headerRow.getCell(col);
        cell.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1A365D' } // Corporate dark blue
        };
        cell.alignment = { horizontal: col === 1 ? 'center' : 'left', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
        };
    }

    // Write components data dynamically calculating presentation Sl No
    let currentSlNo = 0;
    let prevCpn = '';
    
    items.forEach((item: any, idx: number) => {
        const cpn = (item.cpn || '').trim();
        if (cpn !== prevCpn) {
            currentSlNo++;
            prevCpn = cpn;
        }

        const excelRowIdx = 2 + idx;
        const excelRow = sheet.getRow(excelRowIdx);
        // Do not set fixed height so Excel automatically adjusts height based on wrapped content

        excelRow.values = [
            currentSlNo,
            item.cpn || '',
            item.description || '',
            item.mfr || '',
            item.mfr_part_no || '',
            item.qty || '',
            item.ref || ''
        ];

        for (let col = 1; col <= headers.length; col++) {
            const cell = excelRow.getCell(col);
            cell.font = { name: fontName, size: 9.5 };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
                right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
            };

            // Alignment: Middle vertical alignment on all cells
            cell.alignment = {
                horizontal: col === 1 ? 'center' : 'left',
                vertical: 'middle',
                wrapText: col === 3
            };
        }
    });

    // Vertical Merging logic for Sl No (Col 1), Customer Part Number (Col 2) and Description (Col 3)
    let groupStartRow = 2;
    const totalRows = items.length;
    for (let r = 2; r < 2 + totalRows; r++) {
        const cpnVal = sheet.getCell(r, 2).text;
        const isLastRow = r === 2 + totalRows - 1;
        const nextCpnVal = isLastRow ? '' : sheet.getCell(r + 1, 2).text;

        if (cpnVal !== nextCpnVal || isLastRow) {
            const groupEndRow = r;
            if (groupEndRow > groupStartRow) {
                // Merge Sl No (Col 1)
                sheet.mergeCells(groupStartRow, 1, groupEndRow, 1);
                // Merge Customer Part Number (Col 2)
                sheet.mergeCells(groupStartRow, 2, groupEndRow, 2);

                // Check if all description values in this group are identical
                let firstDesc = sheet.getCell(groupStartRow, 3).text;
                let allDescIdentical = true;
                for (let dRow = groupStartRow + 1; dRow <= groupEndRow; dRow++) {
                    if (sheet.getCell(dRow, 3).text !== firstDesc) {
                        allDescIdentical = false;
                        break;
                    }
                }
                if (allDescIdentical) {
                    sheet.mergeCells(groupStartRow, 3, groupEndRow, 3);
                }

                // Merge Qty (Col 6)
                sheet.mergeCells(groupStartRow, 6, groupEndRow, 6);
                // Merge Ref (Col 7)
                sheet.mergeCells(groupStartRow, 7, groupEndRow, 7);
            }
            groupStartRow = r + 1;
        }
    }

    // Auto column widths in-memory to prevent slow cell-by-cell loops
    const colWidths = Array(headers.length).fill(12);
    for (let col = 1; col <= headers.length; col++) {
        colWidths[col - 1] = Math.max(12, headers[col - 1].length + 3);
    }
    
    let widthSlNo = 0;
    let widthPrevCpn = '';
    items.forEach((item: any) => {
        const cpn = (item.cpn || '').trim();
        if (cpn !== widthPrevCpn) {
            widthSlNo++;
            widthPrevCpn = cpn;
        }
        const vals = [
            String(widthSlNo),
            String(item.cpn || ''),
            String(item.description || ''),
            String(item.mfr || ''),
            String(item.mfr_part_no || ''),
            String(item.qty || ''),
            String(item.ref || '')
        ];
        for (let col = 1; col <= headers.length; col++) {
            const valStr = vals[col - 1];
            if (valStr.length > colWidths[col - 1]) {
                colWidths[col - 1] = valStr.length;
            }
        }
    });

    for (let col = 1; col <= headers.length; col++) {
        sheet.getColumn(col).width = Math.min(50, colWidths[col - 1] + 3);
    }

    // Freeze header row
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Auto Filters
    sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length }
    };

    return workbook;
};

/**
 * Fetch detailed record representation of a BOM split session
 */
const getBomDetailRecord = async (client: any, recordId: number) => {
    // Fetch history
    const historyRes = await client.query(`SELECT * FROM bom_history WHERE id = $1`, [recordId]);
    if (historyRes.rows.length === 0) return null;
    const bom = historyRes.rows[0];

    // Fetch items
    const itemsRes = await client.query(`
        SELECT * FROM bom_split_items
        WHERE bom_history_id = $1
        ORDER BY display_order ASC, id ASC
    `, [recordId]);
    const items = itemsRes.rows;

    // Calculate dynamic stats based on Customer Part Number (CPN)
    const uniqueCpns = new Set<string>();
    const completedCpns = new Set<string>();

    for (const item of items) {
        const cpn = (item.cpn || '').trim();
        if (cpn) {
            uniqueCpns.add(cpn);
            const isCompleted = item.qty !== null && item.qty !== undefined && item.qty.toString().trim() !== '' &&
                                item.ref !== null && item.ref !== undefined && item.ref.toString().trim() !== '';
            if (isCompleted) {
                completedCpns.add(cpn);
            }
        }
    }

    const totalComponents = uniqueCpns.size;
    const completedComponents = completedCpns.size;
    const pendingComponents = Math.max(0, totalComponents - completedComponents);
    const completionPercentage = totalComponents > 0 ? Number(((completedComponents / totalComponents) * 100).toFixed(2)) : 0.00;

    return {
        bom,
        stats: {
            totalComponents,
            completedComponents,
            pendingComponents,
            completionPercentage
        },
        items: items.map((item: any) => {
            const isCompleted = item.qty !== null && item.qty !== undefined && item.qty.toString().trim() !== '' &&
                                item.ref !== null && item.ref !== undefined && item.ref.toString().trim() !== '';
            return {
                id: item.id,
                cpn: item.cpn,
                description: item.description,
                mfr: item.mfr,
                mfr_part_no: item.mfr_part_no,
                qty: item.qty || '',
                ref: item.ref || '',
                display_order: item.display_order,
                status: isCompleted ? 'Completed' : 'Pending',
                updated_by_id: item.updated_by_id,
                updated_by_name: item.updated_by_name,
                updated_by_code: item.updated_by_code,
                updated_date: item.updated_date,
                updated_time: item.updated_time
            };
        })
    };
};
