import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';
import { getUploadsDir, QMS_UPLOADS_DIR } from '../services/qmsDocumentService';

const logger = createLogger('msdTrackerController');

// Hardcoded J-STD-033 Bake Time Lookup Table (Exceeding Floor Life >72 Hours)
const BAKE_LOOKUP: Record<string, Record<string, Record<string, number>>> = {
    'Category 1': { // thickness <= 1.4 mm
        'L-2':   { 'Bake @125°C': 5,  'Bake @90°C ≤5% RH': 18,  'Bake @40°C ≤5% RH': 120 },
        'L-2A':  { 'Bake @125°C': 7,  'Bake @90°C ≤5% RH': 23,  'Bake @40°C ≤5% RH': 144 },
        'L-3':   { 'Bake @125°C': 9,  'Bake @90°C ≤5% RH': 33,  'Bake @40°C ≤5% RH': 192 },
        'L-4':   { 'Bake @125°C': 11, 'Bake @90°C ≤5% RH': 37,  'Bake @40°C ≤5% RH': 240 },
        'L-5':   { 'Bake @125°C': 12, 'Bake @90°C ≤5% RH': 41,  'Bake @40°C ≤5% RH': 288 },
        'L-5A':  { 'Bake @125°C': 16, 'Bake @90°C ≤5% RH': 54,  'Bake @40°C ≤5% RH': 360 },
        'L-6':   { 'Bake @125°C': 24, 'Bake @90°C ≤5% RH': 72,  'Bake @40°C ≤5% RH': 480 },
    },
    'Category 2': { // 1.4 < thickness <= 2.0 mm
        'L-2':   { 'Bake @125°C': 18, 'Bake @90°C ≤5% RH': 48,  'Bake @40°C ≤5% RH': 240 },
        'L-2A':  { 'Bake @125°C': 21, 'Bake @90°C ≤5% RH': 56,  'Bake @40°C ≤5% RH': 288 },
        'L-3':   { 'Bake @125°C': 27, 'Bake @90°C ≤5% RH': 72,  'Bake @40°C ≤5% RH': 360 },
        'L-4':   { 'Bake @125°C': 34, 'Bake @90°C ≤5% RH': 90,  'Bake @40°C ≤5% RH': 480 },
        'L-5':   { 'Bake @125°C': 40, 'Bake @90°C ≤5% RH': 120, 'Bake @40°C ≤5% RH': 600 },
        'L-5A':  { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
        'L-6':   { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
    },
    'Category 3': { // 2.0 < thickness <= 4.5 mm
        'L-2':   { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
        'L-2A':  { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
        'L-3':   { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
        'L-4':   { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
        'L-5':   { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
        'L-5A':  { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
        'L-6':   { 'Bake @125°C': 48, 'Bake @90°C ≤5% RH': 144, 'Bake @40°C ≤5% RH': 720 },
    }
};

// Normalize MSL values
function normalizeMSL(val: any): string | null {
    if (val === undefined || val === null) return null;
    const str = String(val).trim().toUpperCase();
    if (!str) return null;

    const clean = str.replace(/\s+/g, '').replace(/^-+|-+$/g, '');

    // Rejected values
    if (['L1', 'L-1', '1', 'NA', 'UNKNOWN', 'INVALID', 'BLANK'].includes(clean)) {
        return null;
    }

    const match = clean.match(/^(L)?-?([23456]|2A|5A)$/i);
    if (match) {
        const level = match[2].toUpperCase();
        return `L-${level}`;
    }

    return null;
}

// Maps Package body thickness to J-STD-033 Category
function getThicknessCategory(thickness: number): string {
    if (thickness <= 1.4) return 'Category 1';
    if (thickness <= 2.0) return 'Category 2';
    return 'Category 3';
}

// Format milliseconds to HH:MM:SS
function formatDuration(ms: number): string {
    if (ms < 0) return '00:00:00';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Format Date object to YYYY-MM-DD HH:mm:ss
function formatDateStr(date: Date | null): string {
    if (!date) return '';
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * GET /api/msd-tracker/eligible-work-orders
 */
export const getEligibleWorkOrders = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 
                wo.id AS work_order_id,
                wo.product_name,
                wo.product_description,
                wo.quantity,
                mm.id AS material_management_id,
                q.id AS qms_id,
                q.bom_file_path
            FROM smt_work_orders wo
            JOIN material_management mm ON wo.id = mm.work_order_id
            JOIN qms_master q ON mm.qms_id = q.id
            WHERE q.is_deleted = false
              AND q.bom_file_path IS NOT NULL AND q.bom_file_path != ''
              AND EXISTS (
                  SELECT 1 
                  FROM material_management_items mmi 
                  WHERE mmi.material_management_id = mm.id 
                    AND mmi.issued_qty > 0
              )
              AND NOT EXISTS (
                  SELECT 1 
                  FROM msd_master msd 
                  WHERE msd.work_order_id = wo.id
              )
            ORDER BY wo.created_at DESC
        `;
        const result = await pool.query(query);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error(`Error fetching eligible work orders: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /api/msd-tracker
 * Create MSD record and import BOM components
 */
export const createMsdRecord = async (req: Request, res: Response) => {
    const { work_order_id, remarks } = req.body;
    const userName = (req as any).user?.name || req.body.userName || 'System';

    if (!work_order_id) {
        return res.status(400).json({ success: false, error: 'work_order_id is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Verify existence of Work Order in the database
        const woCheckQuery = `
            SELECT id, product_name, product_description, quantity
            FROM smt_work_orders
            WHERE id = $1
        `;
        const woCheckRes = await client.query(woCheckQuery, [work_order_id]);
        if (woCheckRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Selected Work Order was not found.' });
        }
        const woRecord = woCheckRes.rows[0];

        // Verify eligibility criteria
        const eligibilityQuery = `
            SELECT 
                mm.id AS material_management_id,
                q.id AS qms_id,
                q.bom_file_path
            FROM material_management mm
            JOIN qms_master q ON mm.qms_id = q.id
            WHERE mm.work_order_id = $1 AND q.is_deleted = false
              AND q.bom_file_path IS NOT NULL AND q.bom_file_path != ''
              AND EXISTS (
                  SELECT 1 
                  FROM material_management_items mmi 
                  WHERE mmi.material_management_id = mm.id 
                    AND mmi.issued_qty > 0
              )
              AND NOT EXISTS (
                  SELECT 1 
                  FROM msd_master msd 
                  WHERE msd.work_order_id = $1
              )
        `;
        const eligResult = await client.query(eligibilityQuery, [work_order_id]);
        if (eligResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: 'Work Order is not eligible or already has an MSD Record.' 
            });
        }
        const eligInfo = eligResult.rows[0];

        const woInfo = {
            work_order_id: woRecord.id,
            work_order_number: woRecord.id, // wo.id stores the work order number string
            product_name: woRecord.product_name,
            product_description: woRecord.product_description,
            quantity: woRecord.quantity,
            material_management_id: eligInfo.material_management_id,
            qms_id: eligInfo.qms_id,
            bom_file_path: eligInfo.bom_file_path
        };

        // 2. Validate work order fields before insertion to prevent constraint violations
        if (!woInfo.work_order_id || !woInfo.work_order_number || !woInfo.product_name || woInfo.quantity === null || woInfo.quantity === undefined) {
            const missingFields: string[] = [];
            if (!woInfo.work_order_id) missingFields.push('work_order_id');
            if (!woInfo.work_order_number) missingFields.push('work_order_number');
            if (!woInfo.product_name) missingFields.push('product_name');
            if (woInfo.quantity === null || woInfo.quantity === undefined) missingFields.push('quantity');

            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `Validation Error: Required field(s) ${missingFields.join(', ')} cannot be null or missing.`
            });
        }

        // 3. Read and parse BOM Excel
        const uploadsDir = getUploadsDir();
        const fileRelativePath = woInfo.bom_file_path;
        const fullPath = fileRelativePath.startsWith('QMS-Data/')
            ? path.join(uploadsDir, fileRelativePath)
            : path.join(QMS_UPLOADS_DIR, fileRelativePath);

        if (!fs.existsSync(fullPath)) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'BOM Excel file not found on server storage.' });
        }

        let buffer = fs.readFileSync(fullPath);
        if (fileRelativePath.endsWith('.gz')) {
            buffer = zlib.gunzipSync(buffer);
        }

        let workbook;
        try {
            workbook = XLSX.read(buffer, { type: 'buffer' });
        } catch (e: any) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: `Invalid Excel file: ${e.message}` });
        }

        const sheetName = workbook.SheetNames.find(name => name.trim().toUpperCase() === 'BOM')
            || workbook.SheetNames.find(name => name.toUpperCase().includes('BOM'))
            || workbook.SheetNames[0];

        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Worksheet does not exist in BOM file.' });
        }

        const rangeRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        if (rangeRows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'BOM worksheet is empty.' });
        }

        // Helper to clean column headers
        const cleanHeader = (val: any): string => {
            if (val === undefined || val === null) return '';
            return String(val).trim().toLowerCase().replace(/[\s\.\/\-_]/g, '');
        };

        // Match column name to internal field
        const detectColumnField = (cleaned: string): string | null => {
            if (['slno', 'sno'].includes(cleaned)) return 'sl_no';
            if (['veplpartno', 'veplpartnumber', 'veplpn', 'partnumber', 'partno'].includes(cleaned)) return 'vepl_part_no';
            if (['description', 'componentdescription'].includes(cleaned)) return 'description';
            if (['manufacturer', 'mfr', 'mfg', 'make'].includes(cleaned)) return 'manufacturer';
            if (['mfrpartno', 'mfrpartnumber', 'manufacturerpartnumber', 'manufacturerpartno'].includes(cleaned)) return 'mfr_part_no';
            if (['qtyproduct', 'qtyperproduct', 'qtyperprod', 'qtyprod', 'qty'].includes(cleaned)) return 'qty_per_product';
            if (['requiredqty', 'requiredquantity', 'qtyrequired', 'reqqty'].includes(cleaned)) return 'required_qty';
            if (['msl', 'moisturesensitivitylevel'].includes(cleaned)) return 'msl';
            return null;
        };

        interface ColumnMapping {
            sl_no: number;
            vepl_part_no: number;
            description: number;
            manufacturer: number;
            mfr_part_no: number;
            qty_per_product: number;
            required_qty: number;
            msl: number;
            [key: string]: number;
        }

        let bestRowIdx = -1;
        let bestMatchCount = 0;
        let bestMapping: ColumnMapping = {
            sl_no: -1,
            vepl_part_no: -1,
            description: -1,
            manufacturer: -1,
            mfr_part_no: -1,
            qty_per_product: -1,
            required_qty: -1,
            msl: -1
        };

        // Scan first 20 rows
        const maxRowsToScan = Math.min(20, rangeRows.length);
        for (let r = 0; r < maxRowsToScan; r++) {
            const row = rangeRows[r];
            if (!row || !Array.isArray(row)) continue;

            const currentMapping: ColumnMapping = {
                sl_no: -1,
                vepl_part_no: -1,
                description: -1,
                manufacturer: -1,
                mfr_part_no: -1,
                qty_per_product: -1,
                required_qty: -1,
                msl: -1
            };

            let matchCount = 0;
            for (let c = 0; c < row.length; c++) {
                const cleaned = cleanHeader(row[c]);
                const field = detectColumnField(cleaned);
                if (field) {
                    if (currentMapping[field] === -1) {
                        currentMapping[field] = c;
                        if (['vepl_part_no', 'description', 'manufacturer', 'mfr_part_no', 'qty_per_product', 'msl'].includes(field)) {
                            matchCount++;
                        }
                    }
                }
            }

            if (matchCount > bestMatchCount) {
                bestMatchCount = matchCount;
                bestRowIdx = r;
                bestMapping = currentMapping;
            }
        }

        if (bestRowIdx === -1 || bestMatchCount < 4) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Could not locate a valid BOM header row in the first 20 rows of the sheet.'
            });
        }

        // Validate that all strictly required columns exist in bestMapping
        const missingColumns: string[] = [];
        if (bestMapping.vepl_part_no === -1) missingColumns.push('VEPL Part No');
        if (bestMapping.description === -1) missingColumns.push('Description');
        if (bestMapping.manufacturer === -1) missingColumns.push('Manufacturer');
        if (bestMapping.mfr_part_no === -1) missingColumns.push('Mfr. Part No');
        if (bestMapping.qty_per_product === -1) missingColumns.push('Qty / Product');
        if (bestMapping.msl === -1) missingColumns.push('MSL');

        if (missingColumns.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: `Missing required BOM columns: ${missingColumns.join(', ')}`
            });
        }

        // Log detected mappings
        const getColumnLetter = (colIndex: number): string => {
            let temp = colIndex;
            let letter = '';
            while (temp >= 0) {
                letter = String.fromCharCode((temp % 26) + 65) + letter;
                temp = Math.floor(temp / 26) - 1;
            }
            return letter;
        };

        logger.info(`Header Row: ${bestRowIdx + 1}`);
        logger.info('Detected Columns:');
        if (bestMapping.sl_no !== -1) logger.info(`Sl No -> Column ${getColumnLetter(bestMapping.sl_no)}`);
        logger.info(`VEPL Part No -> Column ${getColumnLetter(bestMapping.vepl_part_no)}`);
        logger.info(`Description -> Column ${getColumnLetter(bestMapping.description)}`);
        logger.info(`Manufacturer -> Column ${getColumnLetter(bestMapping.manufacturer)}`);
        logger.info(`Mfr Part No -> Column ${getColumnLetter(bestMapping.mfr_part_no)}`);
        logger.info(`Qty/Product -> Column ${getColumnLetter(bestMapping.qty_per_product)}`);
        if (bestMapping.required_qty !== -1) {
            logger.info(`Required Qty -> Column ${getColumnLetter(bestMapping.required_qty)}`);
        }
        logger.info(`MSL -> Column ${getColumnLetter(bestMapping.msl)}`);

        // Retrieve Material Management items for matching issued quantities
        const mmItemsQuery = `
            SELECT id, vepl_part_no, issued_qty 
            FROM material_management_items 
            WHERE material_management_id = $1
        `;
        const mmItemsRes = await client.query(mmItemsQuery, [woInfo.material_management_id]);
        const mmItemsMap = new Map<string, { id: string; issued_qty: number }>();
        for (const row of mmItemsRes.rows) {
            if (row.vepl_part_no) {
                mmItemsMap.set(row.vepl_part_no.trim(), { id: row.id, issued_qty: Number(row.issued_qty) || 0 });
            }
        }

        // Parse items
        const importedItems: any[] = [];
        const seenVeplParts = new Set<string>();

        for (let r = bestRowIdx + 1; r < rangeRows.length; r++) {
            const row = rangeRows[r];
            if (!row || !Array.isArray(row)) continue;

            const veplPartRaw = row[bestMapping.vepl_part_no];
            if (veplPartRaw === undefined || veplPartRaw === null) continue;
            const veplPartNo = String(veplPartRaw).trim();
            if (!veplPartNo) continue; // Ignore blank rows

            // Ignore duplicates
            if (seenVeplParts.has(veplPartNo)) {
                logger.warn(`Ignoring duplicate VEPL Part Number: ${veplPartNo}`);
                continue;
            }
            seenVeplParts.add(veplPartNo);

            // Parse & normalize MSL
            const mslRawVal = row[bestMapping.msl];
            const normalizedMsl = normalizeMSL(mslRawVal);
            if (!normalizedMsl) {
                // Ignore invalid MSL or L1
                continue;
            }

            const slNo = bestMapping.sl_no !== -1 && row[bestMapping.sl_no] !== undefined ? String(row[bestMapping.sl_no]).trim() : '';
            const description = bestMapping.description !== -1 && row[bestMapping.description] !== undefined ? String(row[bestMapping.description]).trim() : '';
            const manufacturer = bestMapping.manufacturer !== -1 && row[bestMapping.manufacturer] !== undefined ? String(row[bestMapping.manufacturer]).trim() : '';
            const mfrPartNo = bestMapping.mfr_part_no !== -1 && row[bestMapping.mfr_part_no] !== undefined ? String(row[bestMapping.mfr_part_no]).trim() : '';
            const qtyPerProduct = bestMapping.qty_per_product !== -1 && row[bestMapping.qty_per_product] !== undefined ? Number(row[bestMapping.qty_per_product]) || 0 : 0;
            
            let requiredQty = 0;
            if (bestMapping.required_qty !== -1 && row[bestMapping.required_qty] !== undefined) {
                requiredQty = Number(row[bestMapping.required_qty]) || 0;
            } else {
                requiredQty = qtyPerProduct * Number(woInfo.quantity || 0);
            }

            const mmItem = mmItemsMap.get(veplPartNo);
            const mmItemId = mmItem ? mmItem.id : null;
            const issuedQty = mmItem ? mmItem.issued_qty : 0;

            importedItems.push({
                material_management_item_id: mmItemId,
                sl_no: slNo,
                vepl_part_no: veplPartNo,
                description,
                manufacturer,
                mfr_part_no: mfrPartNo,
                qty_per_product: qtyPerProduct,
                required_qty: requiredQty,
                issued_qty: issuedQty,
                msl_raw: mslRawVal ? String(mslRawVal).trim() : '',
                msl_normalized: normalizedMsl
            });
        }

        if (importedItems.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                success: false, 
                error: 'No moisture sensitive devices (MSL >= L-2) found in the BOM sheet.' 
            });
        }

        // 4. Debug log before insert
        logger.info(`Inserting MSD Master Record: ID=${woInfo.work_order_id}, Number=${woInfo.work_order_number}, Product=${woInfo.product_name}, Quantity=${woInfo.quantity}`);

        // 5. Save inside transaction
        const insertMasterQuery = `
            INSERT INTO msd_master (
                work_order_id, work_order_number, product_name, product_description, quantity, remarks, status, created_by, updated_by
            ) VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $7) RETURNING id
        `;
        const masterRes = await client.query(insertMasterQuery, [
            woInfo.work_order_id,
            woInfo.work_order_number,
            woInfo.product_name,
            woInfo.product_description,
            woInfo.quantity,
            remarks || '',
            userName
        ]);

        const msdId = masterRes.rows[0].id;

        const insertItemQuery = `
            INSERT INTO msd_bom_items (
                msd_id, material_management_item_id, sl_no, vepl_part_no, description, 
                manufacturer, mfr_part_no, qty_per_product, required_qty, issued_qty, 
                msl_raw, msl_normalized, timer_status, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'NOT_STARTED', 'Pending')
        `;

        for (const item of importedItems) {
            await client.query(insertItemQuery, [
                msdId,
                item.material_management_item_id,
                item.sl_no,
                item.vepl_part_no,
                item.description,
                item.manufacturer,
                item.mfr_part_no,
                item.qty_per_product,
                item.required_qty,
                item.issued_qty,
                item.msl_raw,
                item.msl_normalized
            ]);
        }

        // Audit Log
        const browser = req.headers['user-agent'] || 'Unknown';
        const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'Unknown';
        const insertAuditQuery = `
            INSERT INTO msd_audit_logs (msd_id, action, performed_by, browser, ip_address, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await client.query(insertAuditQuery, [
            msdId,
            'MSD Created',
            userName,
            browser,
            ipAddress,
            `Created MSD Tracker master record for Work Order ${woInfo.work_order_number}. Imported ${importedItems.length} components.`
        ]);

        await client.query('COMMIT');
        res.status(201).json({ success: true, msd_id: msdId });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error creating MSD record: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/msd-tracker
 * List MSD records (Dashboard)
 */
export const getMsdRecords = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const search = (req.query.search as string) || '';
        const sortBy = (req.query.sortBy as string) || 'created_at';
        const sortOrder = (req.query.sortOrder as string) || 'DESC';
        const status = (req.query.status as string) || '';
        const startDate = (req.query.startDate as string) || '';
        const endDate = (req.query.endDate as string) || '';

        const offset = (page - 1) * limit;

        let whereClause = 'WHERE 1=1';
        const queryParams: any[] = [];

        if (search) {
            queryParams.push(`%${search}%`);
            whereClause += ` AND (work_order_number ILIKE $${queryParams.length} OR product_name ILIKE $${queryParams.length})`;
        }

        if (status) {
            queryParams.push(status);
            whereClause += ` AND status = $${queryParams.length}`;
        }

        if (startDate) {
            queryParams.push(startDate);
            whereClause += ` AND created_at >= $${queryParams.length}`;
        }

        if (endDate) {
            queryParams.push(`${endDate} 23:59:59`);
            whereClause += ` AND created_at <= $${queryParams.length}`;
        }

        // Validate sortBy
        const allowedSorts = ['work_order_number', 'product_name', 'quantity', 'status', 'created_by', 'created_at', 'updated_at'];
        const validSortBy = allowedSorts.includes(sortBy) ? sortBy : 'created_at';
        const validSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

        const dataQuery = `
            SELECT * FROM msd_master
            ${whereClause}
            ORDER BY ${validSortBy} ${validSortOrder}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        const countQuery = `
            SELECT COUNT(*) FROM msd_master
            ${whereClause}
        `;

        const dataResult = await pool.query(dataQuery, [...queryParams, limit, offset]);
        const countResult = await pool.query(countQuery, queryParams);

        res.status(200).json({
            success: true,
            data: dataResult.rows,
            totalCount: parseInt(countResult.rows[0].count)
        });

    } catch (err: any) {
        logger.error(`Error listing MSD records: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/msd-tracker/:id
 */
export const getMsdRecordDetail = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const query = `SELECT * FROM msd_master WHERE id = $1`;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'MSD record not found.' });
        }
        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err: any) {
        logger.error(`Error getting MSD record detail: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/msd-tracker/:id/bom
 */
export const getMsdBomItems = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT * FROM msd_bom_items 
            WHERE msd_id = $1 
            ORDER BY 
                CASE WHEN sl_no ~ '^[0-9]+$' THEN CAST(sl_no AS INTEGER) ELSE 99999 END, 
                sl_no ASC, 
                id ASC
        `;
        const result = await pool.query(query, [id]);
        res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error(`Error getting MSD BOM items: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PATCH /api/msd-tracker/bom-item/:id
 */
export const updateBomItem = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { packing_condition, package_thickness, bake_method, open_date, closed_date } = req.body;
    const userName = (req as any).user?.name || req.body.userName || 'System';

    const client = await pool.connect();
    try {
        // Fetch current item
        const currentRes = await client.query('SELECT * FROM msd_bom_items WHERE id = $1', [id]);
        if (currentRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'BOM item not found.' });
        }

        const oldItem = currentRes.rows[0];

        // Prepare updates
        let updatedPacking = oldItem.packing_condition;
        let updatedThickness = oldItem.package_thickness !== null ? Number(oldItem.package_thickness) : null;
        let updatedCategory = oldItem.thickness_category;
        let updatedBakeMethod = oldItem.bake_method;
        let updatedBakeTime = oldItem.bake_time !== null ? Number(oldItem.bake_time) : null;
        let updatedOpenDate = oldItem.open_date ? new Date(oldItem.open_date) : null;
        let updatedClosedDate = oldItem.closed_date ? new Date(oldItem.closed_date) : null;
        let updatedTimerStatus = oldItem.timer_status;
        let updatedIsExpired = oldItem.is_expired;
        let updatedStatus = oldItem.status;

        const changes: Array<{ field: string; oldVal: string; newVal: string }> = [];

        // Validate & apply Packing Condition
        if (packing_condition !== undefined) {
            const nextPacking = packing_condition || null;
            if (nextPacking !== oldItem.packing_condition) {
                changes.push({ field: 'packing_condition', oldVal: oldItem.packing_condition || '', newVal: nextPacking || '' });
                updatedPacking = nextPacking;
            }
        }

        // Validate & apply Thickness
        if (package_thickness !== undefined) {
            const nextThickness = package_thickness !== null && package_thickness !== '' ? Number(package_thickness) : null;
            if (nextThickness !== null && (isNaN(nextThickness) || nextThickness < 0 || nextThickness > 4.5)) {
                return res.status(400).json({ success: false, error: 'Invalid thickness: body thickness must be between 0 and 4.5 mm.' });
            }
            if (nextThickness !== (oldItem.package_thickness !== null ? Number(oldItem.package_thickness) : null)) {
                changes.push({ 
                    field: 'package_thickness', 
                    oldVal: oldItem.package_thickness !== null ? String(oldItem.package_thickness) : '', 
                    newVal: nextThickness !== null ? String(nextThickness) : '' 
                });
                updatedThickness = nextThickness;
                if (nextThickness !== null) {
                    updatedCategory = getThicknessCategory(nextThickness);
                    if (updatedCategory !== oldItem.thickness_category) {
                        changes.push({ field: 'thickness_category', oldVal: oldItem.thickness_category || '', newVal: updatedCategory });
                    }
                } else {
                    updatedCategory = null;
                }
            }
        }

        // Validate & apply Bake Method & Bake Time Engine
        if (bake_method !== undefined) {
            const nextBakeMethod = bake_method || null;
            if (nextBakeMethod && !['Bake @125°C', 'Bake @90°C ≤5% RH', 'Bake @40°C ≤5% RH'].includes(nextBakeMethod)) {
                return res.status(400).json({ success: false, error: 'Invalid bake method selection.' });
            }
            if (nextBakeMethod !== oldItem.bake_method) {
                changes.push({ field: 'bake_method', oldVal: oldItem.bake_method || '', newVal: nextBakeMethod || '' });
                updatedBakeMethod = nextBakeMethod;
            }
        }

        // Calculate Bake Time automatically if category, MSL or bake method changed
        if (updatedPacking === 'Open') {
            if (updatedCategory && updatedBakeMethod) {
                const calculatedBakeTime = BAKE_LOOKUP[updatedCategory]?.[oldItem.msl_normalized]?.[updatedBakeMethod];
                if (calculatedBakeTime !== undefined) {
                    if (calculatedBakeTime !== (oldItem.bake_time !== null ? Number(oldItem.bake_time) : null)) {
                        changes.push({
                            field: 'bake_time',
                            oldVal: oldItem.bake_time !== null ? String(oldItem.bake_time) : '',
                            newVal: String(calculatedBakeTime)
                        });
                        updatedBakeTime = calculatedBakeTime;
                    }
                } else {
                    updatedBakeTime = null;
                }
            } else {
                updatedBakeTime = null;
            }
            // Open workflow has no open/close timers
            updatedOpenDate = null;
            updatedClosedDate = null;
            updatedTimerStatus = 'NOT_STARTED';
            updatedIsExpired = false;

            if (updatedThickness !== null && updatedBakeMethod) {
                updatedStatus = 'OK';
            } else {
                updatedStatus = 'Pending';
            }
        }

        // Validate & apply Open/Closed dates for Sealed workflow
        if (updatedPacking === 'Sealed') {
            if (open_date !== undefined) {
                const nextOpenDate = open_date ? new Date(open_date) : null;
                const oldOpenStr = oldItem.open_date ? new Date(oldItem.open_date).toISOString() : '';
                const nextOpenStr = nextOpenDate ? nextOpenDate.toISOString() : '';
                if (oldOpenStr !== nextOpenStr) {
                    changes.push({ field: 'open_date', oldVal: oldOpenStr, newVal: nextOpenStr });
                    updatedOpenDate = nextOpenDate;
                }
            }

            if (closed_date !== undefined) {
                const nextClosedDate = closed_date ? new Date(closed_date) : null;
                const oldClosedStr = oldItem.closed_date ? new Date(oldItem.closed_date).toISOString() : '';
                const nextClosedStr = nextClosedDate ? nextClosedDate.toISOString() : '';
                if (oldClosedStr !== nextClosedStr) {
                    changes.push({ field: 'closed_date', oldVal: oldClosedStr, newVal: nextClosedStr });
                    updatedClosedDate = nextClosedDate;
                }
            }

            // Date order validation
            if (updatedOpenDate && updatedClosedDate && updatedClosedDate < updatedOpenDate) {
                return res.status(400).json({ success: false, error: 'Closed Date & Time cannot be earlier than Open Date & Time.' });
            }

            // Calculate exposure times and timers
            if (updatedOpenDate) {
                const end = updatedClosedDate ? updatedClosedDate.getTime() : Date.now();
                const diffMs = end - updatedOpenDate.getTime();
                const diffHrs = diffMs / 3600000;
                updatedIsExpired = diffHrs >= 168;

                if (updatedIsExpired) {
                    updatedStatus = 'Expired';
                } else if (updatedOpenDate !== null && updatedClosedDate !== null && updatedThickness !== null) {
                    updatedStatus = 'OK';
                } else {
                    updatedStatus = 'Pending';
                }
                updatedTimerStatus = updatedClosedDate ? 'FROZEN' : 'RUNNING';
            } else {
                updatedTimerStatus = 'NOT_STARTED';
                updatedIsExpired = false;
                updatedStatus = 'Pending';
            }

            // Sealed workflow doesn't use bake method/time
            updatedBakeMethod = null;
            updatedBakeTime = null;
        }

        if (updatedPacking === null) {
            updatedOpenDate = null;
            updatedClosedDate = null;
            updatedThickness = null;
            updatedCategory = null;
            updatedBakeMethod = null;
            updatedBakeTime = null;
            updatedTimerStatus = 'NOT_STARTED';
            updatedIsExpired = false;
            updatedStatus = 'Pending';
        }

        if (updatedStatus !== oldItem.status) {
            changes.push({ field: 'status', oldVal: oldItem.status || '', newVal: updatedStatus });
        }

        // Apply to database inside transaction
        await client.query('BEGIN');

        const updateQuery = `
            UPDATE msd_bom_items
            SET packing_condition = $1,
                package_thickness = $2,
                thickness_category = $3,
                bake_method = $4,
                bake_time = $5,
                open_date = $6,
                closed_date = $7,
                timer_status = $8,
                is_expired = $9,
                status = $10,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
        `;
        await client.query(updateQuery, [
            updatedPacking,
            updatedThickness,
            updatedCategory,
            updatedBakeMethod,
            updatedBakeTime,
            updatedOpenDate,
            updatedClosedDate,
            updatedTimerStatus,
            updatedIsExpired,
            updatedStatus,
            id
        ]);

        // Insert history
        const insertHistoryQuery = `
            INSERT INTO msd_bom_history (bom_item_id, field_name, old_value, new_value, changed_by)
            VALUES ($1, $2, $3, $4, $5)
        `;
        for (const change of changes) {
            await client.query(insertHistoryQuery, [id, change.field, change.oldVal, change.newVal, userName]);
        }

        // Audit Log
        if (changes.length > 0) {
            const browser = req.headers['user-agent'] || 'Unknown';
            const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'Unknown';
            const insertAuditQuery = `
                INSERT INTO msd_audit_logs (msd_id, action, performed_by, browser, ip_address, details)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            const detailsStr = `Updated component ${oldItem.vepl_part_no}. Changes: ${changes.map(c => `${c.field}: ${c.oldVal || 'NULL'} -> ${c.newVal || 'NULL'}`).join(', ')}`;
            await client.query(insertAuditQuery, [
                oldItem.msd_id,
                'BOM Item Updated',
                userName,
                browser,
                ipAddress,
                detailsStr
            ]);
        }

        await client.query('COMMIT');

        // Fetch and return the updated item
        const resultRes = await client.query('SELECT * FROM msd_bom_items WHERE id = $1', [id]);
        res.status(200).json({ success: true, data: resultRes.rows[0] });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error updating BOM item: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/msd-tracker/:id/audit
 */
export const getMsdRecordAudit = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // Fetch audit logs
        const auditLogsQuery = `
            SELECT 
                created_at AS timestamp,
                performed_by AS user,
                action,
                details,
                'Audit Log' AS type
            FROM msd_audit_logs
            WHERE msd_id = $1
        `;
        const auditLogsRes = await pool.query(auditLogsQuery, [id]);

        // Fetch detailed BOM item history
        const bomHistoryQuery = `
            SELECT 
                h.changed_at AS timestamp,
                h.changed_by AS user,
                'BOM Item Updated' AS action,
                'Component: ' || item.vepl_part_no || ' | Field: ' || h.field_name || ' | Old: ' || COALESCE(h.old_value, 'NULL') || ' | New: ' || COALESCE(h.new_value, 'NULL') AS details,
                'BOM History' AS type
            FROM msd_bom_history h
            JOIN msd_bom_items item ON h.bom_item_id = item.id
            WHERE item.msd_id = $1
        `;
        const bomHistoryRes = await pool.query(bomHistoryQuery, [id]);

        const combined = [...auditLogsRes.rows, ...bomHistoryRes.rows].sort((a, b) => {
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });

        res.status(200).json({ success: true, data: combined });
    } catch (err: any) {
        logger.error(`Error getting MSD record audit logs: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/msd-tracker/:id/export/excel
 * Excel Export containing exactly the identical columns and values as the Work With BOM grid.
 */
export const exportMsdToExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const masterRes = await pool.query('SELECT * FROM msd_master WHERE id = $1', [id]);
        if (masterRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'MSD record not found.' });
        }
        const master = masterRes.rows[0];

        const itemsRes = await pool.query(`
            SELECT * FROM msd_bom_items 
            WHERE msd_id = $1 
            ORDER BY 
                CASE WHEN sl_no ~ '^[0-9]+$' THEN CAST(sl_no AS INTEGER) ELSE 99999 END, 
                sl_no ASC, 
                id ASC
        `, [id]);

        const rows = itemsRes.rows;

        // Columns header matching specification exactly
        const headers = [
            'Sl No', 'VEPL Part No', 'Description', 'Manufacturer', 'Mfr. Part No', 
            'Qty / Product', 'Required Qty', 'Issued Qty', 'MSL', 'Packing Condition', 
            'Open Date & Time', 'Closed Date & Time', 'Package Body Thickness (mm)', 
            'Thickness Category', 'Bake Method', 'Bake Time', 'Exposure Time', 
            'Pending Floor Time', 'Status'
        ];

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('MSD BOM Worksheet');

        // Freeze top header row
        worksheet.views = [
            { state: 'frozen', ySplit: 1 }
        ];

        // Add header row
        const headerRow = worksheet.addRow(headers);
        headerRow.height = 40;

        // Header Styling
        headerRow.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '0F172A' } // Dark Slate background
            };
            cell.font = {
                name: 'Segoe UI',
                size: 10,
                bold: true,
                color: { argb: 'FFFFFF' }
            };
            cell.alignment = {
                vertical: 'middle',
                horizontal: 'center',
                wrapText: true
            };
            cell.border = {
                top: { style: 'thin', color: { argb: 'CBD5E1' } },
                left: { style: 'thin', color: { argb: 'CBD5E1' } },
                bottom: { style: 'medium', color: { argb: '0F172A' } },
                right: { style: 'thin', color: { argb: 'CBD5E1' } }
            };
        });

        const now = Date.now();

        // Populate data
        for (const item of rows) {
            let openDateStr = '';
            let closedDateStr = '';
            let thicknessStr = '';
            let bakeTimeStr = '';
            let exposureTimeStr = '';
            let pendingFloorTimeStr = '';
            let statusStr = 'Pending';
            let warnStyle: any = null;

            if (item.packing_condition === 'Sealed') {
                openDateStr = formatDateStr(item.open_date);
                closedDateStr = formatDateStr(item.closed_date);
                thicknessStr = item.package_thickness !== null ? String(item.package_thickness) : '';

                if (item.open_date) {
                    const start = new Date(item.open_date).getTime();
                    const end = item.closed_date ? new Date(item.closed_date).getTime() : now;
                    const diffMs = end - start;
                    const diffHrs = diffMs / 3600000;
                    
                    exposureTimeStr = formatDuration(diffMs);
                    const totalFloorLifeMs = (item.floor_life_hours || 168) * 3600000;
                    const remainingMs = totalFloorLifeMs - diffMs;
                    const remainingHrs = remainingMs / 3600000;

                    if (remainingHrs <= 0) {
                        pendingFloorTimeStr = 'Expired';
                        statusStr = 'Expired';
                        warnStyle = {
                            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EF4444' } }, // Bright Red
                            font: { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFF' } }
                        };
                    } else {
                        pendingFloorTimeStr = formatDuration(remainingMs);
                        if (item.open_date !== null && item.closed_date !== null && item.package_thickness !== null) {
                            statusStr = 'OK';
                        } else {
                            statusStr = 'Pending';
                        }

                        if (remainingHrs < 1) {
                            warnStyle = {
                                fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '7F1D1D' } }, // Dark Red
                                font: { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFF' } }
                            };
                        } else if (remainingHrs >= 1 && remainingHrs < 5) {
                            warnStyle = {
                                fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FCA5A5' } }, // Red
                                font: { name: 'Segoe UI', size: 10, bold: true, color: { argb: '991B1B' } }
                            };
                        } else if (remainingHrs >= 5 && remainingHrs < 10) {
                            warnStyle = {
                                fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FED7AA' } }, // Orange
                                font: { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'C2410C' } }
                            };
                        } else if (remainingHrs >= 10 && remainingHrs <= 24) {
                            warnStyle = {
                                fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF08A' } }, // Yellow
                                font: { name: 'Segoe UI', size: 10, bold: true, color: { argb: '854D0E' } }
                            };
                        }
                    }
                } else {
                    statusStr = 'Pending';
                }
            } else if (item.packing_condition === 'Open') {
                thicknessStr = item.package_thickness !== null ? String(item.package_thickness) : '';
                bakeTimeStr = item.bake_time !== null ? String(item.bake_time) : '';
                
                if (item.package_thickness !== null && item.bake_method) {
                    statusStr = 'OK';
                } else {
                    statusStr = 'Pending';
                }
            } else {
                statusStr = 'Pending';
            }

            const rowData = [
                item.sl_no || '',
                item.vepl_part_no || '',
                item.description || '',
                item.manufacturer || '',
                item.mfr_part_no || '',
                item.qty_per_product !== null ? Number(item.qty_per_product) : '',
                item.required_qty !== null ? Number(item.required_qty) : '',
                item.issued_qty !== null ? Number(item.issued_qty) : '',
                item.msl_normalized || '',
                item.packing_condition || '',
                openDateStr,
                closedDateStr,
                thicknessStr !== '' ? Number(thicknessStr) : '',
                item.thickness_category || '',
                item.bake_method || '',
                bakeTimeStr !== '' ? Number(bakeTimeStr) : '',
                exposureTimeStr,
                pendingFloorTimeStr,
                statusStr
            ];

            const row = worksheet.addRow(rowData);
            // Height will be dynamically computed at the end based on wrapping

            // Apply standard cell styles
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.font = { name: 'Segoe UI', size: 10, color: { argb: '334155' } };
                cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'E2E8F0' } },
                    left: { style: 'thin', color: { argb: 'E2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                    right: { style: 'thin', color: { argb: 'E2E8F0' } }
                };

                // Alignment overrides by column type
                if ([1, 9, 10].includes(colNumber)) {
                    // Sl No, MSL, Packing Condition
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if ([6, 7, 8, 13, 16].includes(colNumber)) {
                    // Numeric columns
                    cell.alignment = { vertical: 'middle', horizontal: 'right' };
                    // Format numbers
                    cell.numFmt = '0.00';
                    if (colNumber === 13) cell.numFmt = '0.00"mm"';
                    if (colNumber === 16) cell.numFmt = '0" hrs"';
                } else if ([11, 12].includes(colNumber)) {
                    // Date columns
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if ([17, 18, 19].includes(colNumber)) {
                    // Timer columns and status
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }

                // Apply warning color to Pending Floor Time (Column 18)
                if (colNumber === 18 && warnStyle) {
                    cell.fill = warnStyle.fill;
                    cell.font = warnStyle.font;
                }

                // Apply status badge color to Status (Column 19)
                if (colNumber === 19) {
                    if (statusStr === 'OK') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } }; // Light green
                        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: '15803D' } };
                    } else if (statusStr === 'Expired') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } }; // Light red
                        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'B91C1C' } };
                    } else if (statusStr === 'Pending') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF9C3' } }; // Light yellow
                        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: '854D0E' } };
                    }
                }
            });
        }

        // Enable Autofilters across columns
        worksheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: headers.length }
        };

        // Define column configuration (1-based index)
        const colConfigs: Record<number, { minWidth: number, maxWidth: number }> = {
            1: { minWidth: 8, maxWidth: 12 },    // Sl No
            2: { minWidth: 18, maxWidth: 30 },   // VEPL Part No
            3: { minWidth: 35, maxWidth: 60 },   // Description
            4: { minWidth: 18, maxWidth: 35 },   // Manufacturer
            5: { minWidth: 24, maxWidth: 45 },   // Mfr. Part No
            6: { minWidth: 14, maxWidth: 20 },   // Qty / Product
            7: { minWidth: 14, maxWidth: 20 },   // Required Qty
            8: { minWidth: 14, maxWidth: 20 },   // Issued Qty
            9: { minWidth: 10, maxWidth: 15 },   // MSL
            10: { minWidth: 16, maxWidth: 25 },  // Packing Condition
            11: { minWidth: 20, maxWidth: 30 },  // Open Date & Time
            12: { minWidth: 20, maxWidth: 30 },  // Closed Date & Time
            13: { minWidth: 25, maxWidth: 35 },  // Package Body Thickness (mm)
            14: { minWidth: 18, maxWidth: 25 },  // Thickness Category
            15: { minWidth: 22, maxWidth: 35 },  // Bake Method
            16: { minWidth: 15, maxWidth: 25 },  // Bake Time
            17: { minWidth: 15, maxWidth: 25 },  // Exposure Time
            18: { minWidth: 18, maxWidth: 28 },  // Pending Floor Time
            19: { minWidth: 14, maxWidth: 20 }   // Status
        };

        // Auto-fit column widths
        worksheet.columns.forEach((column, colIdx) => {
            const colNum = colIdx + 1;
            const config = colConfigs[colNum] || { minWidth: 12, maxWidth: 40 };
            let maxLen = config.minWidth;

            if (column && typeof column.eachCell === 'function') {
                column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
                    const valStr = cell.value ? String(cell.value) : '';
                    if (rowNumber === 1) {
                        const words = valStr.split(' ');
                        let longestWord = 0;
                        words.forEach(w => {
                            if (w.length > longestWord) longestWord = w.length;
                        });
                        const halfLen = Math.ceil(valStr.length / 2);
                        const headerEst = Math.max(longestWord + 2, halfLen);
                        if (headerEst > maxLen) {
                            maxLen = headerEst;
                        }
                    } else {
                        const paragraphs = valStr.split('\n');
                        paragraphs.forEach(p => {
                            if (p.length > maxLen) {
                                maxLen = p.length;
                            }
                        });
                    }
                });
            }
            column.width = Math.min(Math.max(maxLen + 4, config.minWidth), config.maxWidth);
        });

        // Automatically calculate row height based on cell content wrapping
        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header row
            let maxLines = 1;
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const valStr = cell.value ? String(cell.value) : '';
                const colWidth = worksheet.getColumn(colNumber).width || 12;
                
                let cellLines = 0;
                valStr.split('\n').forEach(paragraph => {
                    const divisor = Math.max(8, colWidth - 3);
                    cellLines += Math.max(1, Math.ceil(paragraph.length / divisor));
                });
                if (cellLines > maxLines) {
                    maxLines = cellLines;
                }
            });
            row.height = Math.max(20, maxLines * 15 + 8);
        });

        const buffer = await workbook.xlsx.writeBuffer();

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="MSD_Report_${master.work_order_number}.xlsx"`);
        res.send(buffer);

    } catch (err: any) {
        logger.error(`Error exporting MSD to Excel: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * PATCH /api/smt/msd-tracker/:id/status
 */
