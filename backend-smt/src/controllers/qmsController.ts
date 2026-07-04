import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import { 
    TEMP_UPLOADS_DIR, 
    QMS_UPLOADS_DIR, 
    generateFileName, 
    processUpload,
    getUploadsDir
} from '../services/qmsDocumentService';

const logger = createLogger('QMSController');

import * as XLSX from 'xlsx';

const BOM_COLUMNS_MAPPING = {
    sl_no: [
        'slno',
        'sno'
    ],
    vepl_part_no: [
        'veplpartno',
        'veplpartnumber'
    ],
    description: [
        'description',
        'desc'
    ],
    manufacturer: [
        'mfr',
        'manufacturer',
        'mfg',
        'make'
    ],
    manufacturer_part_no: [
        'mfrpartno',
        'mfrpartnumber',
        'manufacturerpartnumber',
        'manufacturerpartno'
    ],
    qty_per_product: [
        'qtyproduct',
        'qtyperproduct',
        'qty'
    ]
};

function cleanHeader(val: any): string {
    if (typeof val !== 'string') return '';
    return val.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchColumn(header: string, targetKey: keyof typeof BOM_COLUMNS_MAPPING): boolean {
    const cleaned = cleanHeader(header);
    return BOM_COLUMNS_MAPPING[targetKey].includes(cleaned);
}

export async function extractBomRevisionFromFile(filePath: string): Promise<string> {
    let workbook;
    try {
        workbook = XLSX.readFile(filePath);
    } catch (err: any) {
        logger.error(`Error reading Excel file for revision: ${err.message}`);
        throw new Error('Unable to read the uploaded Excel file.');
    }

    const sheetNames = workbook.SheetNames;
    logger.info(`[QMS_PARSER] Available worksheets: ${JSON.stringify(sheetNames)}`);

    const bomSheetName = sheetNames.find(name => name.trim().toLowerCase() === 'bom');
    if (!bomSheetName) {
        logger.error(`[QMS_PARSER] Worksheet "BOM" (case-insensitive) not found in Excel.`);
        throw new Error('Unable to find BOM worksheet in uploaded file.');
    }

    logger.info(`[QMS_PARSER] Parsing worksheet: "${bomSheetName}"`);
    const sheet = workbook.Sheets[bomSheetName];
    const rangeRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    const searchLimit = Math.min(20, rangeRows.length);
    for (let r = 0; r < searchLimit; r++) {
        const row = rangeRows[r];
        if (!row || !Array.isArray(row)) continue;

        for (let c = 0; c < row.length; c++) {
            const cellVal = row[c];
            if (cellVal === undefined || cellVal === null) continue;

            const cellStr = String(cellVal).trim();
            const cellAddress = XLSX.utils.encode_cell({ r, c });
            logger.info(`[QMS_PARSER] Scanning cell ${cellAddress}: "${cellStr}"`);

            // Case-insensitive check for BOM Rev No: (ignore trailing colon, unify inner spaces)
            const normalizedCell = cellStr.toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '').trim();
            if (normalizedCell === 'bom rev no') {
                logger.info(`[QMS_PARSER] Found "BOM Rev No:" label at cell ${cellAddress}`);

                // Look up to 4 columns to the right for the first non-empty cell value
                for (let offset = 1; offset <= 4; offset++) {
                    const nextCol = c + offset;
                    const val = row[nextCol];
                    const valAddress = XLSX.utils.encode_cell({ r, c: nextCol });

                    if (val !== undefined && val !== null && String(val).trim() !== '') {
                        const extractedRev = String(val).trim();
                        logger.info(`[QMS_PARSER] Selected revision value from cell ${valAddress}: "${extractedRev}"`);
                        return extractedRev;
                    }
                }
            }
        }
    }

    logger.error(`[QMS_PARSER] Failed to find "BOM Rev No:" label and value in the first 20 rows of "${bomSheetName}"`);
    throw new Error('BOM Revision Number not found in the uploaded Excel.');
}

