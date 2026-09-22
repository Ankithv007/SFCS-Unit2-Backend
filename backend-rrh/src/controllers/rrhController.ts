import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import pool from '../config/db';
import { getUploadsDir } from '../utils/uploads';
import { createLogger } from '../utils/logger';
import { AuthRequest } from '../middleware/authMiddleware';

const logger = createLogger('RRH-WorkOrder');

/**
 * Helper to validate Excel file extension and buffer
 */
const validateExcelBuffer = (file: Express.Multer.File) => {
    if (!file.buffer || file.buffer.length === 0) {
        throw new Error('Uploaded Excel file is empty.');
    }
};

/**
 * Helper to parse workbook buffer into structured columns and rows,
 * supporting single-row headers, multi-row headers, and merged header cells.
 */
const parseWorkbookData = (buffer: Buffer) => {
    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
        throw new Error('Failed to parse Excel file. The file may be corrupted or password-protected.');
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('Excel workbook contains no sheets.');
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) {
        throw new Error('First worksheet in the Excel workbook is empty.');
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const merges = sheet['!merges'] || [];

    // Helper to check if a row contains any non-empty text
    const rowHasText = (r: number) => {
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c })];
            if (cell && cell.v !== undefined && String(cell.v).trim().length > 0) return true;
        }
        return false;
    };

    let startRow = range.s.r;
    while (startRow <= range.e.r && !rowHasText(startRow)) startRow++;
    if (startRow > range.e.r) throw new Error('Excel sheet contains no data.');

    // Determine if row startRow + 1 is part of a multi-row header
    let endHeaderRow = startRow;
    const hasVerticalMerge = merges.some(m => m.s.r <= startRow && m.e.r >= startRow + 1);
    const hasHorizontalMerge = merges.some(m => m.s.r === startRow && m.e.c > m.s.c);
    const nextRowHasText = startRow + 1 <= range.e.r && rowHasText(startRow + 1);

    if ((hasVerticalMerge || hasHorizontalMerge) && nextRowHasText) {
        const maxMergeRow = merges
            .filter(m => m.s.r <= startRow && m.e.r > startRow)
            .reduce((max, m) => Math.max(max, m.e.r), startRow);
        endHeaderRow = Math.max(startRow + 1, maxMergeRow);
    }

    // Build header grid
    const headerGrid: string[][] = [];
    for (let r = startRow; r <= endHeaderRow; r++) {
        const row: string[] = [];
        for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = sheet[XLSX.utils.encode_cell({ r, c })];
            row.push(cell && cell.v !== undefined ? String(cell.v).replace(/[\s\u00a0]+/g, ' ').trim() : '');
        }
        headerGrid.push(row);
    }

    // Propagate merged cells across the header grid
    for (const m of merges) {
        if (m.s.r <= endHeaderRow && m.e.r >= startRow) {
            const topCell = sheet[XLSX.utils.encode_cell(m.s)];
            const val = topCell && topCell.v !== undefined ? String(topCell.v).replace(/[\s\u00a0]+/g, ' ').trim() : '';
            if (val) {
                for (let r = Math.max(m.s.r, startRow); r <= Math.min(m.e.r, endHeaderRow); r++) {
                    for (let c = Math.max(m.s.c, range.s.c); c <= Math.min(m.e.c, range.e.c); c++) {
                        headerGrid[r - startRow][c - range.s.c] = val;
                    }
                }
            }
        }
    }

    // Combine headers across rows
    const numCols = range.e.c - range.s.c + 1;
    const rawHeaders: string[] = [];
    const isMultiRow = endHeaderRow > startRow;

    for (let c = 0; c < numCols; c++) {
        let colName = '';
        if (isMultiRow) {
            const parts: string[] = [];
            for (let r = 0; r < headerGrid.length; r++) {
                const cellVal = headerGrid[r][c];
                if (cellVal && (!parts.length || parts[parts.length - 1] !== cellVal)) {
                    parts.push(cellVal);
                }
            }
            if (parts.length > 1) {
                colName = parts.join(' - ');
            } else if (parts.length === 1) {
                colName = parts[0];
            } else {
                colName = `Column_${c + 1}`;
            }
        } else {
            colName = headerGrid[0][c] || `Column_${c + 1}`;
        }
        colName = colName.replace(/[\s\u00a0]+/g, ' ').trim();
        rawHeaders.push(colName);
    }

    // Ensure unique headers
    const seenHeaders = new Map<string, number>();
    const uniqueHeaders = rawHeaders.map(h => {
        const count = seenHeaders.get(h) || 0;
        seenHeaders.set(h, count + 1);
        return count > 0 ? `${h}_${count + 1}` : h;
    });

    // Extract data rows
    const rawDataRows = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: '',
        range: endHeaderRow + 1
    }) as any[][];

    const dataRows = rawDataRows.filter(row => Array.isArray(row) && row.some(cell => cell !== undefined && cell !== null && String(cell).trim().length > 0));

    if (dataRows.length === 0) {
        throw new Error('Excel sheet contains column headers, but no data rows were found.');
    }

    // Map each data row to key-value pairs
    const rows = dataRows.map(row => {
        const rowObj: Record<string, any> = {};
        uniqueHeaders.forEach((col, idx) => {
            const val = row[idx];
            if (val === undefined || val === null) {
                rowObj[col] = '';
            } else if (val instanceof Date) {
                rowObj[col] = !isNaN(val.getTime()) ? val.toISOString().split('T')[0] : '';
            } else if (typeof val === 'string') {
                rowObj[col] = val.replace(/[\u00a0]/g, ' ').trim();
            } else {
                rowObj[col] = val;
            }
        });
        return rowObj;
    });

    return {
        headers: uniqueHeaders,
        rows,
        totalRows: rows.length,
        totalColumns: uniqueHeaders.length
    };
};

