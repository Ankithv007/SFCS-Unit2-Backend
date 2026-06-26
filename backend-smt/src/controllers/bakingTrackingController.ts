import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('BakingTrackingController');

// Helper to get session user details
const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    const headerName = req.headers['x-user-name'];
    const decodedName = headerName ? decodeURIComponent(headerName as string) : null;
    return {
        id: user?.id || user?.userId || null,
        name: decodedName || user?.name || user?.email || 'Unknown User',
        role: user?.role || 'OPERATOR'
    };
};

/**
 * POST /api/smt/baking-tracking/create
 * Create a new Baking Tracking Record
 */
export const createBakingRecord = async (req: Request, res: Response) => {
    const {
        model_name,
        vepl_part_number,
        manufacturing_part_number,
        msl_level,
        reel_qty,
        baking_temperature,
        component_thickness,
        remarks
    } = req.body;

    const sessionUser = getSessionUser(req);

    // 1. Validation
    if (
        !model_name ||
        !vepl_part_number ||
        !manufacturing_part_number ||
        !msl_level ||
        reel_qty === undefined ||
        !baking_temperature ||
        !component_thickness
    ) {
        return res.status(400).json({ message: 'Please fill all mandatory fields.' });
    }

    const parsedReelQty = parseInt(reel_qty, 10);
    if (isNaN(parsedReelQty) || parsedReelQty <= 0) {
        return res.status(400).json({ message: 'Reel Quantity must be greater than zero.' });
    }

    try {
        const query = `
            INSERT INTO smt_baking_tracking (
                model_name,
                vepl_part_number,
                manufacturing_part_number,
                msl_level,
                reel_qty,
                baking_temperature,
                component_thickness,
                baking_in_time,
                status,
                created_by,
                created_by_name,
                remarks
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, 'Pending Baking', $8, $9, $10)
            RETURNING *
        `;

        const result = await pool.query(query, [
            model_name.trim(),
            vepl_part_number.trim(),
            manufacturing_part_number.trim(),
            msl_level.trim(),
            parsedReelQty,
            baking_temperature.trim(),
            component_thickness.trim(),
            sessionUser.id || 'system',
            sessionUser.name,
            remarks ? remarks.trim() : null
        ]);

        const savedRecord = result.rows[0];

        // Audit Log Entry
        await pool.query(`
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            'CREATE',
            'BAKING_TRACKING',
            savedRecord.id,
            sessionUser.name,
            `Baking tracking record created for model: ${savedRecord.model_name}, reel quantity: ${savedRecord.reel_qty}.`,
            JSON.stringify(savedRecord)
        ]);

        return res.status(201).json({
            message: 'Baking Tracking Record Created Successfully.',
            record: savedRecord
        });

    } catch (err: any) {
        logger.error('Error creating baking record:', err);
        return res.status(500).json({ message: 'Internal server error while creating baking tracking record.' });
    }
};

/**
 * GET /api/smt/baking-tracking/records
 * Get paginated, searchable, sorted baking tracking records
 */
export const getBakingRecords = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string || '1', 10);
        const limit = parseInt(req.query.limit as string || '10', 10);
        const search = (req.query.search as string || '').trim();
        const status = (req.query.status as string || '').trim();
        const sortBy = (req.query.sortBy as string || '').trim();
        const sortOrder = (req.query.sortOrder as string || 'DESC').trim().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const offset = (page - 1) * limit;

        // Default sort logic
        let actualSortBy = 'created_at';
        if (sortBy) {
            const allowedSortCols = [
                'model_name',
                'vepl_part_number',
                'manufacturing_part_number',
                'msl_level',
                'reel_qty',
                'baking_temperature',
                'component_thickness',
                'baking_in_time',
                'baking_out_time',
                'baking_duration',
                'status',
                'created_at'
            ];
            if (allowedSortCols.includes(sortBy)) {
                actualSortBy = sortBy;
            }
        } else {
            // Apply default sorting: completed records newest first, pending records newest first
            if (status === 'Completed Baking') {
                actualSortBy = 'baking_out_time';
            } else {
                actualSortBy = 'baking_in_time';
            }
        }

        let queryParams: any[] = [];
        let filterSql = `WHERE is_deleted = false`;

        // Filter by status if provided
        if (status) {
            queryParams.push(status);
            filterSql += ` AND status = $${queryParams.length}`;
        }

        // Search filter matching Model Name, VEPL Part Number, Manufacturing Part Number
        if (search) {
            queryParams.push(`%${search}%`);
            filterSql += ` AND (
                model_name ILIKE $${queryParams.length} OR
                vepl_part_number ILIKE $${queryParams.length} OR
                manufacturing_part_number ILIKE $${queryParams.length}
            )`;
        }

        // Count query
        const countQuery = `SELECT COUNT(*) FROM smt_baking_tracking ${filterSql}`;
        const countRes = await pool.query(countQuery, queryParams);
        const total = parseInt(countRes.rows[0].count, 10);

        // Select query
        const selectQuery = `
            SELECT * FROM smt_baking_tracking
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
        logger.error('Error fetching baking records:', err);
        return res.status(500).json({ message: 'Internal server error while fetching baking tracking records.' });
    }
};

/**
 * GET /api/smt/baking-tracking/records/:id
 * Retrieve a single record by ID
 */
export const getBakingRecordById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const query = `SELECT * FROM smt_baking_tracking WHERE id = $1 AND is_deleted = false`;
        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Baking Tracking Record not found.' });
        }

        return res.status(200).json(result.rows[0]);

    } catch (err: any) {
        logger.error('Error fetching single baking record:', err);
        return res.status(500).json({ message: 'Internal server error while fetching record details.' });
    }
};