export async function extractBomItemsFromFile(filePath: string): Promise<any[]> {
    let workbook;
    try {
        workbook = XLSX.readFile(filePath);
    } catch (err: any) {
        logger.error(`Error reading Excel file: ${err.message}`);
        throw new Error('Unable to read the uploaded Excel file.');
    }

    const sheetNames = workbook.SheetNames;
    const bomSheetName = sheetNames.find(name => name.trim().toLowerCase() === 'bom');
    if (!bomSheetName) {
        throw new Error('Unable to find BOM worksheet in uploaded file.');
    }

    const bomSheet = workbook.Sheets[bomSheetName];
    const rangeRows = XLSX.utils.sheet_to_json(bomSheet, { header: 1 }) as any[][];
    
    let headerRowIndex = -1;
    let colIndices: Record<keyof typeof BOM_COLUMNS_MAPPING, number> = {
        sl_no: -1,
        vepl_part_no: -1,
        description: -1,
        manufacturer: -1,
        manufacturer_part_no: -1,
        qty_per_product: -1
    };

    for (let r = 0; r < rangeRows.length; r++) {
        const row = rangeRows[r];
        if (!row || !Array.isArray(row)) continue;

        const tempIndices = {
            sl_no: -1,
            vepl_part_no: -1,
            description: -1,
            manufacturer: -1,
            manufacturer_part_no: -1,
            qty_per_product: -1
        };

        for (let c = 0; c < row.length; c++) {
            const cellVal = row[c];
            if (cellVal === undefined || cellVal === null) continue;
            const cellStr = String(cellVal);
            
            (Object.keys(BOM_COLUMNS_MAPPING) as Array<keyof typeof BOM_COLUMNS_MAPPING>).forEach(key => {
                if (matchColumn(cellStr, key)) {
                    tempIndices[key] = c;
                }
            });
        }

        if (tempIndices.vepl_part_no !== -1 && tempIndices.description !== -1 && tempIndices.sl_no !== -1) {
            headerRowIndex = r;
            colIndices = tempIndices;
            break;
        }
    }

    const missingColumns = (Object.keys(colIndices) as Array<keyof typeof colIndices>).filter(key => colIndices[key] === -1);
    if (missingColumns.length > 0) {
        logger.warn(`Missing required BOM column headers: ${missingColumns.join(', ')}`);
        throw new Error('Required BOM columns were not found in the uploaded Excel file.');
    }

    const items: any[] = [];

    for (let r = headerRowIndex + 1; r < rangeRows.length; r++) {
        const row = rangeRows[r];
        if (!row || !Array.isArray(row)) continue;

        const sl_no = colIndices.sl_no !== -1 ? String(row[colIndices.sl_no] ?? '').trim() : '';
        // Only accept positive integer values for Sl No (e.g. "1", "2", "180") to ignore footer/legend/notes/approvals/blank rows
        const isSlNoValid = /^\d+$/.test(sl_no) && parseInt(sl_no, 10) > 0;
        if (!isSlNoValid) {
            continue;
        }

        const rawMfg = colIndices.manufacturer !== -1 ? row[colIndices.manufacturer] : undefined;
        const rawMfgPart = colIndices.manufacturer_part_no !== -1 ? row[colIndices.manufacturer_part_no] : undefined;
        console.log(`[Excel Read] Row ${r} - Raw Manufacturer:`, JSON.stringify(rawMfg));
        console.log(`[Excel Read] Row ${r} - Raw Mfr Part No:`, JSON.stringify(rawMfgPart));

        const vepl_part_no = colIndices.vepl_part_no !== -1 ? String(row[colIndices.vepl_part_no] ?? '').trim() : '';
        const description = colIndices.description !== -1 ? String(row[colIndices.description] ?? '').trim() : '';
        const manufacturer = colIndices.manufacturer !== -1 ? String(row[colIndices.manufacturer] ?? '').trim() : '';
        const manufacturer_part_no = colIndices.manufacturer_part_no !== -1 ? String(row[colIndices.manufacturer_part_no] ?? '').trim() : '';

        console.log(`[Before DB Insert] Row ${r} - Parsed Manufacturer:`, JSON.stringify(manufacturer));
        console.log(`[Before DB Insert] Row ${r} - Parsed Mfr Part No:`, JSON.stringify(manufacturer_part_no));
        const qtyVal = colIndices.qty_per_product !== -1 ? row[colIndices.qty_per_product] : undefined;

        let qty_per_product: number | null = null;
        if (qtyVal !== undefined && qtyVal !== null && String(qtyVal).trim() !== '') {
            const parsed = parseFloat(String(qtyVal));
            if (!isNaN(parsed)) {
                qty_per_product = parsed;
            }
        }

        items.push({
            sl_no,
            vepl_part_no,
            description,
            manufacturer,
            manufacturer_part_no,
            qty_per_product
        });
    }

    return items;
}

async function saveBomItems(client: any, qmsId: number, bomRevisionId: number, items: any[]) {
    if (!items || items.length === 0) return;
    
    const columnsPerRow = 8;
    const chunkSize = Math.floor(50000 / columnsPerRow);
    
    for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const chunkValues: any[] = [];
        const chunkPlaceholders: string[] = [];
        let chunkParamIndex = 1;
        
        for (const item of chunk) {
            chunkValues.push(
                qmsId,
                bomRevisionId,
                item.sl_no || null,
                item.vepl_part_no || null,
                item.description || null,
                item.manufacturer || null,
                item.manufacturer_part_no || null,
                item.qty_per_product
            );
            
            chunkPlaceholders.push(`($${chunkParamIndex}, $${chunkParamIndex+1}, $${chunkParamIndex+2}, $${chunkParamIndex+3}, $${chunkParamIndex+4}, $${chunkParamIndex+5}, $${chunkParamIndex+6}, $${chunkParamIndex+7})`);
            chunkParamIndex += columnsPerRow;
        }
        
        const insertQuery = `
            INSERT INTO qms_bom_items (
                qms_id, bom_revision_id, sl_no, vepl_part_no, description, manufacturer, manufacturer_part_no, qty_per_product
            ) VALUES ${chunkPlaceholders.join(', ')}
        `;
        await client.query(insertQuery, chunkValues);
    }
}

