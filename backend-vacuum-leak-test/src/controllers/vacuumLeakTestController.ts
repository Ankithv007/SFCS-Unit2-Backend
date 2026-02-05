import { Request, Response } from 'express';
import pool from '../config/db';
import ExcelJS from 'exceljs';

export const getFormData = async (req: Request, res: Response) => {
    try {
        // Fetch active shifts from DB
        const shiftsResult = await pool.query("SELECT id, name, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time FROM shifts WHERE status = 'active' ORDER BY name");

        // Fetch TPNs and PNs from DB
        const tpnResult = await pool.query("SELECT value FROM vlt_unit_tpns ORDER BY value");
        const pnResult = await pool.query("SELECT value FROM vlt_unit_pns ORDER BY value");

        res.json({
            shifts: shiftsResult.rows,
            unitTpns: tpnResult.rows.map((r: any) => r.value),
            unitPns: pnResult.rows.map((r: any) => r.value)
        });
    } catch (error) {
        console.error('Error in getFormData:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const submitVLTInspection = async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
        const {
            inspector_name, shift, unit_tpn, unit_pn, unit_serial_no,
            band, measured_value, final_status, failure_reason
        } = req.body;

        await client.query('BEGIN');

        // Check if matches SN format (parity with QC)
        const snRegex = /^AA-[0-9]{4}-[0-9]{2}-[A-Z0-9]{4}$/;
        if (!snRegex.test(unit_serial_no)) {
            return res.status(400).json({ status: 'error', message: 'Invalid Serial Number format. Must be AA-XXXX-XX-XXXX.' });
        }

        // Determine if this is a first inspection or retest
        const checkExisting = await client.query(
            "SELECT final_status FROM vlt_unit_inspection WHERE unit_serial_no = $1",
            [unit_serial_no]
        );

        let query = "";
        let params = [];

        if (checkExisting.rowCount === 0) {
            // New record
            query = `INSERT INTO vlt_unit_inspection (
                unit_serial_no, unit_tpn, unit_pn, shift, band, 
                measured_value, final_status, failure_reason, inspected_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
            params = [
                unit_serial_no, unit_tpn, unit_pn, shift, band,
                measured_value, final_status, failure_reason, inspector_name
            ];
        } else {
            const existing = checkExisting.rows[0];
            if (existing.final_status === 'PASS' || existing.final_status === 'REJECTED') {
                return res.status(400).json({ status: 'error', message: `This unit has already been ${existing.final_status.toLowerCase()} and cannot be updated.` });
            }

            // Update existing (retest)
            query = `UPDATE vlt_unit_inspection SET
                unit_tpn = $2, unit_pn = $3, shift = $4, band = $5,
                measured_value = $6, retested_result = $7, failure_reason = $8,
                inspected_by = $9, retested_date_time = CURRENT_TIMESTAMP
                WHERE unit_serial_no = $1`;
            params = [
                unit_serial_no, unit_tpn, unit_pn, shift, band,
                measured_value, final_status, failure_reason, inspector_name
            ];
        }

        await client.query(query, params);
        await client.query('COMMIT');

        res.status(201).json({ message: 'VLT Inspection submitted successfully' });

    } catch (error: any) {
        await client.query('ROLLBACK');
        console.error('Error in submitVLTInspection:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error: ' + error.message });
    } finally {
        client.release();
    }
};

export const getVLTCompletedInspections = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;

        const countResult = await pool.query('SELECT COUNT(*) FROM vlt_unit_inspection');
        const totalItems = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        const result = await pool.query(
            `SELECT * FROM vlt_unit_inspection 
             ORDER BY inspection_date_time DESC 
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );

        res.json({
            data: result.rows,
            pagination: {
                totalItems,
                totalPages,
                currentPage: page,
                itemsPerPage: limit
            }
        });
    } catch (error) {
        console.error('Error in getVLTCompletedInspections:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

const formatIST = (dateInput: any) => {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return '';

    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });

    const parts = formatter.formatToParts(date);
    const d = parts.find(p => p.type === 'day')?.value;
    const mo = parts.find(p => p.type === 'month')?.value;
    const y = parts.find(p => p.type === 'year')?.value;
    const h = parts.find(p => p.type === 'hour')?.value;
    const mi = parts.find(p => p.type === 'minute')?.value;
    const s = parts.find(p => p.type === 'second')?.value;
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value.toUpperCase() || '';

    return `${d}/${mo}/${y} ${h}:${mi}:${s} ${dayPeriod}`;
};

export const exportVLTExcel = async (req: Request, res: Response) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('VLT Inspections');

        const columns = [
            { header: 'S.No', key: 'sno', width: 10 },
            { header: 'Date & Time (IST)', key: 'inspection_date_time', width: 25 },
            { header: 'Shift', key: 'shift', width: 15 },
            { header: 'Stage', key: 'stage', width: 20 },
            { header: 'Operator Name', key: 'inspected_by', width: 20 },
            { header: 'Band', key: 'band', width: 10 },
            { header: 'TPN', key: 'unit_tpn', width: 20 },
            { header: 'PN', key: 'unit_pn', width: 20 },
            { header: 'SN', key: 'unit_serial_no', width: 25 },
            { header: 'Measured Value', key: 'measured_value', width: 20 },
            { header: 'Result', key: 'final_status', width: 15 },
            { header: 'Retested Date & Time (IST)', key: 'retested_date_time', width: 25 },
            { header: 'Retested Result', key: 'retested_result', width: 20 },
            { header: 'Reason for Failure', key: 'failure_reason', width: 40 }
        ];

        worksheet.columns = columns;

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };
        worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

        const result = await pool.query("SELECT * FROM vlt_unit_inspection ORDER BY inspection_date_time ASC");

        result.rows.forEach((row, index) => {
            const rowData = {
                sno: index + 1,
                inspection_date_time: formatIST(row.inspection_date_time),
                shift: row.shift,
                stage: 'Vacuum Leak Test',
                inspected_by: row.inspected_by,
                band: row.band,
                unit_tpn: row.unit_tpn,
                unit_pn: row.unit_pn,
                unit_serial_no: row.unit_serial_no,
                measured_value: row.measured_value,
                final_status: row.final_status,
                retested_date_time: formatIST(row.retested_date_time),
                retested_result: row.retested_result || '',
                failure_reason: row.failure_reason || ''
            };
            const newRow = worksheet.addRow(rowData);
            newRow.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=VLT_Inspections_Report.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting VLT excel:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const addTpn = async (req: Request, res: Response) => {
    const { value } = req.body;
    if (!value) return res.status(400).json({ status: 'error', message: 'Value is required' });
    try {
        const result = await pool.query(
            "INSERT INTO vlt_unit_tpns (value) VALUES ($1) ON CONFLICT (value) DO NOTHING RETURNING *",
            [value]
        );
        res.json({ success: true, value, created: result.rowCount ? true : false });
    } catch (error) {
        console.error('Error adding VLT TPN:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const addPn = async (req: Request, res: Response) => {
    const { value } = req.body;
    if (!value) return res.status(400).json({ status: 'error', message: 'Value is required' });
    try {
        const result = await pool.query(
            "INSERT INTO vlt_unit_pns (value) VALUES ($1) ON CONFLICT (value) DO NOTHING RETURNING *",
            [value]
        );
        res.json({ success: true, value, created: result.rowCount ? true : false });
    } catch (error) {
        console.error('Error adding VLT PN:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const validateVLTSerialNumber = async (req: Request, res: Response) => {
    try {
        const { unit_serial_no } = req.body;
        if (!unit_serial_no) {
            return res.status(400).json({ status: 'error', message: 'Serial Number is required' });
        }

        const snRegex = /^AA-[0-9]{4}-[0-9]{2}-[A-Z0-9]{4}$/;
        if (!snRegex.test(unit_serial_no)) {
            return res.status(400).json({ status: 'error', message: 'Invalid Serial Number format. Must be AA-XXXX-XX-XXXX.' });
        }

        const existingRecord = await pool.query(
            "SELECT * FROM vlt_unit_inspection WHERE unit_serial_no = $1",
            [unit_serial_no]
        );

        if (existingRecord && existingRecord.rowCount && existingRecord.rowCount > 0) {
            const unit = existingRecord.rows[0];
            if (unit.final_status === 'PASS' || unit.final_status === 'REJECTED') {
                return res.status(400).json({ status: 'error', message: `This unit has already been ${unit.final_status.toLowerCase()} and cannot be scanned again.` });
            }
            return res.json({
                status: 'success',
                message: 'Retest unit detected.',
                value: unit_serial_no,
                existingData: unit
            });
        }

        res.json({ status: 'success', message: 'Serial Number Verified', value: unit_serial_no });
    } catch (error) {
        console.error('Error in validateVLTSerialNumber:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};