/**
 * POST /api/smt/baking-tracking/stop/:id
 * Stop baking process and record QA approval
 */
export const stopBakingRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { approved_by_qa, remarks } = req.body;
    const sessionUser = getSessionUser(req);

    if (!approved_by_qa || !approved_by_qa.trim()) {
        return res.status(400).json({ message: 'Approved By QA is mandatory.' });
    }

    try {
        // Fetch and lock record to verify state
        const findQuery = `SELECT * FROM smt_baking_tracking WHERE id = $1 AND is_deleted = false FOR UPDATE`;
        const findRes = await pool.query(findQuery, [id]);

        if (findRes.rows.length === 0) {
            return res.status(404).json({ message: 'Baking Tracking Record not found.' });
        }

        const record = findRes.rows[0];

        if (record.status !== 'Pending Baking') {
            return res.status(400).json({ message: 'This record has already been stopped or completed.' });
        }

        const now = new Date();
        const start = new Date(record.baking_in_time);
        const durationMs = now.getTime() - start.getTime();

        // Calculate and format duration: Xh Ym Zs
        const totalSeconds = Math.floor(durationMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        let durationStr = '';
        if (hours > 0) {
            durationStr += `${hours}h `;
        }
        if (minutes > 0 || hours > 0) {
            durationStr += `${minutes}m `;
        }
        durationStr += `${seconds}s`;

        const updateQuery = `
            UPDATE smt_baking_tracking
            SET status = 'Completed Baking',
                baking_out_time = $1,
                baking_duration = $2,
                approved_by_qa = $3,
                stopped_by = $4,
                stopped_by_name = $5,
                stopped_at = $1,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = $4,
                updated_by_name = $5,
                remarks = COALESCE($6, remarks)
            WHERE id = $7
            RETURNING *
        `;

        const updateRes = await pool.query(updateQuery, [
            now,
            durationStr,
            approved_by_qa.trim(),
            sessionUser.id || 'system',
            sessionUser.name,
            remarks ? remarks.trim() : null,
            id
        ]);

        const updatedRecord = updateRes.rows[0];

        // Audit Log Entry
        await pool.query(`
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            'UPDATE',
            'BAKING_TRACKING',
            record.id,
            sessionUser.name,
            `Baking tracking record stopped and QA approved by ${approved_by_qa}. Duration: ${durationStr}.`,
            JSON.stringify(record),
            JSON.stringify(updatedRecord)
        ]);

        return res.status(200).json({
            message: 'Baking process stopped successfully.',
            record: updatedRecord
        });

    } catch (err: any) {
        logger.error('Error stopping baking record:', err);
        return res.status(500).json({ message: 'Internal server error while stopping baking process.' });
    }
};

/**
 * DELETE /api/smt/baking-tracking/records/:id
 * Soft delete a record (Super Admin only)
 */
export const deleteBakingRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const sessionUser = getSessionUser(req);

    // Verify Super Admin permission
    if (sessionUser.role !== 'Super Admin') {
        return res.status(403).json({ message: 'Access Denied: Only Super Admin is authorized to delete baking records.' });
    }

    try {
        const findRes = await pool.query(`SELECT * FROM smt_baking_tracking WHERE id = $1 AND is_deleted = false`, [id]);
        if (findRes.rows.length === 0) {
            return res.status(404).json({ message: 'Baking Tracking Record not found.' });
        }
        const record = findRes.rows[0];

        const deleteQuery = `
            UPDATE smt_baking_tracking
            SET is_deleted = true,
                deleted_by = $1,
                deleted_by_name = $2,
                deleted_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP,
                updated_by = $1,
                updated_by_name = $2
            WHERE id = $3
            RETURNING *
        `;

        const deleteRes = await pool.query(deleteQuery, [
            sessionUser.id || 'system',
            sessionUser.name,
            id
        ]);

        const deletedRecord = deleteRes.rows[0];

        // Audit Log Entry
        await pool.query(`
            INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            'DELETE',
            'BAKING_TRACKING',
            id,
            sessionUser.name,
            `Baking tracking record for model ${record.model_name} soft deleted by Super Admin ${sessionUser.name}.`,
            JSON.stringify(record)
        ]);

        return res.status(200).json({ message: 'Baking tracking record deleted successfully.' });

    } catch (err: any) {
        logger.error('Error deleting baking record:', err);
        return res.status(500).json({ message: 'Internal server error while deleting baking record.' });
    }
};