/**
 * POST /work-orders/parse-excel
 * Live preview of uploaded Excel file without saving to disk or DB.
 */
export const parseExcelPreview = async (req: AuthRequest, res: Response) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No Excel file provided.' });
        }

        validateExcelBuffer(req.file);
        const { headers, rows, totalRows, totalColumns } = parseWorkbookData(req.file.buffer);

        const previewRows = rows.slice(0, 10);

        return res.status(200).json({
            success: true,
            fileName: req.file.originalname,
            fileSize: req.file.size,
            totalRows,
            totalColumns,
            columns: headers,
            previewRows
        });
    } catch (err: any) {
        logger.error(`Excel preview parsing failed: ${err.message}`);
        return res.status(400).json({
            success: false,
            error: err.message || 'Failed to preview Excel file.'
        });
    }
};

/**
 * POST /work-orders
 * Permanently create an RRH Work Order.
 */
export const createRrhWorkOrder = async (req: AuthRequest, res: Response) => {
    try {
        const { work_order_id, work_order_date, lot_quantity } = req.body;

        const woId = typeof work_order_id === 'string' ? work_order_id.trim() : '';
        if (!woId) {
            return res.status(400).json({ success: false, error: 'Work Order ID is required.' });
        }

        const woDate = work_order_date ? String(work_order_date).trim() : new Date().toISOString().split('T')[0];
        const parsedLotQty = parseInt(String(lot_quantity), 10);
        if (isNaN(parsedLotQty) || parsedLotQty <= 0) {
            return res.status(400).json({ success: false, error: 'Lot Quantity must be a positive integer greater than zero.' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'An Excel file (.xlsx, .xls) is required to create an RRH Work Order.' });
        }

        validateExcelBuffer(req.file);

        const { headers, rows, totalRows } = parseWorkbookData(req.file.buffer);

        const sessionUser = req.user;
        const createdBy = (sessionUser?.name || sessionUser?.username || sessionUser?.email || sessionUser?.employee_code || 'System').toString().trim();

        const uploadsDir = getUploadsDir();
        const rrhDir = path.join(uploadsDir, 'RRH-Work-Orders');
        fs.mkdirSync(rrhDir, { recursive: true, mode: 0o755 });

        const safeOriginalName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniqueFileKey = `${Date.now()}_${safeOriginalName}`;
        const targetDiskPath = path.join(rrhDir, uniqueFileKey);
        const relativeStoredPath = `RRH-Work-Orders/${uniqueFileKey}`;

        fs.writeFileSync(targetDiskPath, req.file.buffer);

        const insertQuery = `
            INSERT INTO rrh_work_orders (
                work_order_id,
                work_order_date,
                lot_quantity,
                excel_filename,
                excel_file_path,
                excel_file_size,
                excel_columns,
                excel_data,
                total_excel_rows,
                created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id, work_order_id, work_order_date, lot_quantity, excel_filename, excel_file_size, total_excel_rows, created_by, created_at, updated_at
        `;

        const insertResult = await pool.query(insertQuery, [
            woId,
            woDate,
            parsedLotQty,
            req.file.originalname,
            relativeStoredPath,
            req.file.size,
            JSON.stringify(headers),
            JSON.stringify(rows),
            totalRows,
            createdBy
        ]);

        logger.info(`RRH Work Order created successfully: ${woId} by ${createdBy}`);

        return res.status(201).json({
            success: true,
            message: 'RRH Work Order created successfully',
            data: insertResult.rows[0]
        });
    } catch (err: any) {
        logger.error(`Error creating RRH Work Order: ${err.message}`);

        if (err.code === '23505') {
            const woId = typeof req.body.work_order_id === 'string' ? req.body.work_order_id.trim() : '';
            return res.status(409).json({
                success: false,
                error: `Work Order ID "${woId}" already exists in RRH.`
            });
        }

        return res.status(500).json({
            success: false,
            error: err.message || 'Failed to create RRH Work Order.'
        });
    }
};

