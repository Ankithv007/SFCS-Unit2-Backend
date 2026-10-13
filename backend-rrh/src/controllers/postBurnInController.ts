import { Request, Response } from 'express';
import { pool } from '../utils/db';
import { createLogger } from '../utils/logger';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';

const logger = createLogger('RRH-POST-BURN-IN');

// ─── SKU to Band Mapping ──────────────────────────────────────────────────────
const SKU_TO_BAND_MAP: Record<string, string> = {
    '611-SKU000176-P': 'B1',
    '611-SKU000208-P': 'B28',
    '611-SKU000209-P': 'B41',
    '611-SKU000212-P': 'B1+B28',
    '611-SKU000222-P': 'B28',
    '611-SKU000223-P': 'B1+B28',
    '611-SKU000225-P': 'B5',
    '611-SKU000226-P': 'B5+B28',
    '611-SKU000227-P': 'B3',
    '611-SKU000228-P': 'B3+B28',
};

const getBandFromTpn = (tpn: string | null | undefined): string => {
    if (!tpn) return '—';
    const clean = tpn.trim().toUpperCase();
    return SKU_TO_BAND_MAP[clean] || SKU_TO_BAND_MAP[tpn.trim()] || '—';
};

// ─── Helper to parse authenticated user ──────────────────────────────────────
const getSessionUser = (req: Request): { username: string; name: string } => {
    const authHeader = req.headers.authorization;
    let username = 'system';
    let name = 'System Admin';

    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        try {
            const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            if (decoded) {
                username = decoded.username || decoded.email || decoded.id || 'system';
                name = decoded.name || decoded.full_name || decoded.username || 'System Admin';
            }
        } catch (e) {
            // Keep default
        }
    }
    return { username, name };
};


/**
 * GET /api/rrh/post-burn-in/eligible-work-orders
 * Return RRH work orders that have passed units in Hipot, and are NOT currently
 * active (In Progress, Pending, Paused) or Completed in Post Burn In.
 */
export const getEligiblePostBurnInWorkOrders = async (_req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                w.id,
                w.work_order_id,
                COALESCE(w.work_order_date, w.date) as work_order_date,
                w.lot_quantity,
                w.status,
                w.created_at,
                (
                    SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))))::int
                    FROM rrh_hipot_inspections hipot
                    LEFT JOIN rrh_hipot_sessions hipots ON hipots.id = hipot.session_id
                    WHERE UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM(w.work_order_id))
                      AND (UPPER(TRIM(hipot.status)) IN ('COMPLETED', 'PASS') OR hipot.status ILIKE '%pass%' OR hipot.status ILIKE '%complete%')
                      AND hipot.is_deleted = false
                      AND (hipots.is_deleted IS NULL OR hipots.is_deleted = false)
                ) as hipot_passed_count
            FROM rrh_work_orders w
            WHERE (w.is_deleted IS NULL OR w.is_deleted = false)
              AND NOT EXISTS (
                SELECT 1
                FROM rrh_post_burn_in_sessions s
                WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id))
                  AND s.is_deleted = false
                  AND UPPER(TRIM(s.status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')
              )
            ORDER BY w.created_at DESC, w.id DESC
        `);

        return res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error('Error in getEligiblePostBurnInWorkOrders: ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch eligible work orders for Post Burn In.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/work-orders/:woId/hipot-details
 * Returns Hipot passed count and work order details for a specific work order
 */
export const getWorkOrderHipotDetails = async (req: Request, res: Response) => {
    try {
        const { woId } = req.params;
        if (!woId) return res.status(400).json({ message: 'Work order ID required.' });

        const cleanWoId = woId.trim();
        const woRes = await pool.query(
            `SELECT id, work_order_id, COALESCE(work_order_date, date) as work_order_date, lot_quantity, status
             FROM rrh_work_orders
             WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
             LIMIT 1`,
            [cleanWoId]
        );

        const countRes = await pool.query(
            `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))))::int as count
             FROM rrh_hipot_inspections hipot
             LEFT JOIN rrh_hipot_sessions hipots ON hipots.id = hipot.session_id
             WHERE UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($1))
               AND (UPPER(TRIM(hipot.status)) IN ('COMPLETED', 'PASS') OR hipot.status ILIKE '%pass%' OR hipot.status ILIKE '%complete%')
               AND hipot.is_deleted = false
               AND (hipots.is_deleted IS NULL OR hipots.is_deleted = false)`,
            [cleanWoId]
        );

        const wo = woRes.rows[0] || null;
        const hipotPassedCount = countRes.rows[0]?.count || 0;

        return res.status(200).json({
            success: true,
            data: {
                work_order_id: wo?.work_order_id || cleanWoId,
                work_order_date: wo?.work_order_date || null,
                lot_quantity: Number(wo?.lot_quantity) || 0,
                hipot_passed_count: hipotPassedCount
            }
        });
    } catch (err: any) {
        logger.error(`Error in getWorkOrderHipotDetails: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch Hipot details.', error: err.message });
    }
};

/**
 * POST /api/rrh/post-burn-in/sessions
 * Start or resume a Post Burn In session
 */
