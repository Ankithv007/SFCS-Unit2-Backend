import { Request, Response } from 'express';
import { pool } from '../config/database';
import ExcelJS from 'exceljs';

export const getQCInspectionStatus = async (req: Request, res: Response) => {
    try {
        res.json({ message: 'QC Inspection Module is active', status: 'OK' });
    } catch (error) {
        console.error('Error in getQCInspectionStatus:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const getFormData = async (req: Request, res: Response) => {
    try {
        // Fetch active shifts from DB
        const shiftsResult = await pool.query("SELECT id, name, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time FROM shifts WHERE status = 'active' ORDER BY name");

        // Fetch TPNs and PNs from DB
        const tpnResult = await pool.query("SELECT value FROM qc_unit_tpns ORDER BY value");
        const pnResult = await pool.query("SELECT value FROM qc_unit_pns ORDER BY value");

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

export const getShifts = async (req: Request, res: Response) => {
    try {
        const result = await pool.query("SELECT id, name, to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time, status FROM shifts ORDER BY name");
        res.json(result.rows);
    } catch (error) {
        console.error('Error in getShifts:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const createShift = async (req: Request, res: Response) => {
    try {
        const { name, start_time, end_time, status, created_by } = req.body;
        await pool.query(
            "INSERT INTO shifts (name, start_time, end_time, status, created_by) VALUES ($1, $2, $3, $4, $5)",
            [name, start_time, end_time, status, created_by]
        );
        res.status(201).json({ message: 'Shift created successfully' });
    } catch (error) {
        console.error('Error in createShift:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const updateShift = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, start_time, end_time, status } = req.body;
        await pool.query(
            "UPDATE shifts SET name = $1, start_time = $2, end_time = $3, status = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5",
            [name, start_time, end_time, status, id]
        );
        res.json({ message: 'Shift updated successfully' });
    } catch (error) {
        console.error('Error in updateShift:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const submitInspection = async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {

        const {
            inspector_name, shift, unit_tpn, unit_pn, unit_serial_no,
            pam_tpn, pam_1, pam_2, pam_3, pam_4, ran_barcode, band,
            checklist_results, final_status, process_confirmation,
            de_assembly_status, rework_count, combined_remarks
        } = req.body;

        await client.query('BEGIN');

        // 1. Determine Pass/Fail Status based on checklist
        // Logic: IF any checkpoint = FAIL -> Failed = YES, Passed = NO
        const hasFailures = checklist_results.some((item: any) => item.status === 'FAIL');
        const passed = hasFailures ? 'NO' : 'YES';
        const failed = hasFailures ? 'YES' : 'NO';
        const good_count = hasFailures ? 0 : 1;
        const bad_count = hasFailures ? 1 : 0;

        // 2. Insert or Update qc_unit_inspection
        const inspectionResult = await client.query(
            `INSERT INTO qc_unit_inspection (
                unit_serial_no, unit_tpn, unit_pn, pam_tpn, 
                pam_1, pam_2, pam_3, pam_4, ran_barcode, 
                shift, band, good_count, bad_count, 
                passed, failed, inspected_by, status,
                de_assembly_status, rework_count, final_status, combined_remarks
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            ON CONFLICT (unit_serial_no) DO UPDATE SET
                unit_tpn = EXCLUDED.unit_tpn,
                unit_pn = EXCLUDED.unit_pn,
                pam_tpn = EXCLUDED.pam_tpn,
                pam_1 = EXCLUDED.pam_1,
                pam_2 = EXCLUDED.pam_2,
                pam_3 = EXCLUDED.pam_3,
                pam_4 = EXCLUDED.pam_4,
                ran_barcode = EXCLUDED.ran_barcode,
                shift = EXCLUDED.shift,
                band = EXCLUDED.band,
                good_count = EXCLUDED.good_count,
                bad_count = EXCLUDED.bad_count,
                passed = EXCLUDED.passed,
                failed = EXCLUDED.failed,
                inspected_by = EXCLUDED.inspected_by,
                status = EXCLUDED.status,
                de_assembly_status = EXCLUDED.de_assembly_status,
                rework_count = EXCLUDED.rework_count,
                final_status = EXCLUDED.final_status,
                combined_remarks = EXCLUDED.combined_remarks,
                inspection_date_time = CURRENT_TIMESTAMP
            RETURNING id`,
            [
                unit_serial_no, unit_tpn, unit_pn, pam_tpn,
                pam_1, pam_2, pam_3, pam_4, ran_barcode,
                shift, band, good_count, bad_count,
                passed, failed, inspector_name,
                final_status === 'WAITING_FOR_REWORK' ? 'WAITING_FOR_REWORK' : 'COMPLETED',
                de_assembly_status, rework_count, final_status, combined_remarks
            ]
        );

        const inspectionId = inspectionResult.rows[0].id;

        // 3. Delete old checklist results if updating
        await client.query('DELETE FROM qc_inspection_checklist_result WHERE inspection_id = $1', [inspectionId]);

        // 4. Insert new checklist results
        for (const item of checklist_results) {
            if (item.status === null && !item.is_confirmed) continue;
            await client.query(
                `INSERT INTO qc_inspection_checklist_result (
                    inspection_id, inspection_level, checkpoint_no, 
                    checkpoint_description, result, remark,
                    rework_count, history
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    inspectionId,
                    item.level,
                    item.id,
                    item.text,
                    item.status,
                    item.remarks || '',
                    item.rework_count || 0,
                    JSON.stringify(item.history || [])
                ]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({ message: 'Inspection submitted successfully', id: inspectionId });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error in submitInspection:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error: ' + (error as any).message });
    } finally {
        client.release();
    }
};

export const addTpn = async (req: Request, res: Response) => {
    const { value } = req.body;
    if (!value) return res.status(400).json({ status: 'error', message: 'Value is required' });

    try {
        const result = await pool.query(
            "INSERT INTO qc_unit_tpns (value) VALUES ($1) ON CONFLICT (value) DO NOTHING RETURNING *",
            [value]
        );
        res.json({ success: true, value, created: result.rowCount ? true : false });
    } catch (error) {
        console.error('Error adding TPN:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const addPn = async (req: Request, res: Response) => {
    const { value } = req.body;
    if (!value) return res.status(400).json({ status: 'error', message: 'Value is required' });

    try {
        const result = await pool.query(
            "INSERT INTO qc_unit_pns (value) VALUES ($1) ON CONFLICT (value) DO NOTHING RETURNING *",
            [value]
        );
        res.json({ success: true, value, created: result.rowCount ? true : false });
    } catch (error) {
        console.error('Error adding PN:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const deleteShift = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM shifts WHERE id = $1', [id]);
        res.json({ message: 'Shift deleted successfully' });
    } catch (error) {
        console.error('Error in deleteShift:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const validateSerialNumber = async (req: Request, res: Response) => {
    try {
        console.log('Validating Serial Number. Body:', req.body);
        let { unit_serial_no } = req.body;

        if (!unit_serial_no) {
            console.error('Validation Error: unit_serial_no is missing');
            return res.status(400).json({ status: 'error', message: 'Serial Number (unit_serial_no) is required' });
        }

        const rawValue = unit_serial_no;

        // 1. Check if matches TPN/PN format (Reject)
        // TPN/PN Regex: ^[0-9]{3}-[A-Z0-9]{10}-[A-Z]$
        const tpnPnRegex = /^[0-9]{3}-[A-Z0-9]{10}-[A-Z]$/;
        if (tpnPnRegex.test(rawValue)) {
            return res.status(400).json({ status: 'error', message: 'Invalid scan. You are scanning TPN or PN. Please scan or enter a barcode starting with SN only.' });
        }

        // 2. Check if matches SN format
        // Example: AA-2225-60-2MZT
        // Pattern: AA - 4 digits - 2 digits - 4 alphanumeric
        // Regex: ^AA-[0-9]{4}-[0-9]{2}-[A-Z0-9]{4}$
        const snRegex = /^AA-[0-9]{4}-[0-9]{2}-[A-Z0-9]{4}$/;
        if (!snRegex.test(rawValue)) {
            return res.status(400).json({ status: 'error', message: 'Invalid Serial Number format. Must be AA-XXXX-XX-XXXX.' });
        }

        // 3. Check for Existing Record
        const existingRecord = await pool.query(
            `SELECT i.*, 
                (SELECT json_agg(c.*) FROM qc_inspection_checklist_result c WHERE c.inspection_id = i.id) as checklist
             FROM qc_unit_inspection i 
             WHERE i.unit_serial_no = $1`,
            [rawValue]
        );

        if ((existingRecord.rowCount || 0) > 0) {
            const unit = existingRecord.rows[0];

            if (unit.final_status === 'PASS') {
                return res.status(400).json({ status: 'error', message: 'This unit has already passed inspection and cannot be scanned again.' });
            }

            if (unit.final_status === 'REJECTED') {
                return res.status(400).json({ status: 'error', message: 'This unit has been rejected and cannot be scanned again.' });
            }

            if (unit.final_status === 'WAITING_FOR_REWORK') {
                return res.json({
                    status: 'success',
                    message: 'Rework unit detected. Loading history...',
                    value: rawValue,
                    existingData: {
                        unit_tpn: unit.unit_tpn,
                        unit_pn: unit.unit_pn,
                        pam_tpn: unit.pam_tpn,
                        pam_1: unit.pam_1,
                        pam_2: unit.pam_2,
                        pam_3: unit.pam_3,
                        pam_4: unit.pam_4,
                        ran_barcode: unit.ran_barcode,
                        band: unit.band,
                        rework_count: unit.rework_count,
                        combined_remarks: unit.combined_remarks,
                        de_assembly_status: unit.de_assembly_status,
                        checklist: unit.checklist || []
                    }
                });
            }

            return res.status(400).json({ error: 'Duplicate Serial Number. This SN already exists.' });
        }

        res.json({ status: 'success', message: 'Serial Number Verified', value: rawValue });

    } catch (error) {
        console.error('Error in validateSerialNumber:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const validatePam = async (req: Request, res: Response) => {
    try {
        console.log('Validating PAM. Body:', req.body);
        let { pam_no, pam_value } = req.body;
        const rawValue = pam_no || pam_value;

        if (!rawValue) {
            console.error('Validation Error: PAM scan value is missing');
            return res.status(400).json({ status: 'error', message: 'PAM Value (pam_no) is required' });
        }

        // 1. Check if matches TPN/PN format (Reject)
        const tpnPnRegex = /^[0-9]{3}-[A-Z0-9]{10}-[A-Z]$/;
        if (tpnPnRegex.test(rawValue)) {
            return res.status(400).json({ status: 'error', message: 'Invalid scan. You are scanning TPN or PN. Please scan or enter a valid PAM barcode.' });
        }

        // 2. Check if matches PAM format (Structure: XX-XXXX-XX-XXXX)
        // Allowed prefixes: AY, AB, etc. (Any 2 uppercase letters)
        const pamRegex = /^[A-Z]{2}-[0-9]{4}-[0-9]{2}-[A-Z0-9]{4}$/;
        if (!pamRegex.test(rawValue)) {
            return res.status(400).json({ status: 'error', message: 'Invalid PAM format. Must be XX-XXXX-XX-XXXX (e.g., AY-2224-24-A0TR).' });
        }

        // 3. Check for Duplicates
        const duplicateCheck = await pool.query(
            `SELECT 1 FROM qc_unit_inspection 
             WHERE pam_1 = $1 OR pam_2 = $1 OR pam_3 = $1 OR pam_4 = $1`,
            [rawValue]
        );

        if ((duplicateCheck.rowCount || 0) > 0) {
            return res.status(400).json({ status: 'error', message: 'Duplicate PAM Value. This value already exists in the database.' });
        }

        res.json({ status: 'success', message: 'PAM Verified', value: rawValue });

    } catch (error) {
        console.error('Error in validatePam:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const validateRanBarcode = async (req: Request, res: Response) => {
    try {
        console.log('Validating RAN Barcode. Body:', req.body);
        let { ran_barcode } = req.body;

        if (!ran_barcode) {
            console.error('Validation Error: ran_barcode is missing');
            return res.status(400).json({ status: 'error', message: 'RAN Barcode is required' });
        }

        // 1. Check format: RAN-XXXXXX_BO_XXXX
        const ranRegex = /^RAN-\d{6}_BO_\d{4}$/;
        if (!ranRegex.test(ran_barcode)) {
            return res.status(400).json({ status: 'error', message: 'Invalid RAN Barcode format. Expected: RAN-XXXXXX_BO_XXXX' });
        }

        res.json({ status: 'success', message: 'RAN Barcode Verified', value: ran_barcode });

    } catch (error) {
        console.error('Error in validateRanBarcode:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const getCompletedInspections = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const offset = (page - 1) * limit;

        const countResult = await pool.query('SELECT COUNT(*) FROM qc_unit_inspection WHERE status IN ($1, $2)', ['COMPLETED', 'WAITING_FOR_REWORK']);
        const totalItems = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        const result = await pool.query(
            `SELECT * FROM qc_unit_inspection 
             WHERE status IN ($1, $2) 
             ORDER BY inspection_date_time DESC 
             LIMIT $3 OFFSET $4`,
            ['COMPLETED', 'WAITING_FOR_REWORK', limit, offset]
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
        console.error('Error in getCompletedInspections:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};

export const exportInspectionsExcel = async (req: Request, res: Response) => {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('QC Inspections');

        // Define Checklist Columns (Exact Names)
        const checklistItems = [
            "Check the Solderability of the C441 & C442 (No Solderability issues, solder splashes issue & solder balls issues near C441 & C442)",
            "Check the Bullet 8no's Presence & Damage",
            "Check and scan the Unit Slno, PAM Slno with RAN Bar code (Week code)",
            "Ensure all Labels and Stickers are free from Damage, Misalignment, Print cut, Barcode erased",
            "Check Enclosure / PAM Gasket Orientation as per WI and no Damage / Missing",
            "PAM Shield with 8 (Screw) × 4 PAM Shield – No Damage",
            "Check J39 Connectors Orientation are properly connected, no Misalignment / Missing / Damage",
            "Check the Unit Level Screw (14 no's)",
            "Check the RAN Number Located in Enclosure (RAN-000222)"
        ];

        // Base Columns
        const columns = [
            { header: 'Inspection Date', key: 'inspection_date_time', width: 20 },
            { header: 'Shift', key: 'shift', width: 15 },
            { header: 'Inspector Name', key: 'inspected_by', width: 20 },
            { header: 'Unit TPN', key: 'unit_tpn', width: 20 },
            { header: 'Unit PN', key: 'unit_pn', width: 20 },
            { header: 'Unit Serial No', key: 'unit_serial_no', width: 25 },
            { header: 'PAM TPN', key: 'pam_tpn', width: 20 },
            { header: 'PAM 1', key: 'pam_1', width: 20 },
            { header: 'PAM 2', key: 'pam_2', width: 20 },
            { header: 'PAM 3', key: 'pam_3', width: 20 },
            { header: 'PAM 4', key: 'pam_4', width: 20 },
            { header: 'RAN Barcode', key: 'ran_barcode', width: 25 },
            { header: 'Band', key: 'band', width: 10 },
            { header: 'De-Assembly', key: 'de_assembly', width: 20 },
            // Add Descriptive Checklist Columns
            ...checklistItems.map((itemText) => ({
                header: itemText,
                key: itemText.replace(/\s+/g, '_').substring(0, 50), // Use a slugified version of the text as key
                width: 25
            })),
            { header: 'Final Status', key: 'final_status', width: 20 },
            { header: 'Process Confirmation (Non-ROHS)', key: 'process_confirmation', width: 40 },
            { header: 'Remarks', key: 'remarks', width: 50 }
        ];

        worksheet.columns = columns;

        // Style Header
        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE0E0E0' }
        };

        // Enable Text Wrapping for Header
        worksheet.getRow(1).alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };

        // Fetch ALL Inspections (Completed and Waiting for Rework)
        let query = `SELECT * FROM qc_unit_inspection WHERE status IN ($1, $2) ORDER BY inspection_date_time ASC`;
        const params: any[] = ['COMPLETED', 'WAITING_FOR_REWORK'];

        const result = await pool.query(query, params);

        // Process each row to fetch checklist results
        for (const row of result.rows) {
            const checklistResult = await pool.query(
                `SELECT checkpoint_description, result, remark, rework_count, history 
                 FROM qc_inspection_checklist_result 
                 WHERE inspection_id = $1`,
                [row.id]
            );

            const rowData: any = {
                ...row,
                inspection_date_time: new Date(row.inspection_date_time).toLocaleString(),
                de_assembly: row.de_assembly_status,
                final_status: row.final_status,
                process_confirmation: "C441 & C442 mounting using leaded",
                remarks: row.combined_remarks || ''
            };

            // Map checklist results to Stage columns
            // Sequential Logic: Only populate if De-Assembly is PASS
            if (row.de_assembly_status === 'PASS') {
                checklistItems.forEach((itemText) => {
                    const match = checklistResult.rows.find((r: any) => r.checkpoint_description === itemText);
                    const key = itemText.replace(/\s+/g, '_').substring(0, 50);
                    if (match) {
                        rowData[key] = match.result || '';
                    } else {
                        rowData[key] = '';
                    }
                });
            } else {
                checklistItems.forEach((itemText) => {
                    const key = itemText.replace(/\s+/g, '_').substring(0, 50);
                    rowData[key] = '';
                });
            }

            // Aggregate all remarks (De-Assembly + Checklist)
            let cumulativeRemarks: string[] = [];

            // Add De-Assembly remarks if they exist
            if (row.combined_remarks) {
                cumulativeRemarks.push(row.combined_remarks);
            }

            // Add Checklist remarks with timestamps and attempt labels
            checklistResult.rows.forEach((r: any) => {
                const history = r.history || [];
                history.forEach((h: any) => {
                    if (h.remark) {
                        const date = h.timestamp ? new Date(h.timestamp).toLocaleString() : 'N/A';
                        const attemptLabel = h.attempt === 0 ? 'Initial' : `Rework ${h.attempt}`;
                        cumulativeRemarks.push(`[${r.checkpoint_description}] [${attemptLabel}] [${date}]: ${h.remark}`);
                    }
                });
            });

            // Remove potential duplicates and join with newlines
            rowData.remarks = Array.from(new Set(cumulativeRemarks)).join('\n');

            const newRow = worksheet.addRow(rowData);

            // Enable Text Wrapping for Data Rows
            newRow.alignment = { wrapText: true, vertical: 'top', horizontal: 'left' };

            // Highlight failed rows
            if (row.final_status === 'REJECTED' || row.final_status === 'FAIL') {
                newRow.eachCell((cell) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFCCCC' } // Light Red
                    };
                });
            } else if (row.final_status === 'WAITING_FOR_REWORK') {
                newRow.eachCell((cell) => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFFFCC' } // Light Yellow
                    };
                });
            }
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=QC_Inspections_Report.xlsx');

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error('Error exporting excel:', error);
        res.status(500).json({ status: 'error', message: 'Internal server error' });
    }
};