// Helper to increment revision: e.g. 1 -> 2 -> 3
function incrementRevision(rev: string | null): string {
    if (!rev) return '1';
    const num = parseInt(rev, 10);
    if (!isNaN(num)) {
        return (num + 1).toString();
    }
    const floatNum = parseFloat(rev);
    if (!isNaN(floatNum)) {
        return Math.floor(floatNum + 1).toString();
    }
    return '1';
}

const incrementBomRevision = (currentRev?: string): string => {
    // Initial revision
    if (!currentRev || !currentRev.includes(".")) {
        return "1.1";
    }

    const [major, minor] = currentRev.split(".");

    const nextMinor = Number(minor) + 1;

    return `${major}.${nextMinor}`;
};

// Helper to determine original content type
function getMimeType(fileName: string): string {
    let name = fileName;
    if (fileName.endsWith('.gz')) {
        name = fileName.slice(0, -3);
    }
    const ext = path.extname(name).toLowerCase();
    switch (ext) {
        case '.pdf': return 'application/pdf';
        case '.xls': return 'application/vnd.ms-excel';
        case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        case '.csv': return 'text/csv';
        case '.zip': return 'application/zip';
        default: return 'application/octet-stream';
    }
}

// -------------------------------------------------------------------------
// MULTER SETUP (DISK STORAGE TO TEMP FOLDER)
// -------------------------------------------------------------------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, TEMP_UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const fileFilter = (req: any, file: any, cb: any) => {
    const allowedExtensions = ['.pdf', '.xls', '.xlsx', '.csv', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (!allowedExtensions.includes(ext)) {
        return cb(new Error(`File type ${ext} is not allowed. Only PDF, Excel, CSV, and ZIP files are permitted.`), false);
    }
    
    cb(null, true);
};

export const qmsUpload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: fileFilter
});

// -------------------------------------------------------------------------
// RATE LIMITER (In-Memory IP Limiter, 20 uploads per 15 minutes)
// -------------------------------------------------------------------------
const rateLimits = new Map<string, { count: number; resetTime: number }>();
export const uploadRateLimiter = (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const limit = rateLimits.get(ip as string);

    if (!limit || now > limit.resetTime) {
        rateLimits.set(ip as string, { count: 1, resetTime: now + 15 * 60 * 1000 });
        return next();
    }

    if (limit.count >= 20) {
        return res.status(429).json({ error: 'Too many upload requests from this IP. Please try again after 15 minutes.' });
    }

    limit.count++;
    next();
};

// -------------------------------------------------------------------------
// CONTROLLER ACTIONS
// -------------------------------------------------------------------------

/**
 * GET /api/qms/work-orders
 * Fetches all registered Work Orders from Warehouse
 */
export const getQmsWorkOrders = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT id as work_order_number, po_id as po_number, product_name, product_description, quantity, remark as warehouse_remarks
            FROM smt_work_orders
            WHERE id NOT IN (
                SELECT work_order_number
                FROM qms_master
                WHERE is_deleted = false
            )
            ORDER BY created_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error('Error fetching work orders for QMS:', err);
        res.status(500).json({ error: 'Failed to fetch work orders.' });
    }
};

/**
 * GET /api/qms/records
 * Fetches all non-deleted QMS records for dashboard
 */
export const getQmsRecords = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT m.*, r.id AS current_bom_revision_id
            FROM qms_master m
            LEFT JOIN LATERAL (
                SELECT id FROM qms_bom_revisions 
                WHERE qms_id = m.id 
                ORDER BY uploaded_at DESC LIMIT 1
            ) r ON TRUE
            WHERE m.is_deleted = false
            ORDER BY m.updated_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error('Error fetching QMS records:', err);
        res.status(500).json({ error: 'Failed to fetch QMS records.' });
    }
};

/**
 * GET /api/qms/bom-revisions/:qmsId
 * Fetches BOM revision history for a master record
 */
export const getBomRevisions = async (req: Request, res: Response) => {
    const { qmsId } = req.params;
    try {
        const result = await pool.query(`
            SELECT * FROM qms_bom_revisions
            WHERE qms_id = $1
            ORDER BY uploaded_at DESC
        `, [qmsId]);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error(`Error fetching BOM revisions for QMS ${qmsId}:`, err);
        res.status(500).json({ error: 'Failed to fetch BOM revisions.' });
    }
};

/**
 * GET /api/qms/revisions/:qmsId
 * Fetches all QMS file revisions history log
 */
export const getQmsRevisions = async (req: Request, res: Response) => {
    const { qmsId } = req.params;
    try {
        const result = await pool.query(`
            SELECT r.*, b.id AS bom_revision_id
            FROM qms_file_revisions r
            LEFT JOIN qms_bom_revisions b ON r.qms_id = b.qms_id AND r.new_revision = b.revision_number AND r.file_type = 'bom'
            WHERE r.qms_id = $1
            ORDER BY r.uploaded_at DESC
        `, [qmsId]);
        res.status(200).json(result.rows);
    } catch (err) {
        logger.error(`Error fetching QMS revisions for record ${qmsId}:`, err);
        res.status(500).json({ error: 'Failed to fetch revisions.' });
    }
};

/**
 * POST /api/qms/create
 * Creates a new QMS record and processes uploaded documents in a single Transaction.
 */