export const createPostBurnInSession = async (req: Request, res: Response) => {
    const { work_order_id } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id) {
        return res.status(400).json({ message: 'work_order_id is required.' });
    }

    const cleanWo = work_order_id.trim();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if an active session already exists for this Work Order
        const activeCheck = await client.query(
            `SELECT * FROM rrh_post_burn_in_sessions 
             WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
               AND status IN ('Pending', 'In Progress', 'Paused') 
               AND is_deleted = false
             ORDER BY created_at DESC 
             LIMIT 1`,
            [cleanWo]
        );

        if (activeCheck.rows.length > 0) {
            const existing = activeCheck.rows[0];
            if (existing.status !== 'In Progress') {
                await client.query(
                    `UPDATE rrh_post_burn_in_sessions SET status = 'In Progress', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [existing.id]
                );
                existing.status = 'In Progress';
            }
            await client.query('COMMIT');
            return res.status(200).json(existing);
        }

        // Create new Post Burn In session
        const insertRes = await client.query(
            `INSERT INTO rrh_post_burn_in_sessions (
                work_order_id, 
                status, 
                created_by, 
                created_by_name
             ) VALUES ($1, 'In Progress', $2, $3)
             RETURNING *`,
            [cleanWo, operator.username, operator.name]
        );

        await client.query('COMMIT');
        logger.info(`Started new Post Burn In session ID ${insertRes.rows[0].id} for Work Order ${work_order_id}`);
        return res.status(201).json(insertRes.rows[0]);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in createPostBurnInSession: ${err.message}`);
        return res.status(500).json({ message: 'Failed to create Post Burn In session.', error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions
 * List Post Burn In sessions with status, search and pagination
 */
export const getPostBurnInSessions = async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.max(1, parseInt(req.query.limit as string) || 5);
        const offset = (page - 1) * limit;
        const search = (req.query.search as string || '').trim();
        const status = (req.query.status as string || '').trim();

        const queryParams: any[] = [];
        let whereClauses: string[] = ['s.is_deleted = false'];

        if (search) {
            queryParams.push(`%${search}%`);
            whereClauses.push(`s.work_order_id ILIKE $${queryParams.length}`);
        }

        if (status && status !== 'ALL') {
            const statuses = (status as string).split(',').map((s: string) => s.trim()).filter(Boolean);
            if (statuses.length === 1) {
                queryParams.push(statuses[0]);
                whereClauses.push(`s.status = $${queryParams.length}`);
            } else if (statuses.length > 1) {
                queryParams.push(statuses);
                whereClauses.push(`s.status = ANY($${queryParams.length})`);
            }
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const countQuery = `SELECT COUNT(*)::int as total FROM rrh_post_burn_in_sessions s ${whereSql}`;
        const countRes = await pool.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        const dataQuery = `
            SELECT 
                s.*,
                w.lot_quantity,
                w.work_order_date,
                w.date,
                COALESCE((
                    SELECT COUNT(*)::int 
                    FROM rrh_post_burn_in_inspections insp 
                    WHERE insp.session_id = s.id 
                      AND insp.is_deleted = false 
                      AND (UPPER(TRIM(insp.status)) IN ('COMPLETED', 'PASS') OR insp.status ILIKE '%pass%' OR insp.status ILIKE '%complete%')
                ), 0) as completed_count,
                COALESCE((
                    SELECT COUNT(*)::int 
                    FROM rrh_post_burn_in_inspections insp 
                    WHERE insp.session_id = s.id 
                      AND insp.is_deleted = false 
                      AND UPPER(TRIM(insp.status)) = 'FAIL'
                ), 0) as failed_count,
                COALESCE((
                    SELECT COUNT(*)::int 
                    FROM rrh_post_burn_in_inspections insp 
                    WHERE insp.session_id = s.id 
                      AND insp.is_deleted = false 
                      AND (insp.debug_status IS NOT NULL OR insp.is_reinspected = true OR insp.defect_fixed IS NOT NULL)
                ), 0) as debug_count
            FROM rrh_post_burn_in_sessions s
            LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
            ${whereSql}
            ORDER BY s.created_at DESC, s.id DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        const dataRes = await pool.query(dataQuery, [...queryParams, limit, offset]);

        return res.status(200).json({
            sessions: dataRes.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1
        });
    } catch (err: any) {
        logger.error(`Error in getPostBurnInSessions: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch Post Burn In sessions.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id
 * Retrieve session info and live statistics
 */
export const getPostBurnInSessionById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const sessionRes = await pool.query(
            `SELECT s.*, 
                    w.lot_quantity, 
                    w.work_order_date, 
                    w.date,
                    (
                        SELECT ri.lot 
                        FROM rrh_inventory ri 
                        WHERE ri.import_id = w.active_import_id 
                           OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id))
                        LIMIT 1
                    ) as lot_number
             FROM rrh_post_burn_in_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Post Burn In session not found.' });
        }

        const session = sessionRes.rows[0];

        // Fetch Hipot passed count and aggregated Post Burn In session stats concurrently
        const [hipotPassedRes, postBiStatsRes] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int as total
                 FROM rrh_hipot_inspections hipot
                 LEFT JOIN rrh_hipot_sessions hipots ON hipots.id = hipot.session_id
                 WHERE UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(hipot.status)) IN ('COMPLETED', 'PASS') OR hipot.status ILIKE '%pass%' OR hipot.status ILIKE '%complete%')
                   AND hipot.is_deleted = false
                   AND (hipots.is_deleted IS NULL OR hipots.is_deleted = false)`,
                [session.work_order_id]
            ),
            pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PASS'))::int AS completed,
                    COUNT(*) FILTER (WHERE status = 'FAIL')::int AS failed,
                    COUNT(*) FILTER (WHERE debug_status IS NOT NULL OR is_reinspected = true OR defect_fixed IS NOT NULL)::int AS debug_count,
                    COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PASS') AND is_reinspected = true)::int AS edited_pass
                 FROM rrh_post_burn_in_inspections
                 WHERE session_id = $1 AND is_deleted = false`,
                [id]
            )
        ]);

        const hipotPassedCount = hipotPassedRes.rows[0]?.total || 0;
        const statsRow = postBiStatsRes.rows[0] || {};
        const completedCount = statsRow.completed || 0;
        const failedCount = statsRow.failed || 0;
        const debugCount = statsRow.debug_count || 0;
        const editedPassCount = statsRow.edited_pass || 0;

        const lotQuantity = session.lot_quantity || 0;
        const pending = Math.max(0, (lotQuantity || hipotPassedCount) - completedCount);

        return res.status(200).json({
            session,
            stats: {
                lotQuantity,
                hipotPassed: hipotPassedCount,
                totalScanned: completedCount + failedCount,
                completed: completedCount,
                passed: completedCount,
                failed: failedCount,
                debug: debugCount,
                pending,
                editedPass: editedPassCount
            }
        });
    } catch (err: any) {
        logger.error(`Error in getPostBurnInSessionById: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch Post Burn In session details.', error: err.message });
    }
};

/**
 * PATCH /api/rrh/post-burn-in/sessions/:id/status
 * Update session status (e.g. Completed, Paused, In Progress)
 */
export const updatePostBurnInSessionStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const operator = getSessionUser(req);

    if (!status) {
        return res.status(400).json({ message: 'status is required.' });
    }

    try {
        const updateRes = await pool.query(
            `UPDATE rrh_post_burn_in_sessions 
             SET status = $1, 
                 updated_by = $2, 
                 updated_by_name = $3, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = $4 AND is_deleted = false
             RETURNING *`,
            [status, operator.username, operator.name, id]
        );

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ message: 'Post Burn In session not found.' });
        }

        return res.status(200).json(updateRes.rows[0]);
    } catch (err: any) {
        logger.error(`Error in updatePostBurnInSessionStatus: ${err.message}`);
        return res.status(500).json({ message: 'Failed to update Post Burn In session status.', error: err.message });
    }
};

/**
 * DELETE /api/rrh/post-burn-in/sessions/:id
 * Soft delete a Post Burn In session
 */
