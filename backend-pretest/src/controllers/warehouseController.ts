import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';

// Create a new Warehouse Batch
export const createBatch = async (req: Request, res: Response) => {
    const { batch_number, created_by, expected_quantity } = req.body;

    if (!batch_number || !created_by || !expected_quantity) {
        return res.status(400).json({ error: 'Batch Number, Created By, and Expected Quantity are required' });
    }

    // Validate Batch Number Format: PREVEYYYYMMDD-XXXXX
    // Regex: Starts with PREVE, followed by 8 digits (YYYYMMDD), a hyphen, and 1-5 digits.
    const batchRegex = /^PREVE\d{8}-\d{1,5}$/;
    if (!batchRegex.test(batch_number)) {
        return res.status(400).json({ error: 'Invalid Batch Number Format. Expected: PREVEYYYYMMDD-XXXXX' });
    }

    try {
        const newBatch = await pool.query(
            'INSERT INTO warehouse_batches (batch_number, created_by, expected_quantity) VALUES ($1, $2, $3) RETURNING *',
            [batch_number, created_by, expected_quantity]
        );
        res.status(201).json(newBatch.rows[0]);
    } catch (error: any) {
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Batch number already exists' });
        }
        console.error('Error creating warehouse batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all Warehouse Batches with calculations
export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*,
                COALESCE(s.scan_count, 0)::int as received_quantity,
                GREATEST(0, COALESCE(s.scan_count, 0) - b.expected_quantity)::int as extra_quantity,
                GREATEST(0, b.expected_quantity - COALESCE(s.scan_count, 0))::int as shortage_quantity
            FROM warehouse_batches b
            LEFT JOIN (
                SELECT batch_id, COUNT(*) as scan_count 
                FROM warehouse_scans 
                GROUP BY batch_id
            ) s ON b.id = s.batch_id
            ORDER BY b.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching warehouse batches:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Scan item into Warehouse Batch
export const scanItem = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by } = req.body;

    if (!batch_id || !barcode || !scanned_by) {
        return res.status(400).json({ error: 'Batch ID, Barcode, and Scanned By are required' });
    }

    // Barcode Validation
    const BARCODE_REGEX = /^[A-Z]{2}-[A-Z0-9]{4}-[A-Z0-9]{2}-[A-Z0-9]{4}$/;
    if (!BARCODE_REGEX.test(barcode.toUpperCase())) {
        return res.status(400).json({ error: 'Invalid Barcode format. Must be 15 characters (e.g. AO-4734-34-2344)' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Advisory Lock (Collision-resistant)
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [barcode]);

        const dupCheck = await client.query(`
            SELECT 1 FROM barcode_stage_history 
            WHERE barcode = $1 AND stage_name = 'Warehouse' AND status = 'Passed' 
            AND created_at > NOW() - INTERVAL '5 seconds' LIMIT 1
        `, [barcode]);

        if (dupCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Duplicate scan detected. Please wait 5 seconds.' });
        }

        // Check if batch exists
        const batchCheck = await client.query('SELECT * FROM warehouse_batches WHERE id = $1', [batch_id]);
        if (batchCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Batch not found' });
        }

        // Check for duplicate scan in the same batch
        const duplicateCheck = await client.query(
            'SELECT * FROM warehouse_scans WHERE batch_id = $1 AND barcode = $2',
            [batch_id, barcode]
        );

        if (duplicateCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Duplicate scan! Item already scanned in this batch.' });
        }

        // Check for previous history in OTHER batches
        const historyCheck = await client.query(
            `SELECT s.*, b.batch_number 
             FROM warehouse_scans s
             JOIN warehouse_batches b ON s.batch_id = b.id
             WHERE s.barcode = $1 AND s.batch_id != $2
             ORDER BY s.scanned_at DESC LIMIT 1`,
            [barcode, batch_id]
        );

        let previousBatchInfo = null;
        if (historyCheck.rows.length > 0) {
            const prev = historyCheck.rows[0];
            previousBatchInfo = `Batch ${prev.batch_number}`;
        }

        // Record scan
        const newScan = await client.query(
            'INSERT INTO warehouse_scans (batch_id, barcode, scanned_by, previous_batch) VALUES ($1, $2, $3, $4) RETURNING *',
            [batch_id, barcode, scanned_by, previousBatchInfo]
        );

        // Log history
        await client.query(`
            INSERT INTO barcode_stage_history (barcode, stage_name, stage_order, status, operator, batch_id, source_system)
            VALUES ($1, 'Warehouse', 1, 'Passed', $2, $3, 'pretest')
        `, [barcode, scanned_by, batch_id]);

        await client.query('COMMIT');
        res.status(201).json(newScan.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error scanning warehouse item:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
};

// Get scans for a specific batch
export const getBatchScans = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    try {
        const scans = await pool.query(
            'SELECT * FROM warehouse_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        res.json(scans.rows);
    } catch (error) {
        console.error('Error fetching warehouse scans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Delete Warehouse Batch and associated scans
export const deleteBatch = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    const userRole = (req as any).user?.role;
    console.log('Delete Batch Request - User Role:', userRole);

    if (userRole !== 'Admin' && userRole !== 'Super Admin' && userRole !== 'Manager') {
        return res.status(403).json({ error: `Only Admin, Super Admin, or Manager can delete this batch. Your role: ${userRole}` });
    }

    try {
        // 1. Delete Warehouse Scans
        await pool.query('DELETE FROM warehouse_scans WHERE batch_id = $1', [batch_id]);

        // 2. Delete Warehouse Batch
        const result = await pool.query('DELETE FROM warehouse_batches WHERE id = $1 RETURNING *', [batch_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        res.json({ message: 'Warehouse batch deleted successfully' });
    } catch (error) {
        console.error('Error deleting warehouse batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Download Batch Report as CSV (Excel-friendly)
export const downloadBatchReport = async (req: Request, res: Response) => {
    const { batch_id } = req.params;

    try {
        // 1. Get Batch Details with calculations
        const batchResult = await pool.query(`
            SELECT 
                b.*,
                COALESCE(s.scan_count, 0)::int as received_quantity,
                GREATEST(0, COALESCE(s.scan_count, 0) - b.expected_quantity)::int as extra_quantity,
                GREATEST(0, b.expected_quantity - COALESCE(s.scan_count, 0))::int as shortage_quantity
            FROM warehouse_batches b
            LEFT JOIN (
                SELECT batch_id, COUNT(*) as scan_count 
                FROM warehouse_scans 
                GROUP BY batch_id
            ) s ON b.id = s.batch_id
            WHERE b.id = $1
        `, [batch_id]);

        if (batchResult.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        const batch = batchResult.rows[0];

        // 2. Get All Scans
        const scansResult = await pool.query(
            'SELECT * FROM warehouse_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        const scans = scansResult.rows;

        // 3. Generate Excel Content
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Warehouse Report');

        // Styles
        const headerStyle: Partial<ExcelJS.Style> = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } },
            alignment: { horizontal: 'center', vertical: 'middle' },
            border: {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            }
        };

        const cellStyle: Partial<ExcelJS.Style> = {
            alignment: { vertical: 'middle', wrapText: true },
            border: {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            }
        };

        // Section 1: Batch Summary
        worksheet.addRow(['BATCH SUMMARY']).font = { bold: true, size: 14 };
        worksheet.addRow([]); // Gap

        const summaryHeaders = ['Batch Number', 'Created By', 'Date & Time', 'Expected Qty', 'Extra Qty', 'Shortage Qty', 'Total Count'];
        const summaryHeaderRow = worksheet.addRow(summaryHeaders);
        summaryHeaderRow.eachCell((cell) => { cell.style = headerStyle; });

        const summaryData = [
            batch.batch_number,
            batch.created_by,
            new Date(batch.created_at).toLocaleString(),
            batch.expected_quantity,
            batch.extra_quantity,
            batch.shortage_quantity,
            batch.received_quantity
        ];
        const summaryDataRow = worksheet.addRow(summaryData);
        summaryDataRow.eachCell((cell) => { cell.style = cellStyle; });

        worksheet.addRow([]); // Gap
        worksheet.addRow([]); // Gap

        // Section 2: Scan Details
        worksheet.addRow(['SCAN DETAILS']).font = { bold: true, size: 14 };
        worksheet.addRow([]); // Gap

        const detailHeaders = ['Barcode', 'Scanned By', 'Date & Time', 'Previous Batch', 'Status'];
        const detailHeaderRow = worksheet.addRow(detailHeaders);
        detailHeaderRow.eachCell((cell) => { cell.style = headerStyle; });

        scans.forEach((scan: any) => {
            const row = worksheet.addRow([
                scan.barcode,
                scan.scanned_by,
                new Date(scan.scanned_at).toLocaleString(),
                scan.previous_batch || '-',
                scan.status
            ]);
            row.eachCell((cell) => {
                cell.style = { ...cellStyle };

                // Color code if ever not ACCEPTED
                if (scan.status !== 'ACCEPTED') {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFEBEE' } // Light Red
                    };
                }
            });
        });

        // Auto-fit column widths
        worksheet.columns.forEach((column) => {
            let maxColumnLength = 0;
            column.eachCell!({ includeEmpty: true }, (cell) => {
                const columnLength = cell.value ? cell.value.toString().length : 0;
                if (columnLength > maxColumnLength) {
                    maxColumnLength = columnLength;
                }
            });
            column.width = maxColumnLength < 12 ? 12 : maxColumnLength + 5;
        });

        // 4. Generate Filename (Requested Format)
        const now = new Date();
        const formattedDateTime = now.toISOString().slice(0, 19).replace(/:/g, '-');
        const cleanBatchNumber = batch.batch_number.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `Warehouse_Report_${cleanBatchNumber}_${formattedDateTime}.xlsx`;

        // 5. Send Response
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.setHeader('X-Suggested-Filename', fileName);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error downloading batch report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
// Search for an item to find its batch
export const searchItem = async (req: Request, res: Response) => {
    const { barcode } = req.query;

    if (!barcode) {
        return res.status(400).json({ error: 'Barcode is required' });
    }

    try {
        const result = await pool.query(`
            SELECT s.*, b.batch_number, b.created_at as batch_created_at
            FROM warehouse_scans s
            JOIN warehouse_batches b ON s.batch_id = b.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at DESC
        `, [barcode]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Item not found in any batch' });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error searching item:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