export const createQms = async (req: Request, res: Response) => {
    const {
        work_order_number,
        po_number,
        product_name,
        product_description,
        quantity,
        warehouse_remarks,
        qms_remarks,
        userName
    } = req.body;

    const creator = userName || 'System';
    const client = await pool.connect();
    
    // Track successfully saved compressed paths for cleanup on transaction failure
    const savedCompressedPaths: string[] = [];

    let transactionStarted = false;
    try {
        // Enforce validations
        if (!work_order_number) {
            const valErr = new Error('Work Order Number is required.') as any;
            valErr.statusCode = 400;
            throw valErr;
        }

        const files = req.files as { [fieldname: string]: Express.Multer.File[] } || {};
        if (!files['bom'] || files['bom'].length === 0) {
            const valErr = new Error('BOM document is mandatory.') as any;
            valErr.statusCode = 400;
            throw valErr;
        }

        const bomFile = files['bom'][0];
        let bomItems: any[] = [];
        let bomRevision = '';
        try {
            bomRevision = await extractBomRevisionFromFile(bomFile.path);
            bomItems = await extractBomItemsFromFile(bomFile.path);
        } catch (parseErr: any) {
            for (const key in files) {
                const fileArray = files[key];
                if (fileArray && fileArray.length > 0 && fs.existsSync(fileArray[0].path)) {
                    try { fs.unlinkSync(fileArray[0].path); } catch (e) {}
                }
            }
            const err = new Error(parseErr.message) as any;
            err.statusCode = 400;
            throw err;
        }

        // Check duplicates (before starting transaction)
        const checkDup = await client.query(
            `SELECT id FROM qms_master WHERE work_order_number = $1 AND is_deleted = false`,
            [work_order_number]
        );
        if (checkDup.rows.length > 0) {
            const dupErr = new Error("QMS already exists for this Work Order") as any;
            dupErr.statusCode = 400;
            throw dupErr;
        }

        await client.query('BEGIN');
        transactionStarted = true;

        // Insert initial master record
        const masterRes = await client.query(`
            INSERT INTO qms_master (
                work_order_number, po_number, product_name, product_description, quantity, warehouse_remarks, qms_remarks, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
        `, [
            work_order_number,
            po_number || null,
            product_name || null,
            product_description || null,
            quantity ? parseInt(quantity, 10) : null,
            warehouse_remarks || null,
            qms_remarks || null,
            creator
        ]);

        const qmsId = masterRes.rows[0].id;
        const filesMetadata: any = {};
        
        let bomFilePath = '';
        let pfcFilePath = '';
        let xyFilePath = '';
        let ecnFilePath = '';
        let drawingFilePath = '';

        // Process and compress each file streamingly
        const keys = ['bom', 'pfc', 'xy', 'ecn', 'drawing'];
        for (const key of keys) {
            const fileArray = files[key];
            if (fileArray && fileArray.length > 0) {
                const file = fileArray[0];
                const isZip = path.extname(file.originalname).toLowerCase() === '.zip';
                
                // Naming convention
                const docTypeTag = key === 'drawing' ? 'DRAWING' : key.toUpperCase();
                const initRev = key === 'bom' ? bomRevision : '1';
                const destName = generateFileName(work_order_number, docTypeTag, initRev, creator, false, file.originalname);
                
                // Pipeline process
                const result = await processUpload(file.path, destName, isZip);
                savedCompressedPaths.push(result.savedPath);

                const compRatio = result.originalSize > 0 
                    ? parseFloat(((result.originalSize - result.compressedSize) / result.originalSize * 100).toFixed(2)) 
                    : 0;

                filesMetadata[key] = {
                    originalName: file.originalname,
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    compressionRatio: compRatio,
                    fileHash: result.fileHash,
                    compressedHash: result.compressedHash,
                    uploadedBy: creator,
                    uploadedAt: new Date().toISOString(),
                    revision: initRev
                };

                const relativePath = `QMS-Data/${destName}`;
                
                logger.info(`QMS file uploaded and processed:`, {
                    originalName: file.originalname,
                    tempFilePath: file.path,
                    savedPhysicalPath: result.savedPath,
                    dbStoredPath: relativePath
                });

                // Insert into unified file revisions log
                await client.query(`
                    INSERT INTO qms_file_revisions (
                        qms_id, file_type, previous_revision, new_revision, uploaded_by, remarks
                    ) VALUES ($1, $2, NULL, $3, $4, $5)
                `, [qmsId, key, initRev, creator, qms_remarks || 'Initial upload']);
                
                if (key === 'bom') {
                    bomFilePath = relativePath;
                    
                    // Insert BOM initial revision record
                    const bomRevRes = await client.query(`
                        INSERT INTO qms_bom_revisions (
                            qms_id, revision_number, bom_file_path, original_name, 
                            original_size, compressed_size, compression_ratio, 
                            file_hash, compressed_file_hash, uploaded_by, remarks
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Initial upload')
                        RETURNING id
                    `, [
                        qmsId, initRev, relativePath, file.originalname, 
                        result.originalSize, result.compressedSize, compRatio,
                        result.fileHash, result.compressedHash, creator
                    ]);
                    const bomRevisionId = bomRevRes.rows[0].id;
                    await saveBomItems(client, qmsId, bomRevisionId, bomItems);
                }
                else if (key === 'pfc') pfcFilePath = relativePath;
                else if (key === 'xy') xyFilePath = relativePath;
                else if (key === 'ecn') ecnFilePath = relativePath;
                else if (key === 'drawing') drawingFilePath = relativePath;
            }
        }

        // Update master table with document paths, current_bom_revision and metadata JSONB
        await client.query(`
            UPDATE qms_master
            SET bom_file_path = $1,
                pfc_file_path = $2,
                xy_data_file_path = $3,
                ecn_file_path = $4,
                assembly_drawing_file_path = $5,
                files_metadata = $6,
                current_bom_revision = $7
            WHERE id = $8
        `, [bomFilePath, pfcFilePath, xyFilePath, ecnFilePath, drawingFilePath, JSON.stringify(filesMetadata), bomRevision, qmsId]);

        // Insert audit log
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        await client.query(`
            INSERT INTO qms_activity_logs (qms_id, work_order_number, action, details, performed_by, ip_address)
            VALUES ($1, $2, 'CREATE_QMS', 'Created QMS master record and uploaded initial documents', $3, $4)
        `, [qmsId, work_order_number, creator, ip as string]);

        await client.query('COMMIT');
        res.status(201).json({ message: 'QMS created successfully.', qmsId });

    } catch (err: any) {
        if (transactionStarted) {
            try {
                await client.query('ROLLBACK');
            } catch (rbErr) {
                // Ignore rollback errors if already committed or closed
            }
        }
        logger.error('Error during QMS creation:', err);

        // Delete any compressed files saved to disk during the failed run
        for (const filePath of savedCompressedPaths) {
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                } catch (unlinkErr) {
                    // Ignore unlink errors
                }
            }
        }

        // Clean up remaining Multer temp files if any exist
        const files = req.files as { [fieldname: string]: Express.Multer.File[] } || {};
        for (const key in files) {
            const fileArray = files[key];
            if (fileArray && fileArray.length > 0 && fs.existsSync(fileArray[0].path)) {
                try {
                    fs.unlinkSync(fileArray[0].path);
                } catch (e) {}
            }
        }

        const statusCode = err.statusCode || 500;
        res.status(statusCode).json({ 
            success: false, 
            message: err.message || 'Failed to create QMS.' 
        });
    } finally {
        client.release();
    }
};

