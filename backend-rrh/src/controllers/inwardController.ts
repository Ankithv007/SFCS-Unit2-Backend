import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { pool } from '../utils/db';
import { createLogger } from '../utils/logger';
import { downloadWorkOrderExcel } from './masterDataController';

const logger = createLogger('InwardController');

export const getSessionUser = (req: Request) => {
    let user = (req as any).user;

    // Fallback: decode directly from Authorization header if not already decoded
    if (!user) {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            try {
                user = jwt.verify(token, process.env.JWT_SECRET || 'secret') as any;
                (req as any).user = user;
            } catch (e) { }
        }
    }

    const headerName = (req.headers['x-user-name'] as string)
        || (req.headers['x-username'] as string)
        || (req.headers['x-backend-user-id'] as string);

    let resolvedName = '';
    if (user) {
        if (typeof user.name === 'string' && user.name.trim().length > 0) {
            resolvedName = user.name.trim();
        } else if (typeof user.employee_code === 'string' && user.employee_code.trim().length > 0) {
            resolvedName = user.employee_code.trim();
        } else if (typeof user.employeeCode === 'string' && user.employeeCode.trim().length > 0) {
            resolvedName = user.employeeCode.trim();
        } else if (typeof user.email === 'string' && user.email.trim().length > 0) {
            resolvedName = user.email.trim();
        } else if (typeof user.username === 'string' && user.username.trim().length > 0) {
            resolvedName = user.username.trim();
        }
    }

    if (!resolvedName && headerName && typeof headerName === 'string' && headerName.trim().length > 0) {
        resolvedName = headerName.trim();
    }

    if (!resolvedName && req.body?.scanned_by && typeof req.body.scanned_by === 'string' && req.body.scanned_by.trim().length > 0) {
        resolvedName = req.body.scanned_by.trim();
    }

    if (!resolvedName) {
        resolvedName = 'Unknown User';
    }

    return {
        id: user?.id || user?.userId || null,
        name: resolvedName,
        username: resolvedName,
        role: user?.role || 'OPERATOR'
    };
};

