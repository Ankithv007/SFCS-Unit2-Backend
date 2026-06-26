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

        // 5. Generate consecutive Stencil ID (format STM-000001)
        // Find max current stencil_id
        const maxIdRes = await pool.query(
            `SELECT stencil_id FROM stencil_master WHERE stencil_id LIKE 'STM-%' ORDER BY stencil_id DESC LIMIT 1`
        );
        
        let nextSeqNum = 1;
        if (maxIdRes.rows.length > 0) {
            const maxIdStr = maxIdRes.rows[0].stencil_id;
            const seqPart = maxIdStr.replace('STM-', '');
            const parsedNum = parseInt(seqPart, 10);
            if (!isNaN(parsedNum)) {
                nextSeqNum = parsedNum + 1;
            }
        }
        const generatedStencilId = `STM-${String(nextSeqNum).padStart(6, '0')}`;

        // 6. Save the record
        const insertQuery = `
            INSERT INTO stencil_master (
                stencil_id, stencil_name, job_number,
                revision, thickness_mills, manufacturing_date, side, storage_location, 
                remarks, status, created_by, created_by_name, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING *
        `;

        const result = await pool.query(insertQuery, [
            generatedStencilId,
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

        // 7. Audit Log Integration using existing framework table
        await pool.query(`
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            'CREATE',
            'STENCIL_MASTER',
            generatedStencilId,
            sessionUser.name,
            `Stencil Master Record ${generatedStencilId} registered successfully by ${sessionUser.name}.`,
            JSON.stringify(savedRecord)
        ]);

        return res.status(201).json({
            message: 'Stencil Master Record Created Successfully.',
            record: savedRecord
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
            oldRecord.stencil_id,
            sessionUser.name,
            `Stencil ${oldRecord.stencil_id} updated by ${sessionUser.name}.`,
            JSON.stringify(oldRecord),
            JSON.stringify(newRecord)
        ]);

        return res.status(200).json({
            message: 'Stencil Master Record updated successfully.',
            record: newRecord
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

    // 1. Role verification
    if (!['Super Admin', 'Admin'].includes(sessionUser.role)) {
        return res.status(403).json({ message: 'Access Denied: Only Admin roles are authorized to delete.' });
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
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            'DELETE',
            'STENCIL_MASTER',
            record.stencil_id,
            sessionUser.name,
            `Stencil ${record.stencil_id} soft deleted by ${sessionUser.name}.`,
            JSON.stringify(record)
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
        const sortBy = (req.query.sortBy as string || 'created_at').trim();
        const sortOrder = (req.query.sortOrder as string || 'DESC').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const offset = (page - 1) * limit;

        // Allowed sort columns
        const allowedSortCols = [
            'stencil_id',
            'job_number',
            'stencil_name',
            'revision',
            'manufacturing_date',
            'created_at'
        ];
        const actualSortBy = allowedSortCols.includes(sortBy) ? sortBy : 'created_at';

        // Search filter matching: Stencil ID, Unique ID, Customer, Stencil Name, Revision, Barcode, Location, Created By Name
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

        return res.status(200).json({
            data: recordsRes.rows,
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
            ORDER BY stencil_id ASC
        `;
        const result = await pool.query(query);
        const records = result.rows;

        // Create workbook & worksheet
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Stencil Master Records');

        // Styles configuration
        const themeColor = '1F4E79'; // Dark Blue

        // Add title row
        worksheet.mergeCells('A1:L1');
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

        // Define column headers
        const columns = [
            { header: 'Stencil ID', key: 'stencil_id', width: 15 },
            { header: 'Stencil / Model Name', key: 'stencil_name', width: 25 },
            { header: 'Job Number', key: 'job_number', width: 20 },
            { header: 'Revision', key: 'revision', width: 10 },
            { header: 'Thickness', key: 'thickness_mills', width: 18 },
            { header: 'Manufacturing Date', key: 'manufacturing_date', width: 20 },
            { header: 'Side', key: 'side', width: 12 },
            { header: 'Storage Location', key: 'storage_location', width: 18 },
            { header: 'Remarks', key: 'remarks', width: 30 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Created By', key: 'created_by_name', width: 20 },
            { header: 'Created Date & Time', key: 'created_at', width: 22 }
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
                
            const createdAtStr = rec.created_at
                ? new Date(rec.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })
                : '';

            const row = worksheet.addRow({
                stencil_id: rec.stencil_id,
                stencil_name: rec.stencil_name,
                job_number: rec.job_number,
                revision: rec.revision,
                thickness_mills: rec.thickness_mills,
                manufacturing_date: mfgDate,
                side: rec.side,
                storage_location: rec.storage_location || '-',
                remarks: rec.remarks || '-',
                status: rec.status,
                created_by_name: rec.created_by_name,
                created_at: createdAtStr
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
                if ([1, 3, 4, 5, 6, 7, 10, 12].includes(colNumber)) {
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
