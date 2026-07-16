import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('SMT_DOWNTIME_CONTROLLER');

const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    const headerName = req.headers['x-user-name'];
    const decodedName = headerName ? decodeURIComponent(headerName as string) : null;
    return {
        id: user?.id || user?.userId || null,
        name: decodedName || user?.name || user?.email || 'Unknown User',
        role: user?.role || 'OPERATOR',
        email: user?.email || 'unknown@example.com'
    };
};

export const createDowntimeRecord = async (req: Request, res: Response) => {
    const sessionUser = getSessionUser(req);
    const {
        shift,
        line,
        machine_name,
        start_time,
        end_time,
        downtime_category,
        downtime_description,
        action_taken,
        responsible_person,
        status,
        remarks
    } = req.body;

    // Validation
    if (!shift || !line || !machine_name || !start_time || !end_time || !downtime_category || !downtime_description || !action_taken || !responsible_person || !status) {
        return res.status(400).json({ success: false, message: 'All marked fields are required.' });
    }

    const start = new Date(start_time);
    const end = new Date(end_time);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid start time or end time.' });
    }

    if (end <= start) {
        return res.status(400).json({ success: false, message: 'End Time must be greater than Start Time.' });
    }

    const duration = (end.getTime() - start.getTime()) / (1000 * 60); // Duration in minutes

    try {
        const query = `
            INSERT INTO smt_downtime_records (
                shift, line, machine_name, start_time, end_time, duration,
                downtime_category, downtime_description, action_taken,
                responsible_person, status, remarks, created_by, created_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
        `;

        const values = [
            shift,
            line,
            machine_name,
            start,
            end,
            duration,
            downtime_category,
            downtime_description,
            action_taken,
            responsible_person,
            status,
            remarks || null,
            sessionUser.email,
            sessionUser.name
        ];

        const { rows } = await pool.query(query, values);
        logger.info(`Downtime record created: ${rows[0].id} by ${sessionUser.name}`);
        return res.status(201).json({ success: true, data: rows[0] });
    } catch (err: any) {
        logger.error(`Error creating downtime record: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const getDowntimeRecords = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const search = req.query.search as string;
    const sortBy = req.query.sortBy as string;
    const sortOrder = req.query.sortOrder as 'ASC' | 'DESC';
    const offset = (page - 1) * limit;

    try {
        let whereClause = '';
        const queryParams: any[] = [];

        if (search) {
            whereClause = `
                WHERE shift ILIKE $1 
                   OR line ILIKE $1 
                   OR machine_name ILIKE $1 
                   OR downtime_category ILIKE $1 
                   OR responsible_person ILIKE $1 
                   OR status ILIKE $1
            `;
            queryParams.push(`%${search}%`);
        }

        const countQuery = `SELECT COUNT(*) FROM smt_downtime_records ${whereClause}`;
        const countRes = await pool.query(countQuery, queryParams);
        const total = parseInt(countRes.rows[0].count, 10);

        // Validate sorting column to prevent SQL injection
        const allowedSortColumns = ['shift', 'line', 'machine_name', 'downtime_category', 'start_time', 'end_time', 'duration', 'responsible_person', 'status'];
        const validSortBy = allowedSortColumns.includes(sortBy) ? sortBy : 'start_time';
        const validSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';

        const selectQuery = `
            SELECT * FROM smt_downtime_records
            ${whereClause}
            ORDER BY ${validSortBy} ${validSortOrder}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        queryParams.push(limit, offset);
        const { rows } = await pool.query(selectQuery, queryParams);

        return res.status(200).json({
            success: true,
            data: rows,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err: any) {
        logger.error(`Error fetching downtime records: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const updateDowntimeRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const sessionUser = getSessionUser(req);
    const {
        shift,
        line,
        machine_name,
        start_time,
        end_time,
        downtime_category,
        downtime_description,
        action_taken,
        responsible_person,
        status,
        remarks
    } = req.body;

    // Validation
    if (!shift || !line || !machine_name || !start_time || !end_time || !downtime_category || !downtime_description || !action_taken || !responsible_person || !status) {
        return res.status(400).json({ success: false, message: 'All marked fields are required.' });
    }

    const start = new Date(start_time);
    const end = new Date(end_time);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid start time or end time.' });
    }

    if (end <= start) {
        return res.status(400).json({ success: false, message: 'End Time must be greater than Start Time.' });
    }

    const duration = (end.getTime() - start.getTime()) / (1000 * 60); // Duration in minutes

    try {
        const checkRes = await pool.query(`SELECT id FROM smt_downtime_records WHERE id = $1`, [id]);
        if (checkRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Downtime record not found.' });
        }

        const query = `
            UPDATE smt_downtime_records
            SET shift = $1,
                line = $2,
                machine_name = $3,
                start_time = $4,
                end_time = $5,
                duration = $6,
                downtime_category = $7,
                downtime_description = $8,
                action_taken = $9,
                responsible_person = $10,
                status = $11,
                remarks = $12,
                updated_by = $13,
                updated_by_name = $14,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $15
            RETURNING *
        `;

        const values = [
            shift,
            line,
            machine_name,
            start,
            end,
            duration,
            downtime_category,
            downtime_description,
            action_taken,
            responsible_person,
            status,
            remarks || null,
            sessionUser.email,
            sessionUser.name,
            id
        ];

        const { rows } = await pool.query(query, values);
        logger.info(`Downtime record updated: ${rows[0].id} by ${sessionUser.name}`);
        return res.status(200).json({ success: true, data: rows[0] });
    } catch (err: any) {
        logger.error(`Error updating downtime record: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const deleteDowntimeRecord = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const checkRes = await pool.query(`SELECT id FROM smt_downtime_records WHERE id = $1`, [id]);
        if (checkRes.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'Downtime record not found.' });
        }

        await pool.query(`DELETE FROM smt_downtime_records WHERE id = $1`, [id]);
        logger.info(`Downtime record deleted: ${id}`);
        return res.status(200).json({ success: true, message: 'Record deleted successfully.' });
    } catch (err: any) {
        logger.error(`Error deleting downtime record: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};

export const getDowntimeDashboard = async (req: Request, res: Response) => {
    try {
        // 1. Basic Summary Metrics
        const summaryQuery = `
            SELECT 
                COALESCE(COUNT(*), 0) AS total_records,
                COALESCE(SUM(duration), 0) AS total_duration,
                COALESCE(AVG(duration), 0) AS avg_duration,
                COALESCE(SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END), 0) AS open_issues,
                COALESCE(SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END), 0) AS closed_issues
            FROM smt_downtime_records
        `;
        const summaryRes = await pool.query(summaryQuery);
        const summary = summaryRes.rows[0];

        // 2. Most Affected Machine
        const machineQuery = `
            SELECT machine_name, SUM(duration) AS total_duration
            FROM smt_downtime_records
            GROUP BY machine_name
            ORDER BY total_duration DESC
            LIMIT 1
        `;
        const machineRes = await pool.query(machineQuery);
        const mostAffectedMachine = machineRes.rows[0]?.machine_name || 'N/A';

        // 3. Most Frequent Downtime Category
        const categoryQuery = `
            SELECT downtime_category, COUNT(*) AS count
            FROM smt_downtime_records
            GROUP BY downtime_category
            ORDER BY count DESC
            LIMIT 1
        `;
        const categoryRes = await pool.query(categoryQuery);
        const mostFrequentCategory = categoryRes.rows[0]?.downtime_category || 'N/A';

        // 4. Breakdown by Category
        const categoryBreakdownQuery = `
            SELECT downtime_category AS name, SUM(duration) AS value
            FROM smt_downtime_records
            GROUP BY downtime_category
        `;
        const categoryBreakdownRes = await pool.query(categoryBreakdownQuery);

        // 5. Breakdown by Machine
        const machineBreakdownQuery = `
            SELECT machine_name AS name, SUM(duration) AS value
            FROM smt_downtime_records
            GROUP BY machine_name
        `;
        const machineBreakdownRes = await pool.query(machineBreakdownQuery);

        // 6. Breakdown by Shift
        const shiftBreakdownQuery = `
            SELECT shift AS name, SUM(duration) AS value
            FROM smt_downtime_records
            GROUP BY shift
        `;
        const shiftBreakdownRes = await pool.query(shiftBreakdownQuery);

        // 7. Status Distribution
        const statusDistributionQuery = `
            SELECT status AS name, COUNT(*) AS value
            FROM smt_downtime_records
            GROUP BY status
        `;
        const statusDistributionRes = await pool.query(statusDistributionQuery);

        return res.status(200).json({
            success: true,
            data: {
                summary: {
                    total_records: parseInt(summary.total_records, 10),
                    total_duration: parseFloat(summary.total_duration || 0),
                    avg_duration: parseFloat(summary.avg_duration || 0),
                    open_issues: parseInt(summary.open_issues, 10),
                    closed_issues: parseInt(summary.closed_issues, 10),
                    most_affected_machine: mostAffectedMachine,
                    most_frequent_category: mostFrequentCategory
                },
                charts: {
                    category: categoryBreakdownRes.rows,
                    machine: machineBreakdownRes.rows,
                    shift: shiftBreakdownRes.rows,
                    status: statusDistributionRes.rows
                }
            }
        });
    } catch (err: any) {
        logger.error(`Error getting downtime dashboard: ${err.message}`);
        return res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
};
