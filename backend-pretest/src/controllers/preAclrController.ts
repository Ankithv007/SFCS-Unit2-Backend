import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('PRE-ACLR');

// Barcode Regex Pattern: AA-####-##-#### (15 chars, hyphens at 2, 7, 10)
const BARCODE_REGEX = /^[A-Z]{2}-\d{4}-\d{2}-[A-Z0-9]{4}$/;

// Helper to get IST Time
const getISTTime = () => {
    const now = new Date();
    return new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
};

// Helper to calculate shift based on IST hour
const getShift = (istDate: Date): string => {
    const hour = istDate.getUTCHours();
    if (hour >= 6 && hour < 14) return 'A';
    if (hour >= 14 && hour < 22) return 'B';
    return 'C'; // 22:00 to 06:00
};

export const getTestCaseMaster = async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT * FROM aclr_test_case_master ORDER BY test_case_number ASC');
        res.json(result.rows);
    } catch (error: any) {
        logger.error(`Error fetching test cases: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getRecentSummary = async (req: Request, res: Response) => {
    try {
        // Last 5 days yield summary
        const result = await pool.query(`
            WITH RECURSIVE days AS (
                SELECT (CURRENT_DATE AT TIME ZONE 'UTC' + INTERVAL '5 hours 30 minutes')::date as day_date
                UNION ALL
                SELECT (day_date - INTERVAL '1 day')::date
                FROM days
                WHERE day_date > (CURRENT_DATE AT TIME ZONE 'UTC' + INTERVAL '5 hours 30 minutes')::date - INTERVAL '4 days'
            ),
            scan_events AS (
                -- Original PASS
                SELECT (scanned_at AT TIME ZONE 'UTC' + INTERVAL '5 hours 30 minutes')::date as event_date, 'PASS' as status
                FROM pre_aclr_scans
                WHERE aclr_result = 'PASS'
                UNION ALL
                -- Original FAIL
                SELECT (scanned_at AT TIME ZONE 'UTC' + INTERVAL '5 hours 30 minutes')::date as event_date, 'FAIL' as status
                FROM pre_aclr_scans
                WHERE aclr_result = 'FAIL'
                UNION ALL
                -- Retest PASS
                SELECT (retest_datetime AT TIME ZONE 'UTC' + INTERVAL '5 hours 30 minutes')::date as event_date, 'PASS' as status
                FROM pre_aclr_scans
                WHERE retest_result = 'PASS'
            )
            SELECT 
                d.day_date as date,
                COALESCE(COUNT(s.status) FILTER (WHERE s.status = 'PASS'), 0) as pass,
                COALESCE(COUNT(s.status) FILTER (WHERE s.status = 'FAIL'), 0) as fail,
                COALESCE(COUNT(s.status), 0) as total,
                CASE 
                    WHEN COUNT(s.status) = 0 THEN 0 
                    ELSE ROUND((COUNT(s.status) FILTER (WHERE s.status = 'PASS')::numeric / COUNT(s.status)::numeric) * 100, 2)
                END as yield
            FROM days d
            LEFT JOIN scan_events s ON s.event_date = d.day_date
            GROUP BY d.day_date
            ORDER BY d.day_date DESC
        `);
        res.json(result.rows);
    } catch (error: any) {
        logger.error(`Error fetching summary: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const verifyBarcode = async (req: Request, res: Response) => {
    const { barcode } = req.query;

    if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

    const barcodeStr = (barcode as string).trim();

    // 1. Format Validation
    if (!BARCODE_REGEX.test(barcodeStr)) {
        return res.status(400).json({ error: 'Invalid barcode format. Please scan a valid barcode (AA-####-##-####).' });
    }

    try {
        // 2. Existence and Eligibility Validation (Impedance)
        const impedanceCheck = await pool.query(`
            SELECT * FROM impedance_scans 
            WHERE barcode = $1 
            ORDER BY scanned_at DESC LIMIT 1
        `, [barcodeStr]);

        if (impedanceCheck.rows.length === 0) {
            return res.status(400).json({ error: 'This barcode is not from Impedance stage.' });
        }

        const record = impedanceCheck.rows[0];

        // Find 'status' key case-insensitively
        const statusKey = Object.keys(record).find(k => k.toLowerCase() === 'status');
        const statusVal = statusKey ? (record[statusKey] || '').toString().trim().toUpperCase() : '';

        if (statusVal === 'FAIL') {
            return res.status(400).json({ error: 'This barcode has failed in Impedance stage.' });
        }

        if (statusVal !== 'PASS' && statusVal !== 'ACCEPTED') {
            return res.status(400).json({ error: 'This barcode exists but has not passed Impedance stage.' });
        }

        // 3. Calibration Stage Validation
        const calibrationCheck = await pool.query(`
            SELECT calibration_result, retest_result 
            FROM pre_calibration_scans 
            WHERE barcode = $1
        `, [barcodeStr]);

        if (calibrationCheck.rows.length === 0) {
            return res.status(400).json({ error: 'This barcode is not from Calibration stage.' });
        }

        const calRecord = calibrationCheck.rows[0];
        if (calRecord.calibration_result !== 'PASS' && calRecord.retest_result !== 'PASS') {
            return res.status(400).json({ error: 'Not allowed – Barcode not passed in Calibration stage' });
        }

        // 4. Duplicate and PASS Check
        const duplicateCheck = await pool.query(`
            SELECT aclr_result, retest_result 
            FROM pre_aclr_scans 
            WHERE barcode = $1
        `, [barcodeStr]);

        if (duplicateCheck.rows.length > 0) {
            const record = duplicateCheck.rows[0];
            if (record.aclr_result === 'PASS' || record.retest_result === 'PASS') {
                return res.status(400).json({ error: 'Duplicate – Already Passed in Pre-ACLR' });
            }
        }

        console.log("VERIFY SUCCESS for Pre-ACLR:", barcodeStr);
        res.json({ success: true, message: 'Barcode verified successfully.' });
    } catch (error: any) {
        logger.error(`Error in verifyBarcode: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const scanBarcode = async (req: Request, res: Response) => {
    const { barcode, operator_name, measured_value, aclr_result, jig_id } = req.body;

    if (!operator_name) return res.status(400).json({ error: 'Operator Name is mandatory' });
    if (!barcode) return res.status(400).json({ error: 'Barcode is required' });

    try {
        // 1. Format Validation
        if (!BARCODE_REGEX.test(barcode)) {
            return res.status(400).json({ error: 'Invalid barcode format. Please scan a valid barcode (AA-####-##-####).' });
        }

        // 2. Impedance Validation
        const impedanceCheck = await pool.query(`
            SELECT * FROM impedance_scans 
            WHERE barcode = $1 
            ORDER BY scanned_at DESC LIMIT 1
        `, [barcode]);

        if (impedanceCheck.rows.length === 0) {
            return res.status(400).json({ error: 'This barcode is not from Impedance stage.' });
        }

        const record = impedanceCheck.rows[0];
        const statusKey = Object.keys(record).find(k => k.toLowerCase() === 'status');
        const statusVal = statusKey ? (record[statusKey] || '').toString().trim().toUpperCase() : '';

        if (statusVal === 'FAIL') {
            return res.status(400).json({ error: 'This barcode has failed in Impedance stage.' });
        }

        if (statusVal !== 'PASS' && statusVal !== 'ACCEPTED') {
            return res.status(400).json({ error: 'This barcode exists but has not passed Impedance stage.' });
        }

        // 3. Calibration Stage Validation (Safety Check)
        const calibrationCheck = await pool.query(`
            SELECT calibration_result, retest_result 
            FROM pre_calibration_scans 
            WHERE barcode = $1
        `, [barcode]);

        if (calibrationCheck.rows.length === 0 || (calibrationCheck.rows[0].calibration_result !== 'PASS' && calibrationCheck.rows[0].retest_result !== 'PASS')) {
            return res.status(400).json({ error: 'Not allowed – Barcode not passed in Calibration stage' });
        }

        // 4. Duplicate and Retest Check
        const existingRecord = await pool.query(`
            SELECT id, aclr_result, retest_result 
            FROM pre_aclr_scans 
            WHERE barcode = $1
        `, [barcode]);

        if (existingRecord.rows.length > 0) {
            const row = existingRecord.rows[0];
            if (row.aclr_result === 'PASS' || row.retest_result === 'PASS') {
                return res.status(400).json({ error: 'Duplicate – Already Passed in Pre-ACLR' });
            }

            // Already FAILED?
            if (row.aclr_result === 'FAIL') {
                if (aclr_result === 'FAIL') {
                    return res.status(400).json({ error: 'This barcode is already marked as FAILED in ACLR. Please pass it on retest.' });
                }

                // Retest case: Was FAIL, now PASS
                const istNow = getISTTime();
                const updateScan = await pool.query(`
                    UPDATE pre_aclr_scans
                    SET retest_result = 'PASS',
                        retest_datetime = $1,
                        operator_name = $2
                    WHERE id = $3 RETURNING *
                `, [istNow, operator_name, row.id]);

                return res.json({ message: 'ACLR Retest recorded successfully (Record Updated)', data: updateScan.rows[0] });
            }
        }

        // 5. Insert Logic (First-time ACLR Scan)
        const istNow = getISTTime();
        const shift = getShift(istNow);

        let finalMeasuredValue = null;
        let finalTestCase = null;

        if (aclr_result === 'FAIL') {
            if (!measured_value || measured_value.toString().trim() === '') {
                return res.status(400).json({ error: 'Measured Value is mandatory for failed units.' });
            }

            const failureCode = parseInt(measured_value);

            // Validate failure code
            const tcCheck = await pool.query('SELECT * FROM aclr_test_case_master WHERE test_case_number = $1', [failureCode]);
            if (tcCheck.rows.length === 0) {
                return res.status(400).json({ error: 'Invalid Test Case Number. Please enter a valid value.' });
            }

            finalMeasuredValue = failureCode;
            finalTestCase = failureCode;
        }

        const newScan = await pool.query(`
            INSERT INTO pre_aclr_scans 
            (barcode, operator_name, measured_value, aclr_result, test_case_number, shift, stage, jig_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
        `, [barcode, operator_name, finalMeasuredValue, aclr_result, finalTestCase, shift, 'PRE-ACLR', jig_id]);

        return res.status(201).json({ message: 'ACLR Scan recorded successfully', data: newScan.rows[0] });
    } catch (error: any) {
        logger.error(`Error in scanBarcode: ${error.message}`);
        if (error.code === '23514') {
            return res.status(400).json({ error: 'Business rule violation: Check measured value or test case requirements.' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const getCompletedScans = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    try {
        const result = await pool.query(`
            SELECT s.*, t.test_case_name, t.reason
            FROM pre_aclr_scans s
            LEFT JOIN aclr_test_case_master t ON s.test_case_number = t.test_case_number
            ORDER BY s.scanned_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        const countResult = await pool.query('SELECT COUNT(*) FROM pre_aclr_scans');
        const total = parseInt(countResult.rows[0].count);

        res.json({
            data: result.rows,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error: any) {
        logger.error(`Error fetching scans: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const resetSession = async (req: Request, res: Response) => {
    logger.info('Pre-ACLR Session Reset by operator');
    res.json({ success: true, message: 'Session reset logged' });
};

export const downloadExcel = async (req: Request, res: Response) => {
    try {
        const workbook = new ExcelJS.Workbook();

        // Standard Styles
        const headerStyleDetails = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            }
        };

        const headerStyleMonthly = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            }
        };

        const cellBorder = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };

        // --- Sheet 1: Details ---
        const sheet1 = workbook.addWorksheet('PRE-ACLR - Complete Details');
        sheet1.columns = [
            { header: 'S.No', key: 'sno', width: 10 },
            { header: 'Date & Time', key: 'datetime', width: 25 },
            { header: 'Shift', key: 'shift', width: 10 },
            { header: 'Stage', key: 'stage', width: 15 },
            { header: 'Operator Name', key: 'operator', width: 20 },
            { header: 'Jig ID', key: 'jig', width: 25 },
            { header: 'TPN', key: 'tpn', width: 20 },
            { header: 'Barcode Number', key: 'barcode', width: 20 },
            { header: 'ACLR Result', key: 'result', width: 20 },
            { header: 'Retest Result', key: 'retest_result', width: 20 },
            { header: 'Retest Date & Time', key: 'retest_time', width: 25 },
            { header: 'Failed Case NO', key: 'failed_case', width: 20 },
            { header: 'FAILURE CASE', key: 'failure_case', width: 25 }
        ];

        // Style the headers
        sheet1.getRow(1).eachCell((cell: any) => {
            Object.assign(cell, headerStyleDetails);
        });

        const scans = await pool.query(`
            SELECT s.*, t.test_case_name 
            FROM pre_aclr_scans s 
            LEFT JOIN aclr_test_case_master t ON s.test_case_number = t.test_case_number
            ORDER BY s.scanned_at ASC
        `);

        scans.rows.forEach((row, index) => {
            const istDate = new Date(row.scanned_at.getTime() + (5.5 * 60 * 60 * 1000));
            const retestIst = row.retest_datetime ? new Date(row.retest_datetime.getTime() + (5.5 * 60 * 60 * 1000)) : null;

            const isFail = row.aclr_result === 'FAIL';

            const newRow = sheet1.addRow({
                sno: index + 1,
                datetime: istDate.toISOString().replace('T', ' ').substring(0, 19),
                shift: row.shift,
                stage: row.stage,
                operator: row.operator_name,
                jig: row.jig_id,
                tpn: row.tpn,
                barcode: row.barcode,
                result: row.aclr_result,
                retest_result: row.retest_result || '',
                retest_time: retestIst ? retestIst.toISOString().replace('T', ' ').substring(0, 19) : '',
                failed_case: isFail ? (row.test_case_number || '-') : '',
                failure_case: isFail ? (row.test_case_name || '-') : ''
            });

            // Styling result and borders
            newRow.eachCell((cell: any, colNumber: number) => {
                cell.border = cellBorder;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                if (colNumber === 9) { // Result Column
                    if (row.aclr_result === 'PASS') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
                        cell.font = { color: { argb: 'FF006100' } };
                    } else if (row.aclr_result === 'FAIL') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
                        cell.font = { color: { argb: 'FF9C0006' } };
                    }
                }

                if (colNumber === 10) { // Retest Result Column
                    if (row.retest_result === 'PASS') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
                        cell.font = { color: { argb: 'FF006100' } };
                    }
                }
            });
        });

        // --- Sheet 2: Monthly Output ---
        const sheet2 = workbook.addWorksheet('PRE-ACLR Daily Output');

        // Add Title Row
        sheet2.mergeCells('A1:F1');
        const titleRow = sheet2.getRow(1);
        titleRow.getCell(1).value = 'Pre-ACLR Daily OUTPUT';
        titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
        titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

        sheet2.columns = [
            { header: 'S.NO', key: 'sno', width: 10 },
            { header: 'Date', key: 'date', width: 15 },
            { header: 'PASS', key: 'pass', width: 10 },
            { header: 'FAIL', key: 'fail', width: 10 },
            { header: 'Total', key: 'total', width: 10 },
            { header: 'Yeild %', key: 'yield', width: 15 }
        ];

        // Style the headers
        sheet2.getRow(2).eachCell((cell: any) => {
            Object.assign(cell, headerStyleMonthly);
        });

        const nowIst = getISTTime();
        const year = nowIst.getUTCFullYear();
        const month = nowIst.getUTCMonth();
        const firstDay = new Date(Date.UTC(year, month, 1));
        const lastDay = new Date(Date.UTC(year, month + 1, 0));

        const dailyDataResult = await pool.query(`
            WITH scan_events AS (
                -- Original PASS
                SELECT (scanned_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date as event_date, 'PASS' as status
                FROM pre_aclr_scans
                WHERE aclr_result = 'PASS' AND scanned_at >= $1 AND scanned_at <= $2
                UNION ALL
                -- Original FAIL
                SELECT (scanned_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date as event_date, 'FAIL' as status
                FROM pre_aclr_scans
                WHERE aclr_result = 'FAIL' AND scanned_at >= $1 AND scanned_at <= $2
                UNION ALL
                -- Retest PASS
                SELECT (retest_datetime AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date as event_date, 'PASS' as status
                FROM pre_aclr_scans
                WHERE retest_result = 'PASS' AND retest_datetime >= $1 AND retest_datetime <= $2
            )
            SELECT 
                event_date as scan_date,
                COUNT(*) as total_scans,
                COUNT(*) FILTER (WHERE status = 'PASS') as pass_scans,
                COUNT(*) FILTER (WHERE status = 'FAIL') as fail_scans
            FROM scan_events
            GROUP BY event_date
            ORDER BY event_date ASC
        `, [firstDay.toISOString(), lastDay.toISOString()]);

        const dailyMap = new Map();
        dailyDataResult.rows.forEach(r => {
            const dStr = new Date(r.scan_date).toISOString().split('T')[0];
            dailyMap.set(dStr, r);
        });

        let sno = 1;
        for (let d = new Date(firstDay); d <= lastDay; d.setUTCDate(d.getUTCDate() + 1)) {
            const dStr = d.toISOString().split('T')[0];
            const data = dailyMap.get(dStr) || { pass_scans: 0, fail_scans: 0, total_scans: 0 };

            const total = parseInt(data.total_scans || 0);
            const pass = parseInt(data.pass_scans || 0);
            const fail = parseInt(data.fail_scans || 0);

            const yieldVal = total > 0 ? ((pass / total) * 100).toFixed(2) : '0.00';

            const newRow = sheet2.addRow({
                sno: sno++,
                date: dStr,
                pass: pass,
                fail: fail,
                total: total,
                yield: yieldVal
            });

            newRow.eachCell((cell: any, colNumber: number) => {
                cell.border = cellBorder;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                if (colNumber === 6) { // Yield Column
                    const y = parseFloat(yieldVal);
                    if (y >= 90) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
                        cell.font = { color: { argb: 'FF006100' } };
                    } else if (y > 0) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
                        cell.font = { color: { argb: 'FF9C5700' } };
                    } else if (total > 0) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
                        cell.font = { color: { argb: 'FF9C0006' } };
                    }
                }
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Pre_ACLR_Report_${new Date().toISOString().split('T')[0]}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error: any) {
        logger.error(`Error downloading Excel: ${error.message}`);
        res.status(500).json({ error: 'Internal server error' });
    }
};