export const createInwardSession = async (req: Request, res: Response) => {
    const { work_order_id } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id) {
        return res.status(400).json({ message: 'work_order_id is required.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if there is already an active session for this Work Order
        const activeCheck = await client.query(
            `SELECT * FROM rrh_inward_sessions 
             WHERE work_order_id = $1
               AND status IN ('Pending', 'In Progress', 'Paused') 
               AND is_deleted = false
             ORDER BY created_at DESC
             LIMIT 1`,
            [work_order_id]
        );

        if (activeCheck.rows.length > 0) {
            const existingSession = activeCheck.rows[0];
            if (existingSession.status !== 'In Progress') {
                await client.query(
                    `UPDATE rrh_inward_sessions SET status = 'In Progress', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [existingSession.id]
                );
                existingSession.status = 'In Progress';
            }
            await client.query('COMMIT');
            return res.status(200).json(existingSession);
        }

        // Check if a completed session already exists for this Work Order
        const completedCheck = await client.query(
            `SELECT id FROM rrh_inward_sessions 
             WHERE work_order_id = $1
               AND status = 'Completed'
               AND is_deleted = false`,
            [work_order_id]
        );
        if (completedCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `INWARD has already been Completed for Work Order ${work_order_id}.`
            });
        }

        const insertQuery = `
            INSERT INTO rrh_inward_sessions (
                work_order_id, status, created_by, created_by_name, updated_by, updated_by_name
            ) VALUES ($1, 'In Progress', $2, $3, $2, $3)
            RETURNING *
        `;
        const result = await client.query(insertQuery, [work_order_id, operator.id || operator.name, operator.name]);
        const session = result.rows[0];

        await client.query('COMMIT');
        return res.status(201).json(session);
    } catch (err: any) {
        await client.query('ROLLBACK');
        if (err.code === '23505') {
            try {
                const fallbackCheck = await pool.query(
                    `SELECT * FROM rrh_inward_sessions 
                     WHERE work_order_id = $1
                       AND status IN ('Pending', 'In Progress', 'Paused') 
                       AND is_deleted = false
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [work_order_id]
                );
                if (fallbackCheck.rows.length > 0) {
                    return res.status(200).json(fallbackCheck.rows[0]);
                }
            } catch (fallbackErr) {
                logger.error('Error during fallback query after 23505: ' + fallbackErr);
            }
        }
        logger.error('Error starting INWARD session: ' + err);
        return res.status(500).json({ message: 'Internal server error while starting INWARD session.' });
    } finally {
        client.release();
    }
};

export const checkBottom = async (req: Request, res: Response) => {
    const { woId } = req.params;
    try {
        const query = `
            SELECT id FROM rrh_inward_sessions 
            WHERE work_order_id = $1 
              AND LOWER(side) = 'bottom' 
              AND status = 'Completed' 
              AND is_deleted = false
            LIMIT 1
        `;
        const result = await pool.query(query, [woId]);
        if (result.rows.length > 0) {
            return res.status(200).json({ success: true, completed: true });
        } else {
            return res.status(200).json({ success: true, completed: false });
        }
    } catch (error) {
        logger.error('Error in checkBottom: ' + error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const getInwardSessions = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;

    try {
        let countQuery = `
            SELECT COUNT(ps.id) 
            FROM rrh_inward_sessions ps
            WHERE ps.is_deleted = false
        `;
        let selectQuery = `
            SELECT 
                ps.*,
                w.id as work_order_db_id,
                w.excel_filename,
                w.lot_quantity,
                COALESCE(
                    (SELECT ri.lot 
                     FROM rrh_inventory ri 
                     WHERE (ri.import_id = w.active_import_id 
                            OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id)))
                       AND ri.lot IS NOT NULL AND ri.lot != '' 
                     LIMIT 1),
                    w.lot_quantity::text
                ) as lot_number
            FROM rrh_inward_sessions ps
            LEFT JOIN rrh_work_orders w ON w.work_order_id = ps.work_order_id
            WHERE ps.is_deleted = false
        `;

        const queryParams: any[] = [];
        let filterCount = 1;

        if (status) {
            let mappedStatus = status;
            if (status === 'InProgress') {
                mappedStatus = 'In Progress';
            }
            countQuery += ` AND ps.status = $${filterCount}`;
            selectQuery += ` AND ps.status = $${filterCount}`;
            queryParams.push(mappedStatus);
            filterCount++;
        }

        if (search) {
            const searchPattern = `%${search.trim()}%`;
            countQuery += ` AND ps.work_order_id ILIKE $${filterCount}`;
            selectQuery += ` AND ps.work_order_id ILIKE $${filterCount}`;
            queryParams.push(searchPattern);
            filterCount++;
        }

        const countResult = await pool.query(countQuery, queryParams);
        const totalRows = parseInt(countResult.rows[0].count);

        selectQuery += ` ORDER BY ps.created_at DESC LIMIT $${filterCount} OFFSET $${filterCount + 1}`;
        queryParams.push(limit, offset);

        const selectResult = await pool.query(selectQuery, queryParams);

        return res.status(200).json({
            data: selectResult.rows,
            pagination: {
                total: totalRows,
                page,
                limit,
                totalPages: Math.ceil(totalRows / limit)
            }
        });
    } catch (err: any) {
        logger.error('Error fetching INWARD sessions: ' + err);
        return res.status(500).json({ message: 'Internal server error while fetching INWARD sessions.' });
    }
};

export const getSessionById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                ps.*,
                w.id as work_order_db_id,
                w.excel_filename,
                w.lot_quantity,
                COALESCE(
                    (SELECT ri.lot 
                     FROM rrh_inventory ri 
                     WHERE (ri.import_id = w.active_import_id 
                            OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id)))
                       AND ri.lot IS NOT NULL AND ri.lot != '' 
                     LIMIT 1),
                    w.lot_quantity::text
                ) as lot_number
            FROM rrh_inward_sessions ps
            LEFT JOIN rrh_work_orders w ON w.work_order_id = ps.work_order_id
            WHERE ps.id = $1 AND ps.is_deleted = false
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'INWARD session not found.' });
        }
        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error fetching INWARD session by ID: ' + err);
        return res.status(500).json({ message: 'Internal server error while fetching INWARD session.' });
    }
};

export const updateSessionStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const operator = getSessionUser(req);

    const validStatuses = ['In Progress', 'Paused', 'Completed', 'Cancelled', 'Aborted'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid session status.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const checkRes = await client.query(
            `SELECT * FROM rrh_inward_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'INWARD session not found.' });
        }
        const oldSession = checkRes.rows[0];

        const updateQuery = `
            UPDATE rrh_inward_sessions 
            SET status = $1, updated_by = $2, updated_by_name = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4 RETURNING *
        `;
        const updateRes = await client.query(updateQuery, [status, operator.name, operator.name, id]);
        const session = updateRes.rows[0];

        await client.query('COMMIT');
        return res.status(200).json(session);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error updating INWARD session status: ' + err);
        return res.status(500).json({ message: 'Internal server error while updating session status.' });
    } finally {
        client.release();
    }
};

export const downloadSessionFile = async (req: Request, res: Response) => {
    try {
        const sessionRes = await pool.query(
            `SELECT work_order_id FROM rrh_inward_sessions WHERE id = $1 AND is_deleted = false`,
            [req.params.id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'INWARD session not found.' });
        }
        req.params.id = sessionRes.rows[0].work_order_id;
        return downloadWorkOrderExcel(req, res);
    } catch (err: any) {
        logger.error('Error in downloadSessionFile: ' + err);
        return res.status(500).json({ message: 'Failed to download file.' });
    }
};