/**
 * GET /work-orders
 * List RRH Work Orders with pagination, search by ID and date.
 */
export const getRrhWorkOrders = async (req: Request, res: Response) => {
    try {
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
        const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
        const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit), 10) || 15));
        const offset = (page - 1) * limit;

        const whereClauses: string[] = [];
        const params: any[] = [];

        if (search) {
            params.push(`%${search}%`);
            whereClauses.push(`work_order_id ILIKE $${params.length}`);
        }

        if (date) {
            params.push(date);
            whereClauses.push(`work_order_date = $${params.length}`);
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const countQuery = `SELECT COUNT(*)::int AS total FROM rrh_work_orders ${whereSql}`;
        const countResult = await pool.query(countQuery, params);
        const total = countResult.rows[0]?.total || 0;

        // Exclude heavy excel_data column from listing for performance
        const dataQuery = `
            SELECT 
                id, 
                work_order_id, 
                work_order_date, 
                lot_quantity, 
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

        const dataResult = await pool.query(dataQuery, [...params, limit, offset]);
        const totalPages = Math.ceil(total / limit) || 1;

        return res.status(200).json({
            success: true,
            data: dataResult.rows,
            total,
            page,
            limit,
            totalPages
        });
    } catch (err: any) {
        logger.error(`Error fetching RRH work orders: ${err.message}`);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch RRH work orders: ' + err.message
        });
    }
};

/**
 * GET /work-orders/:id
 * Retrieve specific RRH Work Order including full Excel data.
 */
export const getRrhWorkOrderById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT 
                id,
                work_order_id,
                work_order_date,
                lot_quantity,
                excel_filename,
                excel_file_size,
                excel_columns,
                excel_data,
                total_excel_rows,
                created_by,
                created_at,
                updated_at
            FROM rrh_work_orders
            WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'RRH Work Order not found.' });
        }

        return res.status(200).json({
            success: true,
            data: result.rows[0]
        });
    } catch (err: any) {
        logger.error(`Error fetching RRH work order ${req.params.id}: ${err.message}`);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch RRH work order: ' + err.message
        });
    }
};

/**
 * GET /work-orders/:id/download
 * Safely download original Excel workbook.
 */
export const downloadRrhExcel = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT excel_filename, excel_file_path FROM rrh_work_orders WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'RRH Work Order not found.' });
        }

        const { excel_filename, excel_file_path } = result.rows[0];
        if (!excel_file_path) {
            return res.status(404).json({ success: false, error: 'No Excel file associated with this Work Order.' });
        }

        const uploadsDir = getUploadsDir();
        const resolvedPath = path.resolve(uploadsDir, excel_file_path);

        if (!resolvedPath.startsWith(uploadsDir)) {
            logger.warn(`Potential path traversal attempt detected for file: ${excel_file_path}`);
            return res.status(403).json({ success: false, error: 'Access denied: Invalid file location.' });
        }

        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ success: false, error: 'File not found on server disk.' });
        }

        return res.download(resolvedPath, excel_filename || 'RRH_Work_Order.xlsx');
    } catch (err: any) {
        logger.error(`Error downloading RRH Excel for work order ${req.params.id}: ${err.message}`);
        return res.status(500).json({
            success: false,
            error: 'Failed to download RRH Excel file.'
        });
    }
};

/**
 * DELETE /work-orders/:id
 * Delete an RRH Work Order and unlink its uploaded file.
 */
export const deleteRrhWorkOrder = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'DELETE FROM rrh_work_orders WHERE id = $1 RETURNING work_order_id, excel_file_path',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'RRH Work Order not found.' });
        }

        const { work_order_id, excel_file_path } = result.rows[0];

        if (excel_file_path) {
            const uploadsDir = getUploadsDir();
            const resolvedPath = path.resolve(uploadsDir, excel_file_path);
            if (resolvedPath.startsWith(uploadsDir)) {
                fs.rmSync(resolvedPath, { force: true });
            }
        }

        logger.info(`RRH Work Order deleted: ${work_order_id} (ID: ${id})`);

        return res.status(200).json({
            success: true,
            message: `RRH Work Order ${work_order_id} deleted successfully.`
        });
    } catch (err: any) {
        logger.error(`Error deleting RRH work order ${req.params.id}: ${err.message}`);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete RRH work order.'
        });
    }
};