/**
 * Helper function to update/replace QMS files.
 * Validates file types/sizes, enforces transaction safety, rollbacks correctly, and deletes old physical files after successful commits.
 */
async function handleFileUpdate(
    req: Request,
    res: Response,
    file: Express.Multer.File | undefined,
    fileType: string,
    remarks: string,
    userName: string,
    qmsId: string
) {
    const creator = userName || 'System';

    if (!file) {
        return res.status(400).json({ error: 'New file is required.' });
    }

    if (!fileType) {
        if (file && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }
        return res.status(400).json({ error: 'File type is required.' });
    }

    if (!remarks || !remarks.trim()) {
        if (file && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }
        return res.status(400).json({ error: 'Remarks/comments are mandatory for every update.' });
    }

    const validFileTypes = ['bom', 'pfc', 'xy', 'ecn', 'drawing'];
    if (!validFileTypes.includes(fileType)) {
        if (file && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }
        return res.status(400).json({ error: `Invalid file type: ${fileType}.` });
    }

    const allowedExtensions = ['.pdf', '.xls', '.xlsx', '.csv', '.zip'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.includes(ext)) {
        if (file && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }
        return res.status(400).json({ error: `File type ${ext} is not allowed. Only PDF, Excel, CSV, and ZIP files are permitted.` });
    }

    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX_SIZE) {
        if (file && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }
        return res.status(400).json({ error: 'File size must not exceed 50MB.' });
    }

    let bomItems: any[] = [];
    let parsedBomRevision = '';
    if (fileType === 'bom') {
        try {
            parsedBomRevision = await extractBomRevisionFromFile(file.path);
            bomItems = await extractBomItemsFromFile(file.path);
        } catch (parseErr: any) {
            if (file && fs.existsSync(file.path)) {
                try { fs.unlinkSync(file.path); } catch (e) {}
            }
            return res.status(400).json({ success: false, error: parseErr.message || 'Failed to parse BOM file.', message: parseErr.message });
        }
    }

    const poolClient = await pool.connect();
    let savedPath = '';
    let relativePath = '';
    let oldFileToDelete = '';

    try {
        // Fetch current active master record
        const masterRes = await poolClient.query(
            `SELECT * FROM qms_master WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [qmsId]
        );
        if (masterRes.rows.length === 0) {
            poolClient.release();
            if (file && fs.existsSync(file.path)) {
                try { fs.unlinkSync(file.path); } catch (e) {}
            }
            return res.status(404).json({ success: false, error: 'QMS record not found.', message: 'QMS record not found.' });
        }

        const master = masterRes.rows[0];
        const oldMetadata = master.files_metadata?.[fileType] || null;
        const previousRevision = oldMetadata?.revision || null;
        const nextRev = fileType === 'bom'
            ? parsedBomRevision
            : incrementRevision(previousRevision);

        if (fileType === 'bom') {
            const dupCheck = await poolClient.query(
                `SELECT id FROM qms_bom_revisions WHERE qms_id = $1 AND revision_number = $2`,
                [qmsId, nextRev]
            );
            if (dupCheck.rows.length > 0) {
                poolClient.release();
                if (file && fs.existsSync(file.path)) {
                    try { fs.unlinkSync(file.path); } catch (e) {}
                }
                return res.status(400).json({
                    success: false,
                    error: `BOM Revision ${nextRev} already exists for this Work Order/QMS record.`,
                    message: `BOM Revision ${nextRev} already exists for this Work Order/QMS record.`
                });
            }
        }

        // Determine old physical file path to delete later (after successful commit)
        if (fileType === 'bom') oldFileToDelete = master.bom_file_path;
        else if (fileType === 'pfc') oldFileToDelete = master.pfc_file_path;
        else if (fileType === 'xy') oldFileToDelete = master.xy_data_file_path;
        else if (fileType === 'ecn') oldFileToDelete = master.ecn_file_path;
        else if (fileType === 'drawing') oldFileToDelete = master.assembly_drawing_file_path;

        // 1. Process and compress the uploaded file first
        const isZip = ext === '.zip';
        const docTypeTag = fileType === 'drawing' ? 'DRAWING' : fileType.toUpperCase();
        const destName = generateFileName(master.work_order_number, docTypeTag, nextRev, creator, true, file.originalname);

        const result = await processUpload(file.path, destName, isZip);
        savedPath = result.savedPath;
        relativePath = `QMS-Data/${destName}`;

        const compRatio = result.originalSize > 0 
            ? parseFloat(((result.originalSize - result.compressedSize) / result.originalSize * 100).toFixed(2)) 
            : 0;

        // 2. Start Transaction for DB operations
        await poolClient.query('BEGIN');

        // Update files_metadata JSONB
        const metadata = master.files_metadata || {};
        metadata[fileType] = {
            originalName: file.originalname,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            compressionRatio: compRatio,
            fileHash: result.fileHash,
            compressedHash: result.compressedHash,
            uploadedBy: creator,
            uploadedAt: new Date().toISOString(),
            revision: nextRev
        };

        // Determine column name
        let colName = '';
        if (fileType === 'bom') colName = 'bom_file_path';
        else if (fileType === 'pfc') colName = 'pfc_file_path';
        else if (fileType === 'xy') colName = 'xy_data_file_path';
        else if (fileType === 'ecn') colName = 'ecn_file_path';
        else if (fileType === 'drawing') colName = 'assembly_drawing_file_path';

        // Update master table
        let updateQuery = '';
        let updateParams: any[] = [];
        if (fileType === 'bom') {
            updateQuery = `
                UPDATE qms_master
                SET bom_file_path = $1,
                    current_bom_revision = $2,
                    files_metadata = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
            `;
            updateParams = [relativePath, nextRev, JSON.stringify(metadata), qmsId];
        } else {
            updateQuery = `
                UPDATE qms_master
                SET ${colName} = $1,
                    files_metadata = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $3
            `;
            updateParams = [relativePath, JSON.stringify(metadata), qmsId];
        }
        await poolClient.query(updateQuery, updateParams);

        // Insert log in qms_file_revisions
        await poolClient.query(`
            INSERT INTO qms_file_revisions (
                qms_id, file_type, previous_revision, new_revision, uploaded_by, remarks
            ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [qmsId, fileType, previousRevision, nextRev, creator, remarks]);

        // Insert legacy log for BOM
        if (fileType === 'bom') {
            const bomRevRes = await poolClient.query(`
                INSERT INTO qms_bom_revisions (
                    qms_id, revision_number, bom_file_path, original_name, 
                    original_size, compressed_size, compression_ratio, 
                    file_hash, compressed_file_hash, uploaded_by, remarks
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING id
            `, [
                qmsId, nextRev, relativePath, file.originalname,
                result.originalSize, result.compressedSize, compRatio,
                result.fileHash, result.compressedHash, creator, remarks
            ]);
            const bomRevisionId = bomRevRes.rows[0].id;
            await saveBomItems(poolClient, parseInt(qmsId, 10), bomRevisionId, bomItems);
        }

        // Audit log
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        await poolClient.query(`
            INSERT INTO qms_activity_logs (qms_id, work_order_number, action, details, performed_by, ip_address)
            VALUES ($1, $2, 'FILE_UPDATE', $3, $4, $5)
        `, [qmsId, master.work_order_number, `Replaced ${fileType.toUpperCase()} file (Rev ${nextRev}) with ${file.originalname}`, creator, ip as string]);

        await poolClient.query('COMMIT');

        // 3. Delete Old Physical File AFTER successful commit
        if (oldFileToDelete) {
            const uploadsDir = getUploadsDir();
            const oldPhysicalPath = oldFileToDelete.startsWith('QMS-Data/')
                ? path.join(uploadsDir, oldFileToDelete)
                : path.join(QMS_UPLOADS_DIR, oldFileToDelete);

            if (fs.existsSync(oldPhysicalPath)) {
                try {
                    fs.unlinkSync(oldPhysicalPath);
                    logger.info(`Successfully deleted old physical file: ${oldPhysicalPath}`);
                } catch (e) {
                    logger.warn(`Failed to delete old physical file: ${oldPhysicalPath}`, e);
                }
            }
        }

        res.status(200).json({ message: `${fileType.toUpperCase()} file updated successfully to Rev ${nextRev}.` });

    } catch (err: any) {
        await poolClient.query('ROLLBACK');
        logger.error(`Error updating QMS ${fileType} file:`, err);
        console.error("BOM Upload Error:", err);

        // Fallback Cleanup for Failed Transaction (delete newly processed file)
        if (savedPath && fs.existsSync(savedPath)) {
            try {
                fs.unlinkSync(savedPath);
                logger.info(`Cleaned up newly uploaded file after rollback: ${savedPath}`);
            } catch (e) {
                logger.warn(`Failed to clean up newly uploaded file after rollback: ${savedPath}`, e);
            }
        }

        // Clean up temp file too if it still exists
        if (file && fs.existsSync(file.path)) {
            try { fs.unlinkSync(file.path); } catch (e) {}
        }

        res.status(500).json({ 
            success: false, 
            message: `Failed to update ${fileType} file`, 
            error: err.message || `Failed to update ${fileType} file.`
        });
    } finally {
        poolClient.release();
    }
}

