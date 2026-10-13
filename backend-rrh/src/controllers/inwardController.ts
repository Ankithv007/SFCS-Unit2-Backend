import { Request, Response } from 'express';
import { pool, getCachedWorkOrderInternalId, withTransaction } from '../utils/db';
import { createLogger } from '../utils/logger';
import { downloadWorkOrderExcel } from './masterDataController';
import { getSessionUser } from '../utils/authHelper';

const logger = createLogger('InwardController');


/**
 * GET /api/rrh/inward/eligible-work-orders
 * Return RRH work orders that are NOT currently active in Inward (In Progress, Pending, Paused)
 * and NOT completed in Inward (Completed).
 */
export const getEligibleInwardWorkOrders = async (_req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                w.id,
                w.work_order_id,
                COALESCE(w.work_order_date, w.date) as work_order_date,
                w.lot_quantity,
                w.status,
                w.created_at
            FROM rrh_work_orders w
            WHERE (w.is_deleted IS NULL OR w.is_deleted = false)
              AND NOT EXISTS (
                SELECT 1
                FROM rrh_inward_sessions s
                WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id))
                  AND s.is_deleted = false
                  AND UPPER(TRIM(s.status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')
            )
            ORDER BY w.created_at DESC, w.id DESC
        `);
        return res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error('Error in getEligibleInwardWorkOrders: ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch eligible work orders for Inward.', error: err.message });
    }
};

export const createInwardSession = async (req: Request, res: Response) => {
    const { work_order_id } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id) {
        return res.status(400).json({ message: 'work_order_id is required.' });
    }

    const cleanWoId = String(work_order_id).trim();

    try {
        const sessionData = await withTransaction(async (client) => {
            // Check if there is already an active session for this Work Order
            const activeCheck = await client.query(
                `SELECT * FROM rrh_inward_sessions 
                 WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
                   AND status IN ('Pending', 'In Progress', 'Paused') 
                   AND is_deleted = false
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [cleanWoId]
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
                return { session: existingSession, isExisting: true };
            }

            // Check if a completed session already exists for this Work Order
            const completedCheck = await client.query(
                `SELECT id FROM rrh_inward_sessions 
                 WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
                   AND status = 'Completed'
                   AND is_deleted = false`,
                [cleanWoId]
            );
            if (completedCheck.rows.length > 0) {
                const err: any = new Error(`INWARD has already been Completed for Work Order ${work_order_id}.`);
                err.statusCode = 400;
                throw err;
            }

            const woInternalId = await getCachedWorkOrderInternalId(client, work_order_id);
            const insertQuery = `
                INSERT INTO rrh_inward_sessions (
                    work_order_id, work_order_internal_id, status, created_by, created_by_name, updated_by, updated_by_name
                ) VALUES ($1, $2, 'In Progress', $3, $4, $3, $4)
                RETURNING *
            `;
            const result = await client.query(insertQuery, [work_order_id, woInternalId, operator.id || operator.name, operator.name]);
            return { session: result.rows[0], isExisting: false };
        });

        return res.status(sessionData.isExisting ? 200 : 201).json(sessionData.session);
    } catch (err: any) {
        if (err.statusCode === 400) {
            return res.status(400).json({ message: err.message });
        }
        if (err.code === '23505') {
            try {
                const fallbackCheck = await pool.query(
                    `SELECT * FROM rrh_inward_sessions 
                     WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
                       AND status IN ('Pending', 'In Progress', 'Paused') 
                       AND is_deleted = false
                     ORDER BY created_at DESC
                     LIMIT 1`,
                    [cleanWoId]
                );
                if (fallbackCheck.rows.length > 0) {
                    return res.status(200).json(fallbackCheck.rows[0]);
                }
            } catch (fallbackErr: any) {
                logger.error('Error during fallback query after 23505: ' + fallbackErr.message);
            }
        }
        logger.error('Error starting INWARD session: ' + err.message);
        return res.status(500).json({ message: 'Internal server error while starting INWARD session.' });
    }
};

export const checkBottom = async (req: Request, res: Response) => {
    const { woId } = req.params;
    try {
        const query = `
            SELECT id FROM rrh_inward_sessions 
            WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1)) 
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
