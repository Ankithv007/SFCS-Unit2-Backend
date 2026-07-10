import { Request, Response } from 'express';
import * as ExcelJS from 'exceljs';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('StencilController');

// Helper to get session operator details
const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    return {
        id: user?.id || user?.userId || null,
        name: user?.name || user?.email || 'Unknown User',
        role: user?.role || 'OPERATOR'
    };
};

// Create Stencil Master Record
export const createStencilRecord = async (req: Request, res: Response) => {
    const {
        stencil_name,
        job_number,
        revision,
        thickness_mills,
        manufacturing_date,
        side,
        storage_location,
        remarks
    } = req.body;

    const sessionUser = getSessionUser(req);

    // 1. Mandatory Fields Validation
    if (!stencil_name || !job_number || !revision || !thickness_mills || !manufacturing_date || !side) {
        return res.status(400).json({ message: 'Please fill all mandatory fields.' });
    }

    // Normalize side to uppercase SMT standards
    const normalizedSide = side.trim().toUpperCase();
    if (normalizedSide !== 'TOP' && normalizedSide !== 'BOTTOM' && normalizedSide !== 'TOP / BOTTOM') {
        return res.status(400).json({ message: "Side must be either 'TOP', 'BOTTOM', or 'TOP / BOTTOM'." });
    }

    try {
        // 2. Future Date Validation
        const todayStr = new Date().toISOString().split('T')[0];
        if (manufacturing_date > todayStr) {
            return res.status(400).json({ message: 'Manufacturing Date cannot be a future date.' });
        }

        // 5. Generate random internal Stencil ID for DB constraint compliance only
        // Stencil ID is no longer sequential or user-facing.

        // 6. Save the record
        const insertQuery = `
            INSERT INTO stencil_master (
                stencil_id, stencil_name, job_number,
                revision, thickness_mills, manufacturing_date, side, storage_location, 
                remarks, status, created_by, created_by_name, created_at, updated_at
            ) VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;

        const result = await pool.query(insertQuery, [
            stencil_name.trim(),
            job_number.trim(),
            revision.trim(),
            thickness_mills.trim(),
            manufacturing_date,
            normalizedSide,
            storage_location ? storage_location.trim() : null,
            remarks ? remarks.trim() : null,
            sessionUser.id,
            sessionUser.name
        ]);

        const savedRecord = result.rows[0];

        // 7. Audit Log Integration using database primary key id as entity_id
        await pool.query(`
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            'CREATE',
            'STENCIL_MASTER',
            savedRecord.id,
            sessionUser.name,
            `Stencil '${savedRecord.stencil_name}' registered successfully by ${sessionUser.name}.`,
            JSON.stringify(savedRecord)
        ]);

        const { stencil_id, ...cleanedRecord } = savedRecord;

        return res.status(201).json({
            message: 'Stencil Master Record Created Successfully.',
            record: cleanedRecord
        });
    } catch (err: any) {
        logger.error('Error creating stencil record:', err);
        return res.status(500).json({ message: 'Internal server error while saving stencil record.' });
    }
};

/**
 * PUT /api/smt/stencil-management/:id
 * Update an existing stencil master record (Admin/Manager only)
 */