export const updateMsdStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const userName = (req as any).user?.name || req.body.userName || 'System';

    if (!status || !['ACTIVE', 'CLOSED'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Invalid status value.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const currentRes = await client.query('SELECT status, work_order_number FROM msd_master WHERE id = $1', [id]);
        if (currentRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'MSD record not found.' });
        }
        
        const oldStatus = currentRes.rows[0].status;
        if (oldStatus === status) {
            return res.status(200).json({ success: true, message: 'Status is already set to ' + status });
        }

        await client.query('UPDATE msd_master SET status = $1, updated_at = CURRENT_TIMESTAMP, updated_by = $2 WHERE id = $3', [status, userName, id]);

        // Audit Log
        const browser = req.headers['user-agent'] || 'Unknown';
        const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'Unknown';
        const insertAuditQuery = `
            INSERT INTO msd_audit_logs (msd_id, action, performed_by, browser, ip_address, details)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await client.query(insertAuditQuery, [
            id,
            'Status Updated',
            userName,
            browser,
            ipAddress,
            `Updated MSD Tracker status for Work Order ${currentRes.rows[0].work_order_number} from ${oldStatus} to ${status}.`
        ]);

        await client.query('COMMIT');
        res.status(200).json({ success: true, status });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error updating MSD master status: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
};

