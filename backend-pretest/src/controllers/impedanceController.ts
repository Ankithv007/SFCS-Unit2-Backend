import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';

// Get Completed IQC Batches (Available for Impedance)
// Get Completed IQC Batches (Available for Impedance)
export const getCompletedIQCBatches = async (req: Request, res: Response) => {
    try {
        console.log('Fetching Completed IQC Batches...');
        const result = await pool.query(`
            SELECT 
                b.*, 
                (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'ACCEPTED') as passed_count,
                (SELECT COUNT(*)::int FROM warehouse_scans s JOIN warehouse_batches wb ON s.batch_id = wb.id WHERE wb.batch_number = b.batch_number) as warehouse_received_quantity
            FROM iqc_batches b
            WHERE 
                -- Logic for Impedance Availability: Passed Count >= 5
                (SELECT COUNT(*) FROM iqc_components WHERE batch_id = b.id AND status = 'ACCEPTED') >= 1
                -- AND not already in Impedance
                AND b.id NOT IN (SELECT batch_id FROM impedance_sessions)
            ORDER BY b.created_at DESC
        `);
        console.log(`Found ${result.rows.length} available IQC batches for Impedance.`);
        if (result.rows.length === 0) {
            // Debug: Check if any batches exist at all in IQC with accepted items, ignoring the impedance_sessions check
            const debugCheck = await pool.query(`
                SELECT b.batch_number, b.id, 
                (SELECT COUNT(*) FROM iqc_components WHERE batch_id = b.id AND status = 'ACCEPTED') as passed,
                (SELECT COUNT(*) FROM impedance_sessions WHERE batch_id = b.id) as in_impedance
                FROM iqc_batches b
             `);
            console.log('DEBUG - All IQC Batches status:', debugCheck.rows);
        }
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching completed IQC batches:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Create a new Impedance Batch (Session)
export const createBatch = async (req: Request, res: Response) => {
    const { iqc_batch_id, created_by } = req.body;

    if (!iqc_batch_id || !created_by) {
        return res.status(400).json({ error: 'IQC Batch ID and Created By are required' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO impedance_sessions (batch_id, tested_by) VALUES ($1, $2) RETURNING *',
            [iqc_batch_id, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating impedance batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Scan PCB for Impedance
export const scanPcb = async (req: Request, res: Response) => {
    const { session_id, barcode, tested_by, test_pa1, test_pa2, test_pa4, test_pa5, test_r160, remarks } = req.body;

    if (!session_id || !barcode) {
        return res.status(400).json({ error: 'Session ID and Barcode are required' });
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

        // Duplicate Guard (5-second throttle)
        const isPass = (
            (test_pa1 !== false) &&
            (test_pa2 !== false) &&
            (test_pa4 !== false) &&
            (test_pa5 !== false) &&
            (test_r160 !== false)
        );
        const mappedStatus = isPass ? 'Passed' : 'Failed';

        const dupCheck = await client.query(`
            SELECT 1 FROM barcode_stage_history 
            WHERE barcode = $1 AND stage_name = 'Pre-Impedance' AND status = $2 
            AND created_at > NOW() - INTERVAL '5 seconds' LIMIT 1
        `, [barcode, mappedStatus]);

        if (dupCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Duplicate scan detected. Please wait 5 seconds.' });
        }

        // 1. Validate against IQC
        const iqcCheck = await client.query(
            "SELECT status, batch_id FROM iqc_components WHERE barcode = $1 ORDER BY scanned_at DESC LIMIT 1",
            [barcode]
        );

        if (iqcCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'PCB not found in IQC. Please complete IQC first.' });
        }

        const iqcComponent = iqcCheck.rows[0];
        if (iqcComponent.status !== 'ACCEPTED') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: `PCB status in IQC is ${iqcComponent.status}. Only ACCEPTED components can be processed.` });
        }

        // 2. Check for Duplicate in Current Session
        const duplicateCheck = await client.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 AND barcode = $2',
            [session_id, barcode]
        );

        if (duplicateCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Duplicate scan! PCB already scanned in this session.' });
        }

        // 3. Record Scan
        const initialStatus = isPass ? 'ACCEPTED' : 'FAILED';
        const newScan = await client.query(
            `INSERT INTO impedance_scans 
            (session_id, barcode, status, remarks, test_pa1, test_pa2, test_pa4, test_pa5, test_r160, tested_by) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                session_id, barcode, initialStatus, remarks,
                test_pa1 !== undefined ? test_pa1 : true,
                test_pa2 !== undefined ? test_pa2 : true,
                test_pa4 !== undefined ? test_pa4 : true,
                test_pa5 !== undefined ? test_pa5 : true,
                test_r160 !== undefined ? test_r160 : true,
                tested_by
            ]
        );

        // Audit Log
        await client.query(`
            INSERT INTO barcode_stage_history (barcode, stage_name, stage_order, status, operator, batch_id, remarks, source_system)
            VALUES ($1, 'Pre-Impedance', 3, $2, $3, $4, $5, 'pretest')
        `, [barcode, mappedStatus, tested_by || 'Unknown', iqcComponent.batch_id, remarks]);

        await client.query('COMMIT');
        res.status(201).json(newScan.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error scanning PCB:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
};

// Update Test Result for a Scan
export const updateScanTestResult = async (req: Request, res: Response) => {
    const { scan_id } = req.params;
    const { test_name, result } = req.body; // test_name: 'test_pa1', result: boolean

    const validTests = ['test_pa1', 'test_pa2', 'test_pa4', 'test_pa5', 'test_r160'];
    if (!validTests.includes(test_name)) {
        return res.status(400).json({ error: 'Invalid test name' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Fetch scan to get barcode
        const scanCheck = await client.query('SELECT barcode, session_id FROM impedance_scans WHERE id = $1', [scan_id]);
        if (scanCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Scan not found' });
        }
        const { barcode, session_id } = scanCheck.rows[0];

        // Advisory Lock
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [barcode]);

        // 1. Update the specific test result
        await client.query(
            `UPDATE impedance_scans SET ${test_name} = $1 WHERE id = $2`,
            [result, scan_id]
        );

        // 2. Recalculate Overall Status
        const updatedScanResult = await client.query(
            `UPDATE impedance_scans 
             SET status = CASE 
                WHEN test_pa1 AND test_pa2 AND test_pa4 AND test_pa5 AND test_r160 THEN 'ACCEPTED'
                ELSE 'FAILED'
             END
             WHERE id = $1 RETURNING *`,
            [scan_id]
        );

        const updatedScan = updatedScanResult.rows[0];
        const mappedStatus = updatedScan.status === 'ACCEPTED' ? 'Passed' : 'Failed';

        // Fetch IQC batch_id for the audit log
        const iqcCheck = await client.query('SELECT batch_id FROM impedance_sessions WHERE id = $1', [session_id]);
        const iqcBatchId = iqcCheck.rows.length > 0 ? iqcCheck.rows[0].batch_id : null;

        // Log history
        await client.query(`
            INSERT INTO barcode_stage_history (barcode, stage_name, stage_order, status, operator, batch_id, remarks, source_system)
            VALUES ($1, 'Pre-Impedance', 3, $2, 'System Update', $3, $4, 'pretest')
        `, [barcode, mappedStatus, iqcBatchId, `Updated ${test_name} to ${result}`]);

        await client.query('COMMIT');
        res.json(updatedScan);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating test result:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
};

// Get Recent Sessions
export const getSessions = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT s.*, 
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id) as scan_count,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'ACCEPTED') as passed_count,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'FAILED') as failed_count,
            b.batch_number,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'ACCEPTED') as iqc_passed_count,
            (SELECT COUNT(*)::int 
             FROM warehouse_scans ws 
             JOIN warehouse_batches wb ON ws.batch_id = wb.id 
             WHERE wb.batch_number = b.batch_number) as warehouse_received_quantity
            FROM impedance_sessions s
            LEFT JOIN iqc_batches b ON s.batch_id = b.id
            ORDER BY s.started_at DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get Scans for a Session
export const getSessionScans = async (req: Request, res: Response) => {
    const { session_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 ORDER BY scanned_at DESC',
            [session_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching session scans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Delete Impedance Batch (Session)
export const deleteBatch = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    const userRole = (req as any).user?.role?.toLowerCase();

    if (userRole !== 'admin' && userRole !== 'super admin' && userRole !== 'manager') {
        return res.status(403).json({ error: `Only Admin, Super Admin, or Manager can delete this batch. Your role: ${(req as any).user?.role}` });
    }

    try {
        // Delete scans first (cascade usually handles this but good to be explicit or if cascade not set)
        await pool.query('DELETE FROM impedance_scans WHERE session_id = $1', [batch_id]);
        // Delete session
        const result = await pool.query('DELETE FROM impedance_sessions WHERE id = $1 RETURNING *', [batch_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        res.json({ message: 'Batch deleted successfully' });
    } catch (error) {
        console.error('Error deleting impedance batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


// Download Impedance Batch Report as CSV
export const downloadBatchReport = async (req: Request, res: Response) => {
    const { batch_id } = req.params;

    try {
        // 1. Get Batch Details with calculations
        const batchResult = await pool.query(`
            SELECT s.*, b.batch_number, b.quantity as expected_quantity,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id) as total_scanned,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'ACCEPTED') as passed_count,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'FAILED') as failed_count
            FROM impedance_sessions s
            JOIN iqc_batches b ON s.batch_id = b.id
            WHERE s.id = $1
        `, [batch_id]);

        if (batchResult.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        const batch = batchResult.rows[0];

        // 2. Get All Scans
        const scansResult = await pool.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );

        const scans = scansResult.rows;

        // 3. Generate Excel Content
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Impedance Report');

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

        const summaryHeaders = ['Batch Number', 'Tested By', 'Date & Time', 'Expected Qty', 'Total Scanned', 'Passed', 'Failed'];
        const summaryHeaderRow = worksheet.addRow(summaryHeaders);
        summaryHeaderRow.eachCell((cell) => { cell.style = headerStyle; });

        const summaryData = [
            batch.batch_number,
            batch.tested_by,
            new Date(batch.started_at).toLocaleString(),
            batch.expected_quantity,
            batch.total_scanned,
            batch.passed_count,
            batch.failed_count
        ];
        const summaryDataRow = worksheet.addRow(summaryData);
        summaryDataRow.eachCell((cell) => { cell.style = cellStyle; });

        worksheet.addRow([]); // Gap
        worksheet.addRow([]); // Gap

        // Section 2: Scan Details
        worksheet.addRow(['SCAN DETAILS']).font = { bold: true, size: 14 };
        worksheet.addRow([]); // Gap

        const detailHeaders = ['Barcode', 'Scanned By', 'Status', 'Remarks', 'Scan Time', 'PA1', 'PA2', 'PA4', 'PA5', 'R160'];
        const detailHeaderRow = worksheet.addRow(detailHeaders);
        detailHeaderRow.eachCell((cell) => { cell.style = headerStyle; });

        scans.forEach((scan: any) => {
            const row = worksheet.addRow([
                scan.barcode,
                scan.tested_by || '-',
                scan.status === 'ACCEPTED' ? 'PASS' : 'FAIL',
                scan.remarks || '-',
                new Date(scan.scanned_at).toLocaleString(),
                scan.test_pa1 ? 'OK' : 'FAIL',
                scan.test_pa2 ? 'OK' : 'FAIL',
                scan.test_pa4 ? 'OK' : 'FAIL',
                scan.test_pa5 ? 'OK' : 'FAIL',
                scan.test_r160 ? 'OK' : 'FAIL'
            ]);

            const isFailed = scan.status !== 'ACCEPTED';

            row.eachCell((cell, colNumber) => {
                cell.style = { ...cellStyle }; // Clone to avoid mutation issues if any

                // Apply light red background if failed
                if (isFailed) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFEBEE' } // Light Red / Pinkish
                    };
                }

                // Color code status text
                if (colNumber === 3) {
                    if (scan.status === 'ACCEPTED') {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true }; // Green
                    } else {
                        cell.font = { color: { argb: 'FFFF0000' }, bold: true }; // Red
                    }
                }
            });
        });

        // Auto-fit column widths
        worksheet.columns.forEach((column, i) => {
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
        const fileName = `Impedance_Report_${cleanBatchNumber}_${formattedDateTime}.xlsx`;

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
        console.error('Error downloading Impedance batch report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Search Component by Barcode (Traceability: Warehouse -> IQC -> Impedance)
export const searchComponent = async (req: Request, res: Response) => {
    const { barcode } = req.query;

    if (!barcode) {
        return res.status(400).json({ error: 'Barcode is required' });
    }

    try {
        // 1. Search in Impedance
        const impedanceResult = await pool.query(`
            SELECT s.*, sess.batch_id as iqc_batch_id 
            FROM impedance_scans s
            JOIN impedance_sessions sess ON s.session_id = sess.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at DESC
        `, [barcode]);

        // 2. Search in IQC
        const iqcResult = await pool.query(`
            SELECT c.*, b.batch_number 
            FROM iqc_components c
            JOIN iqc_batches b ON c.batch_id = b.id
            WHERE c.barcode = $1
            ORDER BY c.scanned_at DESC
        `, [barcode]);

        // 3. Search in Warehouse
        const warehouseResult = await pool.query(`
            SELECT s.*, b.batch_number as warehouse_batch_number, 
            (SELECT COUNT(*) FROM warehouse_scans ws WHERE ws.batch_id = b.id) as received_quantity
            FROM warehouse_scans s
            JOIN warehouse_batches b ON s.batch_id = b.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at DESC
        `, [barcode]);

        if (impedanceResult.rows.length === 0 && iqcResult.rows.length === 0 && warehouseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Component not found in any stage' });
        }

        // Construct Traceability Object
        const result = {
            barcode: barcode,
            warehouse: warehouseResult.rows.length > 0 ? {
                status: 'Received',
                batch_number: warehouseResult.rows[0].warehouse_batch_number,
                received_quantity: warehouseResult.rows[0].received_quantity,
                scanned_at: warehouseResult.rows[0].scanned_at
            } : { status: 'Not Scanned' },

            iqc: iqcResult.rows.length > 0 ? {
                status: iqcResult.rows[0].status,
                batch_number: iqcResult.rows[0].batch_number,
                batch_id: iqcResult.rows[0].batch_id,
                scanned_at: iqcResult.rows[0].scanned_at
            } : { status: 'Pending' },

            impedance: impedanceResult.rows.length > 0 ? {
                status: impedanceResult.rows[0].status === 'ACCEPTED' ? 'Passed' : 'Failed',
                scanned_at: impedanceResult.rows[0].scanned_at
            } : { status: 'Pending' }
        };

        // Apply Status Rules
        // If IQC Failed -> Impedance must show Failed (even if not scanned or previously passed)
        if (result.iqc.status === 'REJECTED') {
            result.impedance.status = 'Failed (IQC Rejected)';
        }

        res.json(result);

    } catch (error) {
        console.error('Error searching component:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Delete a single scan
export const deleteScan = async (req: Request, res: Response) => {
    const { scan_id } = req.params;
    const userRole = (req as any).user?.role;
    const lowerRole = userRole?.toLowerCase();
    
    if (lowerRole !== 'admin' && lowerRole !== 'super admin') {
        return res.status(403).json({ error: `Only Admin or Super Admin can delete this scan.` });
    }

    try {
        const scanRes = await pool.query('SELECT barcode, session_id FROM impedance_scans WHERE id = $1', [scan_id]);
        if (scanRes.rows.length === 0) {
            return res.status(404).json({ error: 'Scan not found' });
        }
        const { barcode, session_id } = scanRes.rows[0];

        const sessionRes = await pool.query('SELECT batch_id FROM impedance_sessions WHERE id = $1', [session_id]);
        const batch_id = sessionRes.rows.length > 0 ? sessionRes.rows[0].batch_id : null;

        await pool.query('DELETE FROM impedance_scans WHERE id = $1', [scan_id]);
        
        if (batch_id) {
            await pool.query(
                "DELETE FROM barcode_stage_history WHERE barcode = $1 AND batch_id = $2 AND stage_name = 'Pre-Impedance'",
                [barcode, batch_id]
            );
        }

        res.json({ message: 'Scan deleted successfully' });
    } catch (error) {
        console.error('Error deleting impedance scan:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