export const updateStencilRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const {
        storage_location,
        remarks,
        status,
        revision,
        manufacturing_date,
        job_number
    } = req.body;

    const sessionUser = getSessionUser(req);

    // 1. Role verification
    if (!['Super Admin', 'Admin', 'Manager'].includes(sessionUser.role)) {
        return res.status(403).json({ message: 'Access Denied: Only Admin or SMT Manager roles are authorized to edit.' });
    }

    try {
        // 2. Fetch current record
        const findRes = await pool.query(`SELECT * FROM stencil_master WHERE id = $1 AND is_deleted = false`, [id]);
        if (findRes.rows.length === 0) {
            return res.status(404).json({ message: 'Stencil Master Record not found.' });
        }
        const oldRecord = findRes.rows[0];

        // 3. Validation
        if (status && !['ACTIVE', 'INACTIVE', 'SCRAPPED'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status value. Must be ACTIVE, INACTIVE, or SCRAPPED.' });
        }

        if (manufacturing_date) {
            const todayStr = new Date().toISOString().split('T')[0];
            if (manufacturing_date > todayStr) {
                return res.status(400).json({ message: 'Manufacturing Date cannot be a future date.' });
            }
        }

        // 4. Update fields
        const updatedStorage = storage_location !== undefined ? (storage_location ? storage_location.trim() : null) : oldRecord.storage_location;
        const updatedRemarks = remarks !== undefined ? (remarks ? remarks.trim() : null) : oldRecord.remarks;
        const updatedStatus = status || oldRecord.status;
        const updatedRevision = revision !== undefined ? revision.trim() : oldRecord.revision;
        const updatedMfgDate = manufacturing_date || oldRecord.manufacturing_date;
        const updatedJobNumber = job_number !== undefined ? job_number.trim() : oldRecord.job_number;

        if (revision !== undefined && !updatedRevision) {
            return res.status(400).json({ message: 'Revision is mandatory.' });
        }
        if (job_number !== undefined && !updatedJobNumber) {
            return res.status(400).json({ message: 'Job Number is mandatory.' });
        }

        const updateQuery = `
            UPDATE stencil_master
            SET storage_location = $1,
                remarks = $2,
                status = $3,
                revision = $4,
                manufacturing_date = $5,
                job_number = $6,
                updated_by = $7,
                updated_by_name = $8,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
            RETURNING *
        `;

        const result = await pool.query(updateQuery, [
            updatedStorage,
            updatedRemarks,
            updatedStatus,
            updatedRevision,
            updatedMfgDate,
            updatedJobNumber,
            sessionUser.id,
            sessionUser.name,
            id
        ]);

        const newRecord = result.rows[0];

        // 5. Audit Log Entry
        await pool.query(`
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            'UPDATE',
            'STENCIL_MASTER',
            oldRecord.id,
            sessionUser.name,
            `Stencil '${oldRecord.stencil_name}' updated by ${sessionUser.name}.`,
            JSON.stringify(oldRecord),
            JSON.stringify(newRecord)
        ]);

        const { stencil_id, ...cleanedRecord } = newRecord;

        return res.status(200).json({
            message: 'Stencil Master Record updated successfully.',
            record: cleanedRecord
        });
    } catch (err: any) {
        logger.error('Error updating stencil record:', err);
        return res.status(500).json({ message: 'Internal server error while updating stencil record.' });
    }
};

/**
 * DELETE /api/smt/stencil-management/:id
 * Soft delete a stencil master record (Admin only)
 */
export const deleteStencilRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const sessionUser = getSessionUser(req);

    // 1. Role verification - restrict to Super Admin only
    if (sessionUser.role !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: 'Only Super Admin is authorized to delete records.',
            error: 'Only Super Admin is authorized to delete records.'
        });
    }

    try {
        // 2. Fetch current record
        const findRes = await pool.query(`SELECT * FROM stencil_master WHERE id = $1 AND is_deleted = false`, [id]);
        if (findRes.rows.length === 0) {
            return res.status(404).json({ message: 'Stencil Master Record not found.' });
        }
        const record = findRes.rows[0];

        // 3. Perform soft delete
        await pool.query(`
            UPDATE stencil_master
            SET is_deleted = true,
                deleted_by = $1,
                deleted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [sessionUser.id, id]);

        // 4. Audit Log Entry
        await pool.query(`
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            'DELETE',
            'STENCIL_MASTER',
            record.id,
            sessionUser.name,
            `Stencil '${record.stencil_name}' soft deleted by Super Admin.`,
            JSON.stringify(record),
            JSON.stringify({
                userId: sessionUser.id,
                userName: sessionUser.name,
                userRole: sessionUser.role,
                moduleName: 'Stencil Master Record',
                recordId: id,
                timestamp: new Date().toISOString(),
                action: 'DELETE'
            })
        ]);

        return res.status(200).json({ message: 'Stencil Master Record deleted successfully.' });
    } catch (err: any) {
        logger.error('Error deleting stencil record:', err);
        return res.status(500).json({ message: 'Internal server error while deleting stencil record.' });
    }
};

/**
 * GET /api/smt/stencil-management/records
 * Fetch paginated list of active stencil master records with server-side searching & sorting
 */
export const getStencilRecords = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string || '1', 10);
        const limit = parseInt(req.query.limit as string || '10', 10);
        const search = (req.query.search as string || '').trim();
        const sortBy = (req.query.sortBy as string || 'stencil_name').trim();
        const sortOrder = (req.query.sortOrder as string || 'DESC').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const offset = (page - 1) * limit;

        // Allowed sort columns
        const allowedSortCols = [
            'job_number',
            'stencil_name',
            'revision',
            'manufacturing_date'
        ];
        const actualSortBy = allowedSortCols.includes(sortBy) ? sortBy : 'stencil_name';

        // Search filter matching: Stencil Name, Job Number, Revision
        let queryParams: any[] = [];
        let filterSql = `WHERE is_deleted = false`;

        if (search) {
            queryParams.push(`%${search}%`);
            filterSql += ` AND (
                stencil_name ILIKE $1 OR
                job_number ILIKE $1 OR
                revision ILIKE $1
            )`;
        }

        // Count total matching records
        const countQuery = `SELECT COUNT(*) FROM stencil_master ${filterSql}`;
        const countRes = await pool.query(countQuery, queryParams);
        const total = parseInt(countRes.rows[0].count, 10);

        // Fetch records
        const selectQuery = `
            SELECT * FROM stencil_master
            ${filterSql}
            ORDER BY ${actualSortBy} ${sortOrder}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;
        
        queryParams.push(limit, offset);
        const recordsRes = await pool.query(selectQuery, queryParams);

        // Sanitize records to omit stencil_id
        const sanitizedRecords = recordsRes.rows.map(row => {
            const { stencil_id, ...rest } = row;
            return rest;
        });

        return res.status(200).json({
            data: sanitizedRecords,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err: any) {
        logger.error('Error fetching stencil records:', err);
        return res.status(500).json({ message: 'Internal server error while fetching stencil records.' });
    }
};

/**
 * GET /api/smt/stencil-management/export
 * Export all active stencil master records to Excel report
 */
export const exportStencilExcel = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT * FROM stencil_master 
            WHERE is_deleted = false 
            ORDER BY stencil_name ASC
        `;
        const result = await pool.query(query);
        const records = result.rows;

        // Create workbook & worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Stencil Master Records');

        // Styles configuration
        const themeColor = '1F4E79'; // Dark Blue

        // Add title row
        worksheet.mergeCells('A1:I1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'SMT STENCIL MASTER RECORD REPORT';
        titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFF' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        titleCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: themeColor }
        };
        worksheet.getRow(1).height = 40;

        // Define column headers (Stencil ID, Created By, Created Date & Time removed)
        const columns = [
            { header: 'Stencil / Model Name', key: 'stencil_name', width: 25 },
            { header: 'Job Number', key: 'job_number', width: 20 },
            { header: 'Revision', key: 'revision', width: 10 },
            { header: 'Thickness', key: 'thickness_mills', width: 18 },
            { header: 'Manufacturing Date', key: 'manufacturing_date', width: 20 },
            { header: 'Side', key: 'side', width: 12 },
            { header: 'Storage Location', key: 'storage_location', width: 18 },
            { header: 'Remarks', key: 'remarks', width: 30 },
            { header: 'Status', key: 'status', width: 12 }
        ];

        worksheet.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width }));

        // Style header row
        const headerRow = worksheet.getRow(2);
        headerRow.height = 25;
        headerRow.eachCell((cell) => {
            cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFF' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '2F5597' } // Lighter accent blue
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: 'D9D9D9' } },
                bottom: { style: 'medium', color: { argb: '000000' } },
                left: { style: 'thin', color: { argb: 'D9D9D9' } },
                right: { style: 'thin', color: { argb: 'D9D9D9' } }
            };
        });

        // Add data rows
        records.forEach((rec, idx) => {
            const mfgDate = rec.manufacturing_date 
                ? new Date(rec.manufacturing_date).toISOString().split('T')[0] 
                : '';

            const row = worksheet.addRow({
                stencil_name: rec.stencil_name,
                job_number: rec.job_number,
                revision: rec.revision,
                thickness_mills: rec.thickness_mills,
                manufacturing_date: mfgDate,
                side: rec.side,
                storage_location: rec.storage_location || '-',
                remarks: rec.remarks || '-',
                status: rec.status
            });

            // Alignment and borders for cells
            row.eachCell((cell, colNumber) => {
                cell.font = { name: 'Arial', size: 9 };
                cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'F2F2F2' } },
                    bottom: { style: 'thin', color: { argb: 'F2F2F2' } },
                    left: { style: 'thin', color: { argb: 'F2F2F2' } },
                    right: { style: 'thin', color: { argb: 'F2F2F2' } }
                };

                // Center specific columns for neatness
                // Indices: 2 (Job Number), 3 (Revision), 4 (Thickness), 5 (Manufacturing Date), 6 (Side), 9 (Status)
                if ([2, 3, 4, 5, 6, 9].includes(colNumber)) {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }

                // Add Zebra striping
                if (idx % 2 === 1) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'F9FBFD' }
                    };
                }
            });
            row.height = 20;
        });

        // Set response headers and transmit file stream
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="SMT_Stencil_Master_Report.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error('Error exporting stencil records to Excel:', err);
        return res.status(500).json({ message: 'Internal server error while exporting excel report.' });
    }
};