export const deletePostBurnInSession = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        const delRes = await pool.query(
            `UPDATE rrh_post_burn_in_sessions 
             SET is_deleted = true, 
                 deleted_by = $1, 
                 deleted_by_name = $2, 
                 deleted_at = CURRENT_TIMESTAMP 
             WHERE id = $3 AND is_deleted = false
             RETURNING id`,
            [operator.username, operator.name, id]
        );

        if (delRes.rows.length === 0) {
            return res.status(404).json({ message: 'Post Burn In session not found.' });
        }

        // Soft-delete child inspections of this session
        await pool.query(
            `UPDATE rrh_post_burn_in_inspections 
             SET is_deleted = true, 
                 deleted_by = $1, 
                 deleted_at = CURRENT_TIMESTAMP 
             WHERE session_id = $2 AND is_deleted = false`,
            [operator.username, id]
        );

        return res.status(200).json({ success: true, message: 'Post Burn In session deleted successfully.' });
    } catch (err: any) {
        logger.error(`Error in deletePostBurnInSession: ${err.message}`);
        return res.status(500).json({ message: 'Failed to delete Post Burn In session.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id/remaining-master-data
 * Fetch units passed from Hipot that are ready for Post Burn In and have not yet been inspected in this Post Burn In session.
 */
export const getRemainingHipotMasterData = async (req: Request, res: Response) => {
    const { id } = req.params;
    const search = (req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * limit;

    try {
        const sessionRes = await pool.query(
            `SELECT work_order_id FROM rrh_post_burn_in_sessions WHERE id = $1 AND is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Post Burn In session not found.' });
        }

        const woId = sessionRes.rows[0].work_order_id;

        const queryParams: any[] = [woId, id];
        let searchClause = '';
        if (search) {
            queryParams.push(`%${search}%`);
            searchClause = `
                AND (
                    hipot.serial_number ILIKE $${queryParams.length}
                    OR hipot.band_serial_no ILIKE $${queryParams.length}
                    OR hipot.physical_tpn ILIKE $${queryParams.length}
                    OR hipot.duplexer_main ILIKE $${queryParams.length}
                    OR hipot.duplexer_part_no ILIKE $${queryParams.length}
                    OR hipot.tejas_dc_no ILIKE $${queryParams.length}
                    OR hipot.tejas_obd_no ILIKE $${queryParams.length}
                    OR hipot.lot ILIKE $${queryParams.length}
                    OR hipot.rrh_unit ILIKE $${queryParams.length}
                    OR hipot.sl_no ILIKE $${queryParams.length}
                )
            `;
        }

        // Base CTE to get the latest Hipot inspection per physical unit
        const cteQuery = `
            WITH latest_hipot AS (
                SELECT DISTINCT ON (UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))))
                    hipot.id as hipot_id,
                    hipot.pre_burn_in_inspection_id,
                    hipot.programming_inspection_id,
                    hipot.ipqc_inspection_id,
                    hipot.ivi_inspection_id,
                    COALESCE(
                        hipot.sl_no,
                        pbi.sl_no,
                        prog.sl_no,
                        ipqc.sl_no,
                        ivi.sl_no,
                        (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE ins.id = ivi.inward_scan_id LIMIT 1),
                        (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(hipot.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(hipot.serial_number)) LIMIT 1),
                        (SELECT ri.sl_no FROM rrh_inventory ri WHERE UPPER(TRIM(ri.band_serial_no)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))) LIMIT 1)
                    ) as sl_no,
                    hipot.work_order_id,
                    hipot.serial_number,
                    COALESCE(hipot.band_serial_no, hipot.serial_number) as band_serial_no,
                    hipot.physical_serial_number,
                    hipot.physical_tpn,
                    hipot.band,
                    hipot.status as hipot_status,
                    hipot.remarks,
                    hipot.scanned_at as hipot_scanned_at,
                    hipot.scanned_by as hipot_scanned_by,
                    hipot.e_label,
                    hipot.pam_tpn,
                    hipot.pam1,
                    hipot.pam2,
                    hipot.pam3,
                    hipot.pam4,
                    hipot.rfpc_tpn,
                    hipot.rfpc_sl_no,
                    ivi.duplexer_main,
                    ivi.duplexer_part_no,
                    ivi.rrh_unit,
                    ivi.tejas_dc_no,
                    ivi.tejas_obd_no,
                    ivi.bat_lot_no as lot,
                    ivi.bat_lot_no
                FROM rrh_hipot_inspections hipot
                LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = hipot.pre_burn_in_inspection_id
                LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(hipot.programming_inspection_id, pbi.programming_inspection_id)
                LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
                LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
                WHERE (UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($1)) OR UPPER(TRIM(COALESCE(pbi.work_order_id, ''))) = UPPER(TRIM($1)) OR UPPER(TRIM(COALESCE(prog.work_order_id, ''))) = UPPER(TRIM($1)) OR UPPER(TRIM(COALESCE(ivi.work_order_id, ''))) = UPPER(TRIM($1)))
                  AND (UPPER(TRIM(hipot.status)) IN ('COMPLETED', 'PASS') OR hipot.status ILIKE '%pass%' OR hipot.status ILIKE '%complete%')
                  AND hipot.is_deleted = false
                ORDER BY UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))), hipot.scanned_at DESC, hipot.id DESC
            )
        `;

        // Count total remaining units
        const countQuery = `
            ${cteQuery}
            SELECT COUNT(*)::int as total
            FROM latest_hipot hipot
            WHERE NOT EXISTS (
                SELECT 1 FROM rrh_post_burn_in_inspections post_bi
                JOIN rrh_post_burn_in_sessions s ON s.id = post_bi.session_id AND s.is_deleted = false
                WHERE (post_bi.session_id = $2 OR UPPER(TRIM(post_bi.work_order_id)) = UPPER(TRIM($1)))
                  AND post_bi.is_deleted = false
                  AND (
                      post_bi.hipot_inspection_id = hipot.hipot_id
                      OR (post_bi.serial_number IS NOT NULL AND (
                          UPPER(TRIM(post_bi.serial_number)) = UPPER(TRIM(COALESCE(hipot.serial_number, '')))
                          OR UPPER(TRIM(post_bi.serial_number)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, '')))
                      ))
                      OR (post_bi.band_serial_no IS NOT NULL AND (
                          UPPER(TRIM(post_bi.band_serial_no)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, '')))
                          OR UPPER(TRIM(post_bi.band_serial_no)) = UPPER(TRIM(COALESCE(hipot.serial_number, '')))
                      ))
                      OR (post_bi.physical_serial_number IS NOT NULL AND (
                          UPPER(TRIM(post_bi.physical_serial_number)) = UPPER(TRIM(COALESCE(hipot.serial_number, '')))
                          OR UPPER(TRIM(post_bi.physical_serial_number)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, '')))
                      ))
                  )
            )
            ${searchClause}
        `;

        const countRes = await pool.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        // Fetch paginated data
        const dataQuery = `
            ${cteQuery}
            SELECT 
                hipot.hipot_id,
                hipot.pre_burn_in_inspection_id as pbi_id,
                hipot.programming_inspection_id as prog_id,
                hipot.ipqc_inspection_id as ipqc_id,
                hipot.ivi_inspection_id as ivi_id,
                hipot.sl_no,
                hipot.work_order_id,
                hipot.serial_number,
                hipot.band_serial_no,
                hipot.physical_serial_number,
                hipot.physical_tpn,
                hipot.band,
                hipot.duplexer_main,
                hipot.duplexer_part_no,
                hipot.rrh_unit,
                hipot.hipot_status,
                hipot.tejas_dc_no,
                hipot.tejas_obd_no,
                hipot.lot,
                hipot.bat_lot_no,
                hipot.remarks,
                hipot.hipot_scanned_at as scanned_at,
                hipot.hipot_scanned_at,
                hipot.e_label,
                hipot.pam_tpn,
                hipot.pam1,
                hipot.pam2,
                hipot.pam3,
                hipot.pam4,
                hipot.rfpc_tpn,
                hipot.rfpc_sl_no
            FROM latest_hipot hipot
            WHERE NOT EXISTS (
                SELECT 1 FROM rrh_post_burn_in_inspections post_bi
                JOIN rrh_post_burn_in_sessions s ON s.id = post_bi.session_id AND s.is_deleted = false
                WHERE (post_bi.session_id = $2 OR UPPER(TRIM(post_bi.work_order_id)) = UPPER(TRIM($1)))
                  AND post_bi.is_deleted = false
                  AND (
                      post_bi.hipot_inspection_id = hipot.hipot_id
                      OR (post_bi.serial_number IS NOT NULL AND (
                          UPPER(TRIM(post_bi.serial_number)) = UPPER(TRIM(COALESCE(hipot.serial_number, '')))
                          OR UPPER(TRIM(post_bi.serial_number)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, '')))
                      ))
                      OR (post_bi.band_serial_no IS NOT NULL AND (
                          UPPER(TRIM(post_bi.band_serial_no)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, '')))
                          OR UPPER(TRIM(post_bi.band_serial_no)) = UPPER(TRIM(COALESCE(hipot.serial_number, '')))
                      ))
                      OR (post_bi.physical_serial_number IS NOT NULL AND (
                          UPPER(TRIM(post_bi.physical_serial_number)) = UPPER(TRIM(COALESCE(hipot.serial_number, '')))
                          OR UPPER(TRIM(post_bi.physical_serial_number)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, '')))
                      ))
                  )
            )
            ${searchClause}
            ORDER BY hipot.hipot_scanned_at DESC, hipot.hipot_id DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        const dataRes = await pool.query(dataQuery, [...queryParams, limit, offset]);

        return res.status(200).json({
            success: true,
            data: dataRes.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1
        });
    } catch (err: any) {
        logger.error('Error fetching remaining Hipot master data for Post Burn In: ' + err);
        return res.status(500).json({ message: 'Internal server error while fetching remaining units.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/lookup
 * Query unit details by serial number from Hipot passed inspections
 */
export const lookupSerialDetails = async (req: Request, res: Response) => {
    const { serial, work_order_id, session_id } = req.query;

    if (!serial || typeof serial !== 'string' || !serial.trim()) {
        return res.status(400).json({ message: 'serial query parameter is required.' });
    }

    const cleanSerial = serial.trim().toUpperCase();
    const woId = typeof work_order_id === 'string' ? work_order_id.trim() : '';

    try {
        let hipotQuery = `
            SELECT 
                hipot.id as hipot_id,
                hipot.pre_burn_in_inspection_id,
                hipot.programming_inspection_id,
                hipot.ipqc_inspection_id,
                hipot.ivi_inspection_id,
                COALESCE(
                    hipot.sl_no,
                    pbi.sl_no,
                    prog.sl_no,
                    ipqc.sl_no,
                    ivi.sl_no,
                    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE ins.id = ivi.inward_scan_id LIMIT 1),
                    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(hipot.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(hipot.serial_number)) LIMIT 1),
                    (SELECT ri.sl_no FROM rrh_inventory ri WHERE UPPER(TRIM(ri.band_serial_no)) = UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))) LIMIT 1)
                ) as sl_no,
                hipot.work_order_id,
                hipot.serial_number,
                COALESCE(hipot.band_serial_no, hipot.serial_number) as band_serial_no,
                hipot.physical_serial_number,
                hipot.physical_tpn,
                hipot.band,
                ivi.wo_date,
                ivi.tejas_dc_no,
                ivi.tejas_obd_no,
                ivi.bat_lot_no,
                ivi.duplexer_main,
                ivi.duplexer_part_no,
                ivi.rrh_unit,
                hipot.status as hipot_status,
                hipot.scanned_by as hipot_inspected_by,
                hipot.remarks as hipot_remarks,
                hipot.e_label,
                hipot.pam_tpn,
                hipot.pam1,
                hipot.pam2,
                hipot.pam3,
                hipot.pam4,
                hipot.rfpc_tpn,
                hipot.rfpc_sl_no
            FROM rrh_hipot_inspections hipot
            LEFT JOIN rrh_hipot_sessions hipots ON hipots.id = hipot.session_id
            LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = hipot.pre_burn_in_inspection_id
            LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(hipot.programming_inspection_id, pbi.programming_inspection_id)
            LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
            LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
            WHERE (
                UPPER(TRIM(hipot.serial_number)) = $1
                OR UPPER(TRIM(COALESCE(hipot.band_serial_no, ''))) = $1
                OR UPPER(TRIM(COALESCE(hipot.physical_serial_number, ''))) = $1
            )
              AND (UPPER(TRIM(hipot.status)) IN ('COMPLETED', 'PASS') OR hipot.status ILIKE '%pass%' OR hipot.status ILIKE '%complete%')
              AND hipot.is_deleted = false
              AND (hipots.is_deleted IS NULL OR hipots.is_deleted = false)
        `;

        const queryParams: any[] = [cleanSerial];
        if (woId) {
            hipotQuery += ` AND (UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($2)) OR UPPER(TRIM(COALESCE(pbi.work_order_id, ''))) = UPPER(TRIM($2)) OR UPPER(TRIM(COALESCE(prog.work_order_id, ''))) = UPPER(TRIM($2)) OR UPPER(TRIM(COALESCE(ivi.work_order_id, ''))) = UPPER(TRIM($2)))`;
            queryParams.push(woId);
        }

        hipotQuery += ` ORDER BY hipot.scanned_at DESC, hipot.id DESC LIMIT 1`;
        const result = await pool.query(hipotQuery, queryParams);

        if (result.rows.length === 0) {
            return res.status(200).json({
                found: false,
                message: `Unit "${cleanSerial}" not found in passed RRH Hipot inspections.`
            });
        }

        const item = result.rows[0];

        // Check if already inspected in Post Burn In
        let alreadyInspected = false;
        let previousInspection = null;

        if (session_id) {
            const checkRes = await pool.query(
                `SELECT id, status, remarks, scanned_at, scanned_by, checkpoints, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no, e_label, inspection_date, sl_no
                 FROM rrh_post_burn_in_inspections
                 WHERE session_id = $1
                   AND (UPPER(TRIM(serial_number)) = $2 OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = $2)
                   AND is_deleted = false
                 ORDER BY id DESC LIMIT 1`,
                [session_id, cleanSerial]
            );
            if (checkRes.rows.length > 0) {
                alreadyInspected = true;
                previousInspection = checkRes.rows[0];
            }
        }

        return res.status(200).json({
            found: true,
            ...item,
            band: item.band || getBandFromTpn(item.physical_tpn),
            already_inspected: alreadyInspected,
            previous_inspection: previousInspection
        });
    } catch (err: any) {
        logger.error(`Error in lookupSerialDetails: ${err.message}`);
        return res.status(500).json({ message: 'Internal error during serial lookup.', error: err.message });
    }
};

/**
 * POST /api/rrh/post-burn-in/sessions/:id/inspections
 * Submit a Post Burn In inspection record
 */
export const submitInspection = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const operator = getSessionUser(req);

    let {
        work_order_id,
        serial_number,
        band_serial_no,
        physical_serial_number,
        physical_tpn,
        band,
        inspection_date,
        e_label,
        pam_tpn,
        pam1,
        pam2,
        pam3,
        pam4,
        rfpc_tpn,
        rfpc_sl_no,
        remarks,
        hipot_inspection_id,
        pre_burn_in_inspection_id,
        programming_inspection_id,
        ipqc_inspection_id,
        ivi_inspection_id,
        checkpoints,
        sl_no,
        status: statusInput
    } = req.body;

    const cleanSerial = (serial_number || band_serial_no || '').trim().toUpperCase();
    const cleanBandSerial = (band_serial_no || serial_number || '').trim().toUpperCase();

    if (!cleanSerial) {
        return res.status(400).json({ message: 'serial_number or band_serial_no is required.' });
    }

    if (!work_order_id && sessionId) {
        const sRes = await pool.query(`SELECT work_order_id FROM rrh_post_burn_in_sessions WHERE id = $1`, [sessionId]);
        if (sRes.rows.length > 0) {
            work_order_id = sRes.rows[0].work_order_id;
        }
    }

    if (!work_order_id) {
        return res.status(400).json({ message: 'work_order_id is required.' });
    }

    const cleanWo = String(work_order_id).trim();

    // Determine final status
    const normalizedStatus = String(statusInput || '').toUpperCase().trim();
    let finalStatus = normalizedStatus === 'FAIL' ? 'FAIL' : 'COMPLETED';

    if (checkpoints) {
        try {
            const cpList = typeof checkpoints === 'string' ? JSON.parse(checkpoints) : checkpoints;
            if (Array.isArray(cpList) && cpList.some((c: any) => c.status === 'FAIL' || c.selectedStatus === 'FAIL' || c.confirmedStatus === 'FAIL')) {
                finalStatus = 'FAIL';
            }
        } catch { }
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if there was a previous failed inspection for this serial in this session
        const prevInspectionRes = await client.query(
            `SELECT id, status, remarks, is_reinspected, defect_fixed 
             FROM rrh_post_burn_in_inspections 
             WHERE session_id = $1 
               AND (UPPER(TRIM(serial_number)) = $2 OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = $2)
               AND is_deleted = false
             ORDER BY id DESC LIMIT 1`,
            [sessionId, cleanSerial]
        );

        let isReinspected = false;
        let defectFixed = null;

        if (prevInspectionRes.rows.length > 0) {
            const prev = prevInspectionRes.rows[0];
            if (prev.status === 'FAIL') {
                isReinspected = true;
                if (finalStatus === 'COMPLETED') {
                    defectFixed = prev.remarks || 'Defect resolved upon re-inspection.';
                }
                // Soft delete previous failure so the new inspection takes precedence
                await client.query(
                    `UPDATE rrh_post_burn_in_inspections SET is_deleted = true WHERE id = $1`,
                    [prev.id]
                );
            }
        }

        let resolvedSlNo = sl_no;
        if (!hipot_inspection_id) {
            const hipotLookup = await client.query(
                `SELECT id, pre_burn_in_inspection_id, programming_inspection_id, ipqc_inspection_id, ivi_inspection_id, sl_no, e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no, physical_serial_number, physical_tpn, band
                 FROM rrh_hipot_inspections
                 WHERE (UPPER(TRIM(serial_number)) = $1 OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = $1 OR UPPER(TRIM(COALESCE(physical_serial_number, ''))) = $1)
                   AND (UPPER(TRIM(status)) IN ('COMPLETED', 'PASS') OR status ILIKE '%pass%' OR status ILIKE '%complete%')
                   AND is_deleted = false
                 ORDER BY scanned_at DESC, id DESC LIMIT 1`,
                [cleanSerial]
            );
            if (hipotLookup.rows.length > 0) {
                const hipot = hipotLookup.rows[0];
                hipot_inspection_id = hipot.id;
                pre_burn_in_inspection_id = pre_burn_in_inspection_id || hipot.pre_burn_in_inspection_id;
                programming_inspection_id = programming_inspection_id || hipot.programming_inspection_id;
                ipqc_inspection_id = ipqc_inspection_id || hipot.ipqc_inspection_id;
                ivi_inspection_id = ivi_inspection_id || hipot.ivi_inspection_id;
                if (!resolvedSlNo) resolvedSlNo = hipot.sl_no;
                if (!physical_serial_number) physical_serial_number = hipot.physical_serial_number;
                if (!physical_tpn) physical_tpn = hipot.physical_tpn;
                if (!band) band = hipot.band;
                if (!e_label) e_label = hipot.e_label;
                if (!pam_tpn) pam_tpn = hipot.pam_tpn;
                if (!pam1) pam1 = hipot.pam1;
                if (!pam2) pam2 = hipot.pam2;
                if (!pam3) pam3 = hipot.pam3;
                if (!pam4) pam4 = hipot.pam4;
                if (!rfpc_tpn) rfpc_tpn = hipot.rfpc_tpn;
                if (!rfpc_sl_no) rfpc_sl_no = hipot.rfpc_sl_no;
            }
        }

        if (!resolvedSlNo) {
            const slRes = await client.query(
                `SELECT COALESCE(
                    hipot.sl_no,
                    pbi.sl_no,
                    prog.sl_no,
                    ipqc.sl_no,
                    ivi.sl_no,
                    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE ins.id = ivi.inward_scan_id LIMIT 1),
                    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE UPPER(TRIM(ins.serial_number)) = UPPER(TRIM($1)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM($1)) LIMIT 1),
                    (SELECT ri.sl_no FROM rrh_inventory ri WHERE UPPER(TRIM(ri.band_serial_no)) = UPPER(TRIM($1)) LIMIT 1)
                 ) as sl_no
                 FROM rrh_hipot_inspections hipot
                 LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = hipot.pre_burn_in_inspection_id
                 LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(hipot.programming_inspection_id, pbi.programming_inspection_id)
                 LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
                 LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
                 WHERE (hipot.id = $2 OR UPPER(TRIM(hipot.serial_number)) = $1 OR UPPER(TRIM(COALESCE(hipot.band_serial_no, ''))) = $1)
                   AND hipot.is_deleted = false
                 ORDER BY (CASE WHEN hipot.id = $2 THEN 1 ELSE 0 END) DESC, hipot.scanned_at DESC, hipot.id DESC LIMIT 1`,
                [cleanSerial, hipot_inspection_id || 0]
            );
            resolvedSlNo = slRes.rows[0]?.sl_no || null;
        }

        const cleanInspectionDate = inspection_date ? String(inspection_date).split('T')[0] : new Date().toISOString().split('T')[0];

        const insertQuery = `
            INSERT INTO rrh_post_burn_in_inspections (
                session_id,
                work_order_id,
                serial_number,
                band_serial_no,
                physical_serial_number,
                physical_tpn,
                band,
                inspection_date,
                e_label,
                pam_tpn,
                pam1,
                pam2,
                pam3,
                pam4,
                rfpc_tpn,
                rfpc_sl_no,
                status,
                remarks,
                scanned_by,
                hipot_inspection_id,
                pre_burn_in_inspection_id,
                programming_inspection_id,
                ipqc_inspection_id,
                ivi_inspection_id,
                checkpoints,
                is_reinspected,
                defect_fixed,
                sl_no,
                debug_status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, 
                $8::date, 
                $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
            ) RETURNING *
        `;

        const insertRes = await client.query(insertQuery, [
            sessionId,
            cleanWo,
            cleanSerial,
            cleanBandSerial,
            physical_serial_number || null,
            physical_tpn || null,
            band || getBandFromTpn(physical_tpn),
            cleanInspectionDate,
            e_label || null,
            pam_tpn || null,
            pam1 || null,
            pam2 || null,
            pam3 || null,
            pam4 || null,
            rfpc_tpn || null,
            rfpc_sl_no || null,
            finalStatus,
            remarks || (finalStatus === 'FAIL' ? 'Post Burn In Verification Failed' : null),
            operator.name || operator.username || 'System Admin',
            hipot_inspection_id || null,
            pre_burn_in_inspection_id || null,
            programming_inspection_id || null,
            ipqc_inspection_id || null,
            ivi_inspection_id || null,
            checkpoints ? (typeof checkpoints === 'string' ? checkpoints : JSON.stringify(checkpoints)) : null,
            isReinspected,
            defectFixed,
            resolvedSlNo || null,
            finalStatus === 'FAIL' ? 'PENDING' : null
        ]);

        await client.query('COMMIT');
        logger.info(`Post Burn In inspection submitted for unit ${cleanSerial} with status ${finalStatus}`);
        return res.status(201).json({ success: true, data: insertRes.rows[0] });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in submitInspection: ${err.message}`);
        return res.status(500).json({ message: 'Failed to submit Post Burn In inspection.', error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id/inspections
 * Scanned product logs table
 */
export const getScannedInspections = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const search = (req.query.search as string || '').trim();
    const statusParam = (req.query.status as string || '').trim().toUpperCase();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * limit;

    try {
        const queryParams: any[] = [sessionId];
        let searchClause = '';

        if (statusParam && statusParam !== 'ALL') {
            if (statusParam === 'PASS') {
                queryParams.push('COMPLETED');
                queryParams.push('PASS');
                searchClause += ` AND p.status IN ($${queryParams.length - 1}, $${queryParams.length})`;
            } else {
                queryParams.push(statusParam);
                searchClause += ` AND p.status = $${queryParams.length}`;
            }
        }

        if (search) {
            queryParams.push(`%${search}%`);
            searchClause += `
                AND (
                    p.serial_number ILIKE $${queryParams.length}
                    OR p.band_serial_no ILIKE $${queryParams.length}
                    OR p.physical_tpn ILIKE $${queryParams.length}
                    OR p.e_label ILIKE $${queryParams.length}
                    OR p.pam_tpn ILIKE $${queryParams.length}
                    OR p.pam1 ILIKE $${queryParams.length}
                    OR p.pam2 ILIKE $${queryParams.length}
                    OR p.pam3 ILIKE $${queryParams.length}
                    OR p.pam4 ILIKE $${queryParams.length}
                    OR p.rfpc_tpn ILIKE $${queryParams.length}
                    OR p.rfpc_sl_no ILIKE $${queryParams.length}
                    OR p.scanned_by ILIKE $${queryParams.length}
                    OR p.status ILIKE $${queryParams.length}
                )
            `;
        }

        const countQuery = `
            SELECT COUNT(*)::int as total
            FROM rrh_post_burn_in_inspections p
            WHERE p.session_id = $1 AND p.is_deleted = false
            ${searchClause}
        `;
        const countRes = await pool.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        const dataQuery = `
            SELECT 
                p.*,
                ivi.tejas_dc_no,
                ivi.tejas_obd_no,
                ivi.bat_lot_no as lot
            FROM rrh_post_burn_in_inspections p
            LEFT JOIN rrh_hipot_inspections hipot ON hipot.id = p.hipot_inspection_id
            LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = COALESCE(p.pre_burn_in_inspection_id, hipot.pre_burn_in_inspection_id)
            LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(p.programming_inspection_id, hipot.programming_inspection_id, pbi.programming_inspection_id)
            LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(p.ipqc_inspection_id, hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
            LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(p.ivi_inspection_id, hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
            WHERE p.session_id = $1 AND p.is_deleted = false
            ${searchClause}
            ORDER BY p.scanned_at DESC, p.id DESC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;

        const dataRes = await pool.query(dataQuery, [...queryParams, limit, offset]);

        return res.status(200).json({
            success: true,
            data: dataRes.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1
        });
    } catch (err: any) {
        logger.error(`Error in getScannedInspections: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch scanned inspections.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id/failed-inspections
 * Failed inspections for the session
 */
export const getFailedInspections = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;

    try {
        const query = `
            SELECT 
                p.*,
                ivi.tejas_dc_no,
                ivi.tejas_obd_no,
                ivi.bat_lot_no as lot
            FROM rrh_post_burn_in_inspections p
            LEFT JOIN rrh_hipot_inspections hipot ON hipot.id = p.hipot_inspection_id
            LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = COALESCE(p.pre_burn_in_inspection_id, hipot.pre_burn_in_inspection_id)
            LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(p.programming_inspection_id, hipot.programming_inspection_id, pbi.programming_inspection_id)
            LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(p.ipqc_inspection_id, hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
            LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(p.ivi_inspection_id, hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
            WHERE p.session_id = $1 
              AND p.status = 'FAIL' 
              AND (p.debug_status IS NULL OR p.debug_status = 'PENDING' OR p.debug_status NOT IN ('DEBUG_PASS', 'REPAIRED', 'RECTIFIED', 'PASS'))
              AND (p.is_reinspected IS NULL OR p.is_reinspected = false)
              AND p.is_deleted = false
            ORDER BY p.scanned_at DESC, p.id DESC
        `;

        const dataRes = await pool.query(query, [sessionId]);
        return res.status(200).json({ success: true, data: dataRes.rows });
    } catch (err: any) {
        logger.error(`Error in getFailedInspections: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch failed inspections.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id/export
 * Export Post Burn In Inspection records to Excel with multi-section report layout
 */
export const exportPostBurnInExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const statusParam = (req.query.status as string || req.query.type as string || '').trim().toUpperCase();
    const operator = getSessionUser(req);

    try {
        const sessionRes = await pool.query(
            `SELECT s.*, 
                    w.lot_quantity, 
                    COALESCE(w.work_order_date, w.date) as work_order_date,
                    w.status as wo_status,
                    w.excel_filename,
                    (
                        SELECT ri.lot 
                        FROM rrh_inventory ri 
                        WHERE ri.import_id = w.active_import_id 
                           OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id))
                        LIMIT 1
                    ) as lot_number
             FROM rrh_post_burn_in_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Post Burn In session not found.' });
        }

        const session = sessionRes.rows[0];

        // Concurrently fetch Hipot passed count and Post Burn In inspection counts
        const [hipotPassedRes, postStatsRes] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int as total
                 FROM rrh_hipot_inspections hipot
                 LEFT JOIN rrh_hipot_sessions hipots ON hipots.id = hipot.session_id
                 WHERE UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(hipot.status)) IN ('COMPLETED', 'PASS') OR hipot.status ILIKE '%pass%' OR hipot.status ILIKE '%complete%')
                   AND hipot.is_deleted = false
                   AND (hipots.is_deleted IS NULL OR hipots.is_deleted = false)`,
                [session.work_order_id]
            ),
            pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PASS'))::int AS completed,
                    COUNT(*) FILTER (WHERE status = 'FAIL')::int AS failed,
                    COUNT(*) FILTER (WHERE debug_status IS NOT NULL)::int AS debug_count,
                    COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PASS') AND is_reinspected = true)::int AS edited_pass
                 FROM rrh_post_burn_in_inspections
                 WHERE session_id = $1 AND is_deleted = false`,
                [id]
            )
        ]);

        const hipotPassedCount = hipotPassedRes.rows[0]?.total || 0;
        const statsRow = postStatsRes.rows[0] || {};
        const completedCount = statsRow.completed || 0;
        const failedCount = statsRow.failed || 0;
        const lotQuantity = Number(session.lot_quantity) || 0;
        const totalScanned = completedCount + failedCount;
        const pending = Math.max(0, (lotQuantity || hipotPassedCount) - completedCount);

        let filterClause = '';
        const isFail = statusParam === 'FAIL' || statusParam === 'FAILED';
        const isRecent = statusParam === 'PASS' || statusParam === 'COMPLETED' || statusParam === 'RECENT';
        if (isFail) {
            filterClause = ` AND p.status = 'FAIL' AND (p.debug_status IS NULL OR p.debug_status = 'PENDING' OR p.debug_status NOT IN ('DEBUG_PASS', 'REPAIRED', 'RECTIFIED', 'PASS')) AND (p.is_reinspected IS NULL OR p.is_reinspected = false)`;
        } else if (isRecent) {
            filterClause = ` AND p.status IN ('COMPLETED', 'PASS')`;
        }

        const recordsRes = await pool.query(
            `SELECT 
                p.*,
                ivi.tejas_dc_no,
                ivi.tejas_obd_no,
                ivi.bat_lot_no as lot
             FROM rrh_post_burn_in_inspections p
             LEFT JOIN rrh_hipot_inspections hipot ON hipot.id = p.hipot_inspection_id
             LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = COALESCE(p.pre_burn_in_inspection_id, hipot.pre_burn_in_inspection_id)
             LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(p.programming_inspection_id, hipot.programming_inspection_id, pbi.programming_inspection_id)
             LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(p.ipqc_inspection_id, hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
             LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(p.ivi_inspection_id, hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
             WHERE p.session_id = $1 AND p.is_deleted = false ${filterClause}
             ORDER BY p.scanned_at DESC, p.id DESC`,
            [id]
        );

        const rows = recordsRes.rows;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Velankani SFCS';
        const sheetName = isFail ? 'Failed Inspections' : (isRecent ? 'Recent Inspections' : 'Session Report');
        const ws = workbook.addWorksheet(sheetName, {
            views: [{ showGridLines: true }]
        });

        // Styling palettes matching SMT Post AOI Session Report
        const NAVY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
        const BLUE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        const TEAL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D9488' } };
        const INDIGO: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
        const PLUM: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        const GREEN: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
        const RED_BANNER: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB91C1C' } };
        const LIGHT_GRAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        const WHITE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        const DARK_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        const BOLD_DARK: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF0F172A' } };
        const WHITE_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };

        const thinBorder: Partial<ExcelJS.Borders> = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        // Columns setup (10 columns A to J)
        ws.columns = [
            { key: 'a', width: 10 }, // S.No
            { key: 'b', width: 24 }, // Serial Number
            { key: 'c', width: 24 }, // Band Serial No
            { key: 'd', width: 20 }, // Physical TPN
            { key: 'e', width: 14 }, // Band
            { key: 'f', width: 14 }, // Status
            { key: 'g', width: 18 }, // Inspection Date
            { key: 'h', width: 20 }, // Scanned By
            { key: 'i', width: 22 }, // Scanned At
            { key: 'j', width: 32 }  // Remarks / Defect Fixed
        ];

        const addSectionHeader = (label: string, fill: ExcelJS.Fill, startRow: number) => {
            const row = ws.getRow(startRow);
            row.height = 22;
            const cell = ws.getCell(`A${startRow}`);
            cell.value = label;
            cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = fill;
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            ws.mergeCells(`A${startRow}:J${startRow}`);
        };

        const addKVRow = (rowNum: number, label: string, value: any) => {
            const row = ws.getRow(rowNum);
            row.height = 19;
            ws.mergeCells(`A${rowNum}:B${rowNum}`);
            const lCell = ws.getCell(`A${rowNum}`);
            lCell.value = label;
            lCell.font = BOLD_DARK;
            lCell.fill = LIGHT_GRAY;
            lCell.border = thinBorder;
            lCell.alignment = { vertical: 'middle', indent: 1 };

            ws.mergeCells(`C${rowNum}:J${rowNum}`);
            const vCell = ws.getCell(`C${rowNum}`);
            vCell.value = (value !== null && value !== undefined && value !== '') ? String(value) : '-';
            vCell.font = DARK_FONT;
            vCell.fill = WHITE_FILL;
            vCell.border = thinBorder;
            vCell.alignment = { vertical: 'middle', indent: 1 };
        };

        const fmtDate = (d: any) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '-';
        const fmtDateOnly = (d: any) => {
            if (!d) return '-';
            if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.substring(0, 10);
            return new Date(d).toLocaleDateString('en-IN');
        };

        let r = 1;

        // TITLE BANNER
        ws.getRow(r).height = 38;
        const titleCell = ws.getCell(`A${r}`);
        titleCell.value = isFail
            ? '🏭  RRH POST-BURN-IN FAILED INSPECTIONS REPORT'
            : (isRecent ? '🏭  RRH POST-BURN-IN RECENT INSPECTIONS REPORT' : '🏭  RRH POST-BURN-IN SESSION REPORT');
        titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = isFail ? RED_BANNER : (isRecent ? GREEN : NAVY);
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:J${r}`);
        r++;

        ws.getRow(r).height = 18;
        const subCell = ws.getCell(`A${r}`);
        subCell.value = `Stage: RRH Post-Burn-In  |  Generated: ${fmtDate(new Date())}  |  Generated By: ${operator.name || operator.username || 'admin@sfcs.com'}`;
        subCell.font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: 'FFCBD5E1' } };
        subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        subCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:J${r}`);
        r++;

        r++; // Spacer

        // SECTION 1: WORK ORDER DETAILS
        addSectionHeader('  1.  WORK ORDER DETAILS', BLUE, r); r++;
        addKVRow(r, 'Work Order Number', session.work_order_id); r++;
        addKVRow(r, 'Work Order Date', fmtDateOnly(session.work_order_date)); r++;
        addKVRow(r, 'Work Order Quantity', lotQuantity || '-'); r++;
        addKVRow(r, 'Lot Number / Batch', session.lot_number || '-'); r++;
        addKVRow(r, 'Work Order Status', session.wo_status || 'In Progress'); r++;
        addKVRow(r, 'Work Order File', session.excel_filename || '-'); r++;

        r++; // Spacer

        // SECTION 2: HIPOT & SOURCE SPECIFICATIONS
        addSectionHeader('  2.  HIPOT & SOURCE SPECIFICATIONS', TEAL, r); r++;
        addKVRow(r, 'Source Stage', 'RRH Hipot'); r++;
        addKVRow(r, 'Passed in Hipot', hipotPassedCount); r++;
        addKVRow(r, 'Target Stage', 'RRH Post-Burn-In'); r++;
        addKVRow(r, 'Sample Physical TPN', rows[0]?.physical_tpn || '-'); r++;
        addKVRow(r, 'Sample Band', rows[0]?.band || '-'); r++;

        r++; // Spacer

        // SECTION 3: POST-BURN-IN SESSION DETAILS
        addSectionHeader('  3.  POST-BURN-IN SESSION DETAILS', INDIGO, r); r++;
        addKVRow(r, 'Post-Burn-In Session ID', session.id); r++;
        addKVRow(r, 'Post-Burn-In Started By', session.created_by_name || session.created_by || 'System Admin'); r++;
        addKVRow(r, 'Post-Burn-In Started Date & Time', fmtDate(session.created_at)); r++;
        addKVRow(r, 'Post-Burn-In Status', session.status); r++;

        r++; // Spacer

        // SECTION 4: PRODUCTION SUMMARY
        const baseQty = lotQuantity || hipotPassedCount || totalScanned || 0;
        const yieldPercent = baseQty > 0
            ? ((completedCount / baseQty) * 100).toFixed(2) + '%'
            : '0.00%';

        addSectionHeader('  4.  PRODUCTION SUMMARY', PLUM, r); r++;
        addKVRow(r, 'Work Order Quantity', lotQuantity || '-'); r++;
        addKVRow(r, 'Passed in Hipot', hipotPassedCount); r++;
        addKVRow(r, 'Total Scanned (Post-Burn-In)', totalScanned); r++;
        addKVRow(r, 'Passed Quantity', completedCount); r++;
        addKVRow(r, 'Yield (%)', yieldPercent); r++;
        addKVRow(r, 'Failed Quantity', failedCount); r++;
        addKVRow(r, 'Pending Quantity', pending); r++;

        r++; // Spacer

        // SECTION 5: SCAN HISTORY / RECENT INSPECTIONS
        addSectionHeader(
            isFail
                ? '  5.  FAILED INSPECTIONS HISTORY'
                : (isRecent ? '  5.  SCAN HISTORY (RECENT INSPECTIONS)' : '  5.  SCAN HISTORY (ALL INSPECTIONS)'),
            isFail ? RED_BANNER : (isRecent ? GREEN : NAVY),
            r
        ); r++;

        const headers = [
            'S.No.', 'Serial Number', 'Band Serial No.', 'Physical TPN', 'Band',
            'Status', 'Inspection Date', 'Scanned By', 'Scanned At', 'Remarks'
        ];
        const hRow = ws.getRow(r);
        hRow.height = 20;
        headers.forEach((h, i) => {
            const col = String.fromCharCode(65 + i);
            const cell = ws.getCell(`${col}${r}`);
            cell.value = h;
            cell.font = WHITE_FONT;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
            cell.border = thinBorder;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
        r++;

        rows.forEach((scan, idx) => {
            const rowFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF8FAFC' } };

            const setCell = (col: string, value: any, extra: Partial<ExcelJS.Style> = {}) => {
                const cell = ws.getCell(`${col}${r}`);
                cell.value = value ?? '-';
                cell.font = DARK_FONT;
                cell.fill = rowFill;
                cell.border = thinBorder;
                cell.alignment = { vertical: 'middle', indent: 1, wrapText: true };
                Object.assign(cell, extra);
            };

            setCell('A', scan.sl_no ?? (idx + 1), { alignment: { vertical: 'middle', horizontal: 'center' } });
            setCell('B', scan.serial_number);
            setCell('C', scan.band_serial_no || scan.serial_number);
            setCell('D', scan.physical_tpn || '-');
            setCell('E', scan.band || '-');

            const statusCell = ws.getCell(`F${r}`);
            const isPass = scan.status === 'COMPLETED' || scan.status === 'PASS';
            statusCell.value = isPass ? 'PASS' : (scan.status || 'FAIL');
            statusCell.font = {
                name: 'Calibri', size: 10, bold: true,
                color: { argb: isPass ? 'FF166534' : 'FF991B1B' }
            };
            statusCell.fill = {
                type: 'pattern', pattern: 'solid',
                fgColor: { argb: isPass ? 'FFDCFCE7' : 'FFFEE2E2' }
            };
            statusCell.border = thinBorder;
            statusCell.alignment = { vertical: 'middle', horizontal: 'center' };

            setCell('G', fmtDateOnly(scan.inspection_date));
            setCell('H', scan.scanned_by || '-');
            setCell('I', fmtDate(scan.scanned_at));
            setCell('J', scan.defect_fixed ? `Fixed: ${scan.defect_fixed}` : (scan.remarks || '-'));
            r++;
        });

        if (rows.length === 0) {
            const emptyRow = ws.getRow(r);
            emptyRow.height = 20;
            const cell = ws.getCell(`A${r}`);
            cell.value = 'No inspection records found for this session.';
            cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.mergeCells(`A${r}:J${r}`);
            r++;
        }

        r++;
        const footerCell = ws.getCell(`A${r}`);
        footerCell.value = `Report generated by SFCS RRH System  |  ${operator.name || operator.username || 'System Admin'}  |  ${fmtDate(new Date())}`;
        footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
        ws.mergeCells(`A${r}:J${r}`);

        const filename = isFail
            ? `RRH_Post_Burn_In_Failed_Report_${session.work_order_id}.xlsx`
            : (isRecent
                ? `RRH_Post_Burn_In_Recent_Report_${session.work_order_id}.xlsx`
                : `RRH_Post_Burn_In_Session_Report_${session.work_order_id}.xlsx`);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error(`Error in exportPostBurnInExcel: ${err.message}`);
        return res.status(500).json({ message: 'Failed to export report.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id/export-unscanned
 * Export Unscanned units ready for Post-Burn-In
 */
export const exportUnscannedExcel = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const sessionRes = await pool.query(
            `SELECT work_order_id FROM rrh_post_burn_in_sessions WHERE id = $1 AND is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Post Burn In session not found.' });
        }

        const woId = sessionRes.rows[0].work_order_id;

        const unscannedRes = await pool.query(`
            WITH latest_hipot AS (
                SELECT DISTINCT ON (UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))))
                    hipot.id as hipot_id,
                    hipot.sl_no,
                    hipot.work_order_id,
                    hipot.serial_number,
                    COALESCE(hipot.band_serial_no, hipot.serial_number) as band_serial_no,
                    hipot.physical_tpn,
                    hipot.band,
                    hipot.status as source_status,
                    hipot.remarks,
                    hipot.scanned_at as hipot_scanned_at,
                    ivi.duplexer_main,
                    ivi.duplexer_part_no,
                    ivi.rrh_unit,
                    ivi.tejas_dc_no,
                    ivi.tejas_obd_no,
                    ivi.bat_lot_no as lot
                FROM rrh_hipot_inspections hipot
                LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = hipot.pre_burn_in_inspection_id
                LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(hipot.programming_inspection_id, pbi.programming_inspection_id)
                LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
                LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
                WHERE UPPER(TRIM(hipot.work_order_id)) = UPPER(TRIM($1))
                  AND (UPPER(TRIM(hipot.status)) IN ('COMPLETED', 'PASS') OR hipot.status ILIKE '%pass%' OR hipot.status ILIKE '%complete%')
                  AND hipot.is_deleted = false
                ORDER BY UPPER(TRIM(COALESCE(hipot.band_serial_no, hipot.serial_number))), hipot.scanned_at DESC, hipot.id DESC
            )
            SELECT 
                p.hipot_id,
                p.sl_no,
                p.work_order_id,
                p.serial_number,
                p.band_serial_no,
                p.physical_tpn,
                p.band,
                p.duplexer_main,
                p.duplexer_part_no,
                p.rrh_unit,
                p.source_status,
                p.tejas_dc_no,
                p.tejas_obd_no,
                p.lot,
                p.remarks
            FROM latest_hipot p
            WHERE NOT EXISTS (
                SELECT 1 FROM rrh_post_burn_in_inspections pbi2
                JOIN rrh_post_burn_in_sessions s ON s.id = pbi2.session_id AND s.is_deleted = false
                WHERE (pbi2.session_id = $2 OR UPPER(TRIM(pbi2.work_order_id)) = UPPER(TRIM($1)))
                  AND pbi2.is_deleted = false
                  AND (
                      pbi2.hipot_inspection_id = p.hipot_id
                      OR (pbi2.serial_number IS NOT NULL AND (
                          UPPER(TRIM(pbi2.serial_number)) = UPPER(TRIM(COALESCE(p.serial_number, '')))
                          OR UPPER(TRIM(pbi2.serial_number)) = UPPER(TRIM(COALESCE(p.band_serial_no, '')))
                      ))
                      OR (pbi2.band_serial_no IS NOT NULL AND (
                          UPPER(TRIM(pbi2.band_serial_no)) = UPPER(TRIM(COALESCE(p.band_serial_no, '')))
                          OR UPPER(TRIM(pbi2.band_serial_no)) = UPPER(TRIM(COALESCE(p.serial_number, '')))
                      ))
                  )
            )
            ORDER BY p.hipot_scanned_at DESC, p.hipot_id DESC
        `, [woId, id]);

        const rows = unscannedRes.rows;

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Unscanned Master Data');

        const headers = [
            'S.No.', 'Physical TPN', 'Band Serial Number', 'Duplexer Main',
            'Duplexer Part No', 'RRH Unit', 'Hipot Status', 'Tejas DC No',
            'Tejas OBD No', 'Lot', 'Remarks'
        ];

        worksheet.addRow(headers);
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0284C7' }
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 24;

        rows.forEach((r, idx) => {
            worksheet.addRow([
                idx + 1,
                r.physical_tpn || '—',
                r.band_serial_no || r.serial_number,
                r.duplexer_main || '—',
                r.duplexer_part_no || '—',
                r.rrh_unit || '—',
                r.source_status || '—',
                r.tejas_dc_no || '—',
                r.tejas_obd_no || '—',
                r.lot || '—',
                r.remarks || '—'
            ]);
        });

        worksheet.columns.forEach(col => {
            col.width = 18;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="RRH_Post_Burn_In_Unscanned_Units_WO_${woId}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error(`Error in exportUnscannedExcel: ${err.message}`);
        return res.status(500).json({ message: 'Failed to export unscanned units.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id/debug-inspections
 * Debug & Rework inspection records (failed Post Burn In units for this session or work order)
 */
export const getDebugInspections = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const search = (req.query.search as string || '').trim();
    const statusFilter = (req.query.status as string || '').trim();

    try {
        const queryParams: any[] = [sessionId];
        let filterClauses = '';

        if (search) {
            queryParams.push(`%${search}%`);
            filterClauses += `
                AND (
                    p.serial_number ILIKE $${queryParams.length}
                    OR p.band_serial_no ILIKE $${queryParams.length}
                    OR p.physical_tpn ILIKE $${queryParams.length}
                    OR p.remarks ILIKE $${queryParams.length}
                    OR p.debug_remarks ILIKE $${queryParams.length}
                    OR p.debug_by ILIKE $${queryParams.length}
                    OR p.scanned_by ILIKE $${queryParams.length}
                )
            `;
        }

        if (statusFilter && statusFilter !== 'ALL') {
            queryParams.push(statusFilter);
            filterClauses += ` AND COALESCE(p.debug_status, 'PENDING') = $${queryParams.length}`;
        } else {
            filterClauses += ` AND (p.debug_status IN ('DEBUG_PASS', 'REPAIRED', 'RECTIFIED', 'PASS') OR p.is_reinspected = true)`;
        }

        const query = `
            SELECT 
                p.*,
                COALESCE(p.debug_status, 'PENDING') as debug_status,
                ivi.tejas_dc_no,
                ivi.tejas_obd_no,
                ivi.bat_lot_no as lot
            FROM rrh_post_burn_in_inspections p
            LEFT JOIN rrh_hipot_inspections hipot ON hipot.id = p.hipot_inspection_id
            LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = COALESCE(p.pre_burn_in_inspection_id, hipot.pre_burn_in_inspection_id)
            LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(p.programming_inspection_id, hipot.programming_inspection_id, pbi.programming_inspection_id)
            LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(p.ipqc_inspection_id, hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
            LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(p.ivi_inspection_id, hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
            WHERE p.session_id = $1 
              AND p.is_deleted = false
              AND p.debug_status IS NOT NULL
              ${filterClauses}
            ORDER BY COALESCE(p.debug_at, p.scanned_at) DESC, p.id DESC
        `;

        const dataRes = await pool.query(query, queryParams);
        return res.status(200).json({ success: true, data: dataRes.rows });
    } catch (err: any) {
        logger.error(`Error in getDebugInspections: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch debug inspections.', error: err.message });
    }
};

/**
 * PATCH /api/rrh/post-burn-in/inspections/:id/debug-action
 * Update debug status and debug notes for a failed Post Burn In unit.
 * When rectified or passed in debug, it marks the unit as COMPLETED / Passed in Post Burn In.
 */
export const updateDebugAction = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { debug_status, debug_remarks } = req.body;
    const operator = getSessionUser(req);

    if (!debug_status) {
        return res.status(400).json({ message: 'debug_status is required.' });
    }

    const cleanStatus = String(debug_status).trim().toUpperCase();
    const isPassing = ['DEBUG_PASS', 'REPAIRED', 'RECTIFIED', 'PASS'].includes(cleanStatus);

    try {
        let updateRes;
        if (isPassing) {
            updateRes = await pool.query(
                `UPDATE rrh_post_burn_in_inspections
                 SET debug_status = $1,
                     status = 'COMPLETED',
                     is_reinspected = true,
                     defect_fixed = COALESCE(remarks, $2, 'Defect rectified and verified in Debug station.'),
                     debug_remarks = COALESCE($2, debug_remarks),
                     debug_by = $3,
                     debug_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4 AND is_deleted = false
                 RETURNING *`,
                [cleanStatus, debug_remarks || null, operator.name || operator.username || 'System Admin', id]
            );
        } else {
            updateRes = await pool.query(
                `UPDATE rrh_post_burn_in_inspections
                 SET debug_status = $1,
                     status = 'FAIL',
                     debug_remarks = COALESCE($2, debug_remarks),
                     debug_by = $3,
                     debug_at = CURRENT_TIMESTAMP,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $4 AND is_deleted = false
                 RETURNING *`,
                [cleanStatus, debug_remarks || null, operator.name || operator.username || 'System Admin', id]
            );
        }

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ message: 'Inspection record not found.' });
        }

        return res.status(200).json({
            success: true,
            message: isPassing ? 'Unit rectified and passed in Post Burn In!' : 'Debug status updated successfully.',
            data: updateRes.rows[0]
        });
    } catch (err: any) {
        logger.error(`Error in updateDebugAction: ${err.message}`);
        return res.status(500).json({ message: 'Failed to update debug action.', error: err.message });
    }
};

/**
 * GET /api/rrh/post-burn-in/sessions/:id/export-debug
 * Export debug records to Excel
 */
export const exportDebugExcel = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const sessionRes = await pool.query(
            `SELECT * FROM rrh_post_burn_in_sessions WHERE id = $1 AND is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Post Burn In session not found.' });
        }

        const session = sessionRes.rows[0];

        const query = `
            SELECT 
                p.*,
                COALESCE(p.debug_status, 'PENDING') as debug_status,
                ivi.tejas_dc_no,
                ivi.bat_lot_no as lot
            FROM rrh_post_burn_in_inspections p
            LEFT JOIN rrh_hipot_inspections hipot ON hipot.id = p.hipot_inspection_id
            LEFT JOIN rrh_pre_burn_in_inspections pbi ON pbi.id = COALESCE(p.pre_burn_in_inspection_id, hipot.pre_burn_in_inspection_id)
            LEFT JOIN rrh_programming_inspections prog ON prog.id = COALESCE(p.programming_inspection_id, hipot.programming_inspection_id, pbi.programming_inspection_id)
            LEFT JOIN rrh_ipqc_inspections ipqc ON ipqc.id = COALESCE(p.ipqc_inspection_id, hipot.ipqc_inspection_id, pbi.ipqc_inspection_id, prog.ipqc_inspection_id)
            LEFT JOIN rrh_ivi_inspections ivi ON ivi.id = COALESCE(p.ivi_inspection_id, hipot.ivi_inspection_id, pbi.ivi_inspection_id, prog.ivi_inspection_id, ipqc.ivi_inspection_id)
            WHERE p.session_id = $1 
              AND p.is_deleted = false
              AND (
                  p.debug_status IN ('DEBUG_PASS', 'REPAIRED', 'RECTIFIED', 'PASS')
                  OR p.is_reinspected = true
              )
            ORDER BY COALESCE(p.debug_at, p.scanned_at) DESC, p.id DESC
        `;

        const dataRes = await pool.query(query, [id]);
        const rows = dataRes.rows;

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Debug Inspections');

        const headers = [
            'S.No.', 'Work Order', 'Serial Number', 'Band Serial Number',
            'Physical TPN', 'Band', 'Failure Defect', 'Debug Status',
            'Debug Remarks', 'Debug Operator', 'Debug Timestamp', 'Inspected By', 'Inspected At'
        ];

        worksheet.addRow(headers);
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD97706' }
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 24;

        rows.forEach((r, idx) => {
            worksheet.addRow([
                idx + 1,
                r.work_order_id,
                r.serial_number,
                r.band_serial_no || r.serial_number,
                r.physical_tpn || '—',
                r.band || '—',
                r.remarks || '—',
                r.debug_status || 'PENDING',
                r.debug_remarks || '—',
                r.debug_by || '—',
                r.debug_at ? new Date(r.debug_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '—',
                r.scanned_by || '—',
                r.scanned_at ? new Date(r.scanned_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '—'
            ]);
        });

        worksheet.columns.forEach(col => {
            col.width = 18;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="RRH_Post_Burn_In_Debug_Report_WO_${session.work_order_id}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error(`Error in exportDebugExcel: ${err.message}`);
        return res.status(500).json({ message: 'Failed to export debug report.', error: err.message });
    }
};