/**
 * POST /api/smt/qms/bom-revision/:qmsId
 * Uploads a new BOM file revision, increments BOM version number, and updates master.
 */
export const uploadBomRevision = async (req: Request, res: Response) => {
    console.log("QMS ID:", req.params.id);
    console.log("Body:", req.body);
    console.log("Files:", req.files);
    console.log("File:", req.file);

    const { qmsId } = req.params;
    const { userName, remarks } = req.body;
    const file = req.file;
    return handleFileUpdate(req, res, file, 'bom', remarks, userName, qmsId);
};

/**
 * POST /api/smt/qms/update-file/:qmsId
 * Replaces pfc, xy, ecn, or drawing documents. Deletes older physical files and commits transaction.
 */
export const updateQmsFile = async (req: Request, res: Response) => {
    const { qmsId } = req.params;
    const { fileType, userName, remarks } = req.body;
    const file = req.file;
    return handleFileUpdate(req, res, file, fileType, remarks, userName, qmsId);
};

/**
 * GET /api/qms/files/:action/:qmsId/:fileType
 * secure view / download of files by looking up path in the database.
 * Decompresses gzip on-the-fly.
 */
export const serveQmsFile = async (req: Request, res: Response) => {
    const { action, qmsId, fileType } = req.params;
    
    // JWT Security check
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        token = req.query.token as string;
    }
    
    if (!token) {
        return res.status(401).json({ error: 'Access Denied: No Token Provided' });
    }

    try {
        const secret = process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_this';
        jwt.verify(token, secret);
    } catch (error: any) {
        return res.status(403).json({ error: `Invalid Token: ${error.message}` });
    }
    
    try {
        const masterRes = await pool.query(
            `SELECT * FROM qms_master WHERE id = $1 AND is_deleted = false`,
            [qmsId]
        );
        if (masterRes.rows.length === 0) {
            return res.status(404).json({ error: 'QMS record not found.' });
        }

        const master = masterRes.rows[0];
        let fileRelativePath = '';

        if (fileType === 'bom') fileRelativePath = master.bom_file_path;
        else if (fileType === 'pfc') fileRelativePath = master.pfc_file_path;
        else if (fileType === 'xy') fileRelativePath = master.xy_data_file_path;
        else if (fileType === 'ecn') fileRelativePath = master.ecn_file_path;
        else if (fileType === 'drawing') fileRelativePath = master.assembly_drawing_file_path;

        if (!fileRelativePath) {
            return res.status(404).json({ error: `No file uploaded for ${fileType.toUpperCase()}.` });
        }

        const uploadsDir = getUploadsDir();
        const fullPath = fileRelativePath.startsWith('QMS-Data/')
            ? path.join(uploadsDir, fileRelativePath)
            : path.join(QMS_UPLOADS_DIR, fileRelativePath);

        logger.info(`QMS serve request:`, {
            action,
            qmsId,
            fileType,
            dbRelativePath: fileRelativePath,
            resolvedFullPath: fullPath,
            exists: fs.existsSync(fullPath)
        });

        if (!fs.existsSync(fullPath)) {
            logger.error(`QMS file serving error: File does not exist physically at resolved path: ${fullPath}`);
            return res.status(404).json({ error: 'File not found on server storage.' });
        }

        // Set Headers
        const mimeType = getMimeType(fileRelativePath);
        const originalName = master.files_metadata?.[fileType]?.originalName || path.basename(fileRelativePath);

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Type', mimeType);

        if (action === 'download') {
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalName)}"`);
        } else {
            res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
        }

        // Stream and decompress if necessary
        const readStream = fs.createReadStream(fullPath);

        if (fileRelativePath.endsWith('.gz')) {
            const gunzip = zlib.createGunzip();
            readStream.pipe(gunzip).pipe(res);
        } else {
            readStream.pipe(res);
        }

    } catch (err) {
        logger.error('Error serving QMS file:', err);
        res.status(500).json({ error: 'Failed to stream QMS file.' });
    }
};

