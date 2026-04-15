import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';

// Create a new IQC Batch
export const createBatch = async (req: Request, res: Response) => {
    const { batch_number, created_by, quantity } = req.body;

    if (!batch_number || !created_by) {
        return res.status(400).json({ error: 'Batch Number and Created By are required' });
    }

    try {
        const newBatch = await pool.query(
            'INSERT INTO iqc_batches (batch_number, created_by, quantity) VALUES ($1, $2, $3) RETURNING *',
            [batch_number, created_by, quantity]
        );
        res.status(201).json(newBatch.rows[0]);
    } catch (error: any) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Batch number already exists' });
        }
        console.error('Error creating IQC batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all IQC Batches
export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT b.*, b.quantity as expected_quantity,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id) as received_quantity,
            (SELECT COUNT(*)::int 
             FROM warehouse_scans s 
             JOIN warehouse_batches wb ON s.batch_id = wb.id 
             WHERE wb.batch_number = b.batch_number) as warehouse_received_quantity,
            (SELECT wb.expected_quantity 
             FROM warehouse_batches wb 
             WHERE wb.batch_number = b.batch_number LIMIT 1) as warehouse_expected_quantity,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'ACCEPTED') as passed_count,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'REJECTED') as failed_count,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'REWORK') as rework_count,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'SCRAP') as scrap_count
            FROM iqc_batches b 
            ORDER BY b.created_at DESC
        `);
        console.log(`[DEBUG] Fetched ${result.rows.length} IQC batches`);
        res.json(result.rows);
    } catch (error: any) {
        console.error('Error fetching IQC batches:', error.message);
        if (error.stack) console.error(error.stack);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
};

// Scan Component
export const scanComponent = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by, status, remarks } = req.body;

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

        // Duplicate Guard (5-second throttle)
        const currentStatus = status || 'ACCEPTED';
        const mappedStatus = currentStatus === 'ACCEPTED' ? 'Passed' :
            currentStatus === 'REJECTED' ? 'Failed' :
                currentStatus === 'REWORK' ? 'Rework' :
                    currentStatus === 'SCRAP' ? 'Scrap' : 'In Progress';

        const dupCheck = await client.query(`
            SELECT 1 FROM barcode_stage_history 
            WHERE barcode = $1 AND stage_name = 'Pre-IQC' AND status = $2 
            AND created_at > NOW() - INTERVAL '5 seconds' LIMIT 1
        `, [barcode, mappedStatus]);

        if (dupCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Duplicate scan detected. Please wait 5 seconds.' });
        }

        // 1. Check Batch Info
        const batchInfo = await client.query('SELECT quantity, batch_number FROM iqc_batches WHERE id = $1', [batch_id]);
        if (batchInfo.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Batch not found' });
        }

        const { quantity: batch_limit, batch_number: current_iqc_batch_number } = batchInfo.rows[0];

        // 2. Validate Item exists in ANY Warehouse Scans
        const warehouseCheck = await client.query(
            `SELECT s.*, wb.batch_number as wh_batch_number 
             FROM warehouse_scans s
             JOIN warehouse_batches wb ON s.batch_id = wb.id
             WHERE s.barcode = $1
             ORDER BY s.scanned_at DESC LIMIT 1`,
            [barcode]
        );

        if (warehouseCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Item not found in Warehouse. Please scan in Warehouse first.' });
        }

        const warehouseItem = warehouseCheck.rows[0];

        // 3. Capacity Checks (Only for non-rejected scans)
        if (status !== 'REJECTED') {
            const warehouseCountResult = await client.query(
                `SELECT COUNT(*) as count FROM warehouse_scans s JOIN warehouse_batches wb ON s.batch_id = wb.id WHERE wb.batch_number = $1`,
                [current_iqc_batch_number]
            );
            const warehouseReceivedQty = parseInt(warehouseCountResult.rows[0].count);

            const iqcCountResult = await client.query(`SELECT COUNT(*) as count FROM iqc_components WHERE batch_id = $1`, [batch_id]);
            const iqcScannedQty = parseInt(iqcCountResult.rows[0].count);

            if (iqcScannedQty >= warehouseReceivedQty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: `Cannot scan more items than received from Warehouse (${warehouseReceivedQty}).` });
            }
        }

        // 4. History Check (Across all IQC batches)
        const historyCheck = await client.query(
            `SELECT c.*, b.batch_number 
             FROM iqc_components c
             JOIN iqc_batches b ON c.batch_id = b.id
             WHERE c.barcode = $1
             ORDER BY c.scanned_at DESC LIMIT 1`,
            [barcode]
        );

        const { force_move } = req.body;

        if (historyCheck.rows.length > 0) {
            const prev = historyCheck.rows[0];

            if (prev.batch_id === batch_id) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Duplicate scan! Component already scanned in this IQC batch.' });
            }

            if (prev.status === 'SCRAP') {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: `Component was scrapped in Batch ${prev.batch_number}.`, code: 'SCRAPPED_BLOCK' });
            }

            if (prev.status === 'REWORK' && prev.batch_id !== batch_id) {
                await client.query('ROLLBACK');
                return res.status(403).json({ error: `Component is marked for Rework in Batch ${prev.batch_number}.`, code: 'REWORK_LOCKED' });
            }

            // AUTOMATIC MOVE: If found in another batch, move it immediately
            const previousBatchInfo = `Batch Moved from Batch ${prev.batch_number}`;
            const updatedComponent = await client.query(
                `UPDATE iqc_components 
                 SET batch_id = $1, scanned_by = $2, status = $3, remarks = $4, previous_batch = $5, scanned_at = NOW()
                 WHERE id = $6 RETURNING *`,
                [batch_id, scanned_by, 'ACCEPTED', null, previousBatchInfo, prev.id]
            );

            // Audit Log
            await client.query(`
                INSERT INTO barcode_stage_history (barcode, stage_name, stage_order, status, operator, batch_id, source_system)
                VALUES ($1, 'Pre-IQC', 2, 'Passed', $2, $3, 'pretest')
            `, [barcode, scanned_by, batch_id]);

            await client.query('COMMIT');
            return res.status(200).json(updatedComponent.rows[0]);
        }

        // 5. Automatic Move from another Warehouse Batch (not yet in IQC)
        const previousBatchInfo = warehouseItem.wh_batch_number !== current_iqc_batch_number ? `Batch Moved from Batch ${warehouseItem.wh_batch_number}` : null;

        // New Scan
        const newScan = await client.query(
            'INSERT INTO iqc_components (batch_id, barcode, scanned_by, status, remarks, previous_batch) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [batch_id, barcode, scanned_by, status || 'ACCEPTED', remarks, previousBatchInfo]
        );

        // Audit Log
        await client.query(`
            INSERT INTO barcode_stage_history (barcode, stage_name, stage_order, status, operator, batch_id, source_system)
            VALUES ($1, 'Pre-IQC', 2, $2, $3, $4, 'pretest')
        `, [barcode, mappedStatus, scanned_by, batch_id]);

        await client.query('COMMIT');
        res.status(201).json(newScan.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error scanning component:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
};

// Get Components for a Batch
export const getBatchComponents = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    try {
        const components = await pool.query(
            'SELECT * FROM iqc_components WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        res.json(components.rows);
    } catch (error) {
        console.error('Error fetching batch components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Update Component Status (e.g., Mark as Failed)
export const updateComponentStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;

    if (!status) {
        return res.status(400).json({ error: 'Status is required' });
    }

    if ((status === 'REWORK' || status === 'SCRAP') && (!remarks || !remarks.trim())) {
        return res.status(400).json({ error: `Remarks are mandatory when marking as ${status}` });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Fetch component to get barcode and batch_id
        const compCheck = await client.query('SELECT barcode, batch_id FROM iqc_components WHERE id = $1', [id]);
        if (compCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Component not found' });
        }
        const { barcode, batch_id } = compCheck.rows[0];

        // Advisory Lock
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [barcode]);

        const result = await client.query(
            'UPDATE iqc_components SET status = $1, remarks = $2 WHERE id = $3 RETURNING *',
            [status, remarks, id]
        );

        // Real-time Sync: If status changed to anything other than ACCEPTED, remove from Impedance
        if (status !== 'ACCEPTED') {
            await client.query('DELETE FROM impedance_scans WHERE barcode = $1', [barcode]);
        }

        // Map status for audit
        const mappedStatus = status === 'ACCEPTED' ? 'Passed' :
            status === 'REJECTED' ? 'Failed' :
                status === 'REWORK' ? 'Rework' :
                    status === 'SCRAP' ? 'Scrap' : 'In Progress';

        // Log history
        await client.query(`
            INSERT INTO barcode_stage_history (barcode, stage_name, stage_order, status, operator, batch_id, remarks, source_system)
            VALUES ($1, 'Pre-IQC', 2, $2, 'System Update', $3, $4, 'pretest')
        `, [barcode, mappedStatus, batch_id, remarks]);

        await client.query('COMMIT');
        res.json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating component status:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
};

// Delete Batch (Cascade)
export const deleteBatch = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    const userRole = (req as any).user?.role?.toLowerCase();
    console.log('Delete IQC Batch Request - User Role (normalized):', userRole);

    if (userRole !== 'admin' && userRole !== 'super admin' && userRole !== 'manager') {
        return res.status(403).json({ error: `Only Admin, Super Admin, or Manager can delete this batch. Your role: ${(req as any).user?.role}` });
    }

    try {
        await pool.query('DELETE FROM iqc_components WHERE batch_id = $1', [batch_id]);
        await pool.query('DELETE FROM iqc_batches WHERE id = $1', [batch_id]);
        res.json({ message: 'Batch deleted successfully' });
    } catch (error) {
        console.error('Error deleting batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
// Download IQC Batch Report as CSV
export const downloadBatchReport = async (req: Request, res: Response) => {
    const { batch_id } = req.params;

    try {
        // 1. Get Batch Details with calculations
        const batchResult = await pool.query(`
            SELECT b.*, b.quantity as expected_quantity,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id) as received_quantity,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'ACCEPTED') as passed_count,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'REJECTED') as failed_count,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'REWORK') as rework_count,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'SCRAP') as scrap_count
            FROM iqc_batches b 
            WHERE b.id = $1
        `, [batch_id]);

        if (batchResult.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        const batch = batchResult.rows[0];

        // 2. Get All Components
        const componentsResult = await pool.query(
            'SELECT * FROM iqc_components WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        const components = componentsResult.rows;

        // 3. Generate Excel Content
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('IQC Report');

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

        const summaryHeaders = ['Batch Number', 'Created By', 'Date & Time', 'Expected Qty', 'Total Count', 'Passed', 'Failed', 'Rework', 'Scrap'];
        const summaryHeaderRow = worksheet.addRow(summaryHeaders);
        summaryHeaderRow.eachCell((cell) => { cell.style = headerStyle; });

        const summaryData = [
            batch.batch_number,
            batch.created_by,
            new Date(batch.created_at).toLocaleString(),
            batch.expected_quantity,
            batch.received_quantity,
            batch.passed_count,
            batch.failed_count,
            batch.rework_count,
            batch.scrap_count
        ];
        const summaryDataRow = worksheet.addRow(summaryData);
        summaryDataRow.eachCell((cell) => { cell.style = cellStyle; });

        worksheet.addRow([]); // Gap
        worksheet.addRow([]); // Gap

        // Section 2: Component Details
        worksheet.addRow(['COMPONENT DETAILS']).font = { bold: true, size: 14 };
        worksheet.addRow([]); // Gap

        const detailHeaders = ['Barcode', 'Scanned By', 'Date & Time', 'Status', 'Remarks', 'Previous Batch'];
        const detailHeaderRow = worksheet.addRow(detailHeaders);
        detailHeaderRow.eachCell((cell) => { cell.style = headerStyle; });

        components.forEach((comp: any) => {
            const row = worksheet.addRow([
                comp.barcode,
                comp.scanned_by,
                new Date(comp.scanned_at).toLocaleString(),
                comp.status,
                comp.remarks || '-',
                comp.previous_batch || '-'
            ]);

            row.eachCell((cell, colNumber) => {
                cell.style = { ...cellStyle };

                // Apply background color based on status
                if (comp.status === 'SCRAP') {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFEBEE' } // Light Red
                    };
                } else if (comp.status === 'REWORK') {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFF9C4' } // Light Yellow
                    };
                }

                // Color code status text
                if (colNumber === 4) {
                    if (comp.status === 'ACCEPTED') cell.font = { color: { argb: 'FF00B050' }, bold: true };
                    else if (comp.status === 'REWORK') cell.font = { color: { argb: 'FFFFAF33' }, bold: true };
                    else if (comp.status === 'SCRAP') cell.font = { color: { argb: 'FFFF0000' }, bold: true };
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
        const fileName = `IQC_Report_${cleanBatchNumber}_${formattedDateTime}.xlsx`;

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
        console.error('Error downloading IQC batch report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
// Search Component by Barcode (IQC + Warehouse History)
export const searchComponent = async (req: Request, res: Response) => {
    const { barcode } = req.query;

    if (!barcode) {
        return res.status(400).json({ error: 'Barcode is required' });
    }

    try {
        // 1. Search in IQC
        const iqcResult = await pool.query(`
            SELECT c.*, b.batch_number 
            FROM iqc_components c
            JOIN iqc_batches b ON c.batch_id = b.id
            WHERE c.barcode = $1
            ORDER BY c.scanned_at DESC
        `, [barcode]);

        // 2. Search in Warehouse
        const warehouseResult = await pool.query(`
            SELECT s.*, b.batch_number as warehouse_batch_number
            FROM warehouse_scans s
            JOIN warehouse_batches b ON s.batch_id = b.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at DESC
        `, [barcode]);

        if (iqcResult.rows.length === 0 && warehouseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Component not found in IQC or Warehouse' });
        }

        // Case A: Found in IQC
        if (iqcResult.rows.length > 0) {
            const iqcItem = iqcResult.rows[0];
            // Attach warehouse info if available
            if (warehouseResult.rows.length > 0) {
                iqcItem.warehouse_batch = warehouseResult.rows[0].warehouse_batch_number;
                iqcItem.warehouse_scanned_at = warehouseResult.rows[0].scanned_at;
            }
            return res.json([iqcItem]);
        }

        // Case B: Found ONLY in Warehouse (Not yet in IQC)
        if (warehouseResult.rows.length > 0) {
            const warehouseItem = warehouseResult.rows[0];
            return res.json([{
                barcode: warehouseItem.barcode,
                batch_number: 'Not in IQC',
                warehouse_batch: warehouseItem.warehouse_batch_number,
                status: 'In Warehouse',
                scanned_by: warehouseItem.scanned_by,
                scanned_at: warehouseItem.scanned_at,
                remarks: 'Pending IQC',
                previous_batch: warehouseItem.previous_batch
            }]);
        }

    } catch (error) {
        console.error('Error searching component:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
