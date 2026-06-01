import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('ExportController');

export const downloadBatchReport = async (req: Request, res: Response) => {
    const batchId = parseInt(req.query.batchId as string);
    const stageCode = (req.query.stageCode as string || '').toUpperCase();

    if (!batchId || !stageCode) {
        return res.status(400).json({ error: 'batchId and stageCode are required parameters.' });
    }

    try {
        // 1. Fetch stage info
        const stageRes = await pool.query(
            'SELECT id, stage_name FROM production_stages WHERE stage_code = $1',
            [stageCode]
        );
        if (stageRes.rows.length === 0) {
            return res.status(404).json({ error: `Stage with code "${stageCode}" not found.` });
        }
        const stageId = stageRes.rows[0].id;
        const stageName = stageRes.rows[0].stage_name;

        // 2. Fetch Batch/WorkOrder metadata
        const batchRes = await pool.query(
            `SELECT b.batch_number, b.created_at, w.wo_number, w.customer_name, w.model, w.quantity
             FROM batches b
             JOIN work_orders w ON b.work_order_id = w.id
             WHERE b.id = $1`,
            [batchId]
        );
        if (batchRes.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found.' });
        }
        const batch = batchRes.rows[0];

        // 3. Fetch all barcodes/units belonging to this batch with scan and repair details
        const unitsQuery = `
            SELECT DISTINCT ON (u.barcode)
                u.barcode,
                COALESCE(s.scanned_by, '-') AS scanned_by,
                s.scanned_at AS scan_date_time,
                s.scan_result AS status,
                COALESCE(s.remarks, u.failure_remark, '-') AS failure_remark,
                
                (
                    SELECT r.scanned_at 
                    FROM scans r 
                    WHERE r.barcode = u.barcode 
                      AND r.stage_id IN (10, 11) 
                      AND (
                          SELECT sf.stage_id 
                          FROM scans sf 
                          WHERE sf.barcode = r.barcode 
                            AND sf.scan_result IN ('REWORK', 'DEBUG') 
                            AND sf.scanned_at < r.scanned_at 
                          ORDER BY sf.scanned_at DESC LIMIT 1
                      ) = $2
                    ORDER BY r.scanned_at DESC LIMIT 1
                ) AS repair_time,
                
                (
                    SELECT r.remarks 
                    FROM scans r 
                    WHERE r.barcode = u.barcode 
                      AND r.stage_id IN (10, 11) 
                      AND (
                          SELECT sf.stage_id 
                          FROM scans sf 
                          WHERE sf.barcode = r.barcode 
                            AND sf.scan_result IN ('REWORK', 'DEBUG') 
                            AND sf.scanned_at < r.scanned_at 
                          ORDER BY sf.scanned_at DESC LIMIT 1
                      ) = $2
                    ORDER BY r.scanned_at DESC LIMIT 1
                ) AS repair_remark
            FROM units u
            JOIN scans s ON u.barcode = s.barcode AND s.stage_id = $2
            WHERE u.batch_id = $1
            ORDER BY u.barcode ASC, s.scanned_at DESC
        `;

        const unitsRes = await pool.query(unitsQuery, [batchId, stageId]);
        const units = unitsRes.rows;

        // 4. Generate Excel Workbook
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(`${stageCode} Report`);

        // Common Styles
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

        // Write Metadata Card (Rows 1 to 6)
        const metadata = [
            { label: 'WO Number:', val: batch.wo_number },
            { label: 'Customer:', val: batch.customer_name },
            { label: 'Quantity:', val: batch.quantity },
            { label: 'Model:', val: batch.model },
            { label: 'Stage/Page Name:', val: stageName },
            { label: 'Downloaded Date & Time:', val: new Date().toLocaleString() }
        ];

        metadata.forEach((item, index) => {
            const rowNumber = index + 1;
            worksheet.getCell(`A${rowNumber}`).value = item.label;
            worksheet.getCell(`A${rowNumber}`).style = labelStyle;
            worksheet.getCell(`B${rowNumber}`).value = item.val;
            worksheet.getCell(`B${rowNumber}`).style = valueStyle;
        });

        worksheet.addRow([]); // Row 7 - Gap Row

        // Table Header Row (Row 8)
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
            fgColor: { argb: 'FF2B579A' } // Sleek corporate blue
        };

        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = headerFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        // Table Data Rows
        units.forEach((u: any) => {
            const formatTime = (time: string | Date | null) => {
                if (!time) return '-';
                return new Date(time).toLocaleString();
            };

            const dataRow = worksheet.addRow([
                u.barcode,
                u.scanned_by,
                formatTime(u.scan_date_time),
                u.status,
                u.failure_remark || '-',
                formatTime(u.repair_time),
                u.repair_remark || '-'
            ]);
            dataRow.height = 20;

            const isRework = u.status === 'REWORK';
            const isDebug = u.status === 'DEBUG';

            dataRow.eachCell((cell, colNumber) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;
                
                // Alignment
                if (colNumber === 3 || colNumber === 4 || colNumber === 6) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                } else {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                }

                // Row colors for Rework and Debug
                if (isRework) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFF9C4' } // Light Yellow
                    };
                } else if (isDebug) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFEBEE' } // Light Red
                    };
                }

                // Status coloring
                if (colNumber === 4) {
                    if (u.status === 'ACCEPTED' || u.status === 'PASSED') {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 }; // Rich Green
                    } else if (u.status === 'REWORK') {
                        cell.font = { color: { argb: 'FFFFAF33' }, bold: true, name: 'Segoe UI', size: 10 }; // Orange/Yellow
                    } else if (u.status === 'DEBUG') {
                        cell.font = { color: { argb: 'FFFF0000' }, bold: true, name: 'Segoe UI', size: 10 }; // Red
                    } else if (u.status === 'PENDING') {
                        cell.font = { color: { argb: 'FF808080' }, italic: true, name: 'Segoe UI', size: 10 }; // Gray
                    }
                }
            });
        });

        // Auto Column Width Adjuster
        worksheet.columns.forEach((column) => {
            let maxLen = 0;
            column.eachCell!({ includeEmpty: true }, (cell) => {
                // Ignore metadata labels for auto-fit sizing in Column A
                if (cell.row && (cell.row as any).number <= 7) return;

                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
            column.width = maxLen < 14 ? 14 : maxLen + 5;
        });

        // Auto column size correction for metadata section
        worksheet.getColumn(1).width = 25; 
        worksheet.getColumn(2).width = 25; 

        // Freeze top 8 rows (metadata + headers)
        worksheet.views = [{ state: 'frozen', ySplit: 8 }];

        // 5. Send Excel file as response stream
        const safeBatchNo = batch.batch_number.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `${stageCode}_Batch_Report_${safeBatchNo}_${nowStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error('Error generating Excel file:', err);
        return res.status(500).json({ error: 'Failed to generate Excel download report: ' + err.message });
    }
};