/**
 * POST /api/qms/delete/:qmsId
 * Soft deletes a QMS record.
 */
export const deleteQms = async (req: Request, res: Response) => {
    const { qmsId } = req.params;
    const { userName } = req.body;
    const creator = userName || 'System';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if exists
        const check = await client.query(
            `SELECT id, work_order_number FROM qms_master WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [qmsId]
        );

        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'QMS record not found.' });
        }

        const work_order_number = check.rows[0].work_order_number;

        // Perform Soft Delete
        await client.query(`
            UPDATE qms_master
            SET is_deleted = true,
                deleted_at = CURRENT_TIMESTAMP,
                deleted_by = $1,
                status = 'Deleted'
            WHERE id = $2
        `, [creator, qmsId]);

        // Insert audit log
        const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        await client.query(`
            INSERT INTO qms_activity_logs (qms_id, work_order_number, action, details, performed_by, ip_address)
            VALUES ($1, $2, 'DELETE_QMS', 'Soft deleted QMS master record', $3, $4)
        `, [qmsId, work_order_number, creator, ip as string]);

        await client.query('COMMIT');
        res.status(200).json({ message: 'QMS record soft deleted successfully.' });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error deleting QMS ${qmsId}:`, err);
        res.status(500).json({ error: err.message || 'Failed to delete QMS record.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/smt/qms/bom-items/:revisionId
 * Fetches components inside a specific BOM revision with server-side search, sorting, and pagination.
 */
export const getBomItems = async (req: Request, res: Response) => {
    const { revisionId } = req.params;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 100;
    const search = (req.query.search as string || '').trim();
    const sortBy = (req.query.sortBy as string || 'id').trim();
    const sortOrder = (req.query.sortOrder as string || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    const offset = (page - 1) * limit;

    // Validate sortBy to prevent SQL Injection
    const allowedSortFields = ['id', 'sl_no', 'vepl_part_no', 'description', 'manufacturer', 'manufacturer_part_no', 'qty_per_product'];
    if (!allowedSortFields.includes(sortBy)) {
        return res.status(400).json({ success: false, error: 'Invalid sort field.' });
    }

    try {
        // Fetch metadata
        const revCheck = await pool.query(
            `SELECT r.*, m.work_order_number, m.product_name, m.po_number 
             FROM qms_bom_revisions r
             JOIN qms_master m ON r.qms_id = m.id
             WHERE r.id = $1 AND m.is_deleted = false`,
            [revisionId]
        );

        if (revCheck.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'BOM revision not found.' });
        }

        const revisionData = revCheck.rows[0];

        // 1. Count total components in this revision (without search, using valid sl_no regex pattern to exclude any non-numeric/footer lines)
        const totalComponentsRes = await pool.query(
            `SELECT COUNT(sl_no) as total FROM qms_bom_items WHERE bom_revision_id = $1 AND sl_no ~ '^[0-9]+$'`,
            [revisionId]
        );
        const totalComponents = parseInt(totalComponentsRes.rows[0].total, 10);

        // 2. Count total items matching search
        let countParams: any[] = [revisionId];
        let countQuery = `
            SELECT COUNT(sl_no) as total
            FROM qms_bom_items
            WHERE bom_revision_id = $1 AND sl_no ~ '^[0-9]+$'
        `;
        if (search) {
            countQuery += ` AND (
                vepl_part_no ILIKE $2 OR
                description ILIKE $2 OR
                manufacturer ILIKE $2 OR
                manufacturer_part_no ILIKE $2
            )`;
            countParams.push(`%${search}%`);
        }
        const countRes = await pool.query(countQuery, countParams);
        const totalItems = parseInt(countRes.rows[0].total, 10);

        // 3. Get paginated and sorted items
        let queryParams: any[] = [revisionId];
        let itemsQuery = `
            SELECT id, sl_no, vepl_part_no, description, manufacturer, manufacturer_part_no, qty_per_product
            FROM qms_bom_items
            WHERE bom_revision_id = $1 AND sl_no ~ '^[0-9]+$'
        `;
        if (search) {
            itemsQuery += ` AND (
                vepl_part_no ILIKE $2 OR
                description ILIKE $2 OR
                manufacturer ILIKE $2 OR
                manufacturer_part_no ILIKE $2
            )`;
            queryParams.push(`%${search}%`);
        }

        // Apply sorting and pagination
        itemsQuery += ` ORDER BY ${sortBy} ${sortOrder} LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        queryParams.push(limit, offset);

        const itemsRes = await pool.query(itemsQuery, queryParams);

        res.status(200).json({
            success: true,
            revision: revisionData.revision_number,
            totalItems,
            page,
            limit,
            items: itemsRes.rows,
            metadata: {
                workOrderNumber: revisionData.work_order_number,
                productName: revisionData.product_name,
                poNumber: revisionData.po_number,
                revision: `Rev ${revisionData.revision_number}`,
                uploadedBy: revisionData.uploaded_by,
                uploadedDate: revisionData.uploaded_at,
                totalComponents
            }
        });
    } catch (err) {
        logger.error(`Error fetching BOM items for revision ${revisionId}:`, err);
        res.status(500).json({ success: false, error: 'Failed to fetch BOM items.' });
    }
};
