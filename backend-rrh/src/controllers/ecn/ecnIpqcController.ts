import { Request, Response } from 'express';
import { pool } from '../../utils/db';
import { createLogger } from '../../utils/logger';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { sendRrhSessionExcel } from '../../utils/rrhExcelGenerator';

const logger = createLogger('RRH-IPQC');

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

import { getSessionUser } from '../../utils/authHelper';
import { WorkflowEngine } from '../../workflows/common/workflowEngine';

// ─── Helper to clean defect text (removes 'Point 1:', 'point2:', etc.) ─────────
export const cleanDefectDescription = (text: string | null | undefined): string => {
    if (!text || text === '—' || text === '-') return '—';
    const parts = String(text).split(';');
    const cleaned = parts
        .map((p) => {
            let s = p.trim();
            // Remove variations of point prefixes: "Point 1:", "Point 1 -", "point1:", "1: ", ": 1: ", etc.
            s = s.replace(/^(?:point\s*\d+[\s:\-–.]*|:?\s*\d+\s*[:\-–.]\s*)/i, '').trim();
            return s;
        })
        .filter((p) => p.length > 0 && p !== '—' && p !== '-');

    return cleaned.length > 0 ? cleaned.join('; ') : '—';
};

// ─── Helper to estimate visual lines in an Excel cell for dynamic row height ──
const estimateTextLines = (text: any, colWidth: number): number => {
    if (!text || text === '—' || text === '-') return 1;
    const str = String(text).trim();
    if (!str) return 1;
    const effectiveWidth = Math.max(12, colWidth - 4);
    const paragraphs = str.split('\n');
    let totalLines = 0;
    for (const p of paragraphs) {
        const cleanP = p.trim();
        if (!cleanP) {
            totalLines += 1;
        } else {
            totalLines += Math.max(1, Math.ceil(cleanP.length / effectiveWidth));
        }
    }
    return Math.max(1, totalLines);
};

/**
 * GET /api/rrh/ipqc/eligible-work-orders
 * Return RRH work orders that have passed units in IVI, and are NOT currently
 * active (In Progress, Pending, Paused) or Completed in IPQC.
 */
export const getEligibleIpqcWorkOrders = async (_req: Request, res: Response) => {
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
                    SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))::int
                    FROM rrh_ivi_inspections ivi
                    JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id AND ivis.is_deleted = false
                    WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(w.work_order_id))
                      AND (ivi.status = 'PASS' OR (ivi.status = 'FAIL' AND ivi.passed_to_next_stage = true))
                      AND COALESCE(ivi.route, 'ECN') = 'ECN'
                      AND ivi.is_deleted = false
                ) as ivi_passed_count
            FROM rrh_work_orders w
            WHERE (w.is_deleted IS NULL OR w.is_deleted = false)
              AND NOT EXISTS (
                SELECT 1
                FROM rrh_ipqc_sessions s
                WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id))
                  AND s.is_deleted = false
                  AND REPLACE(COALESCE(s.route, 'ECN'), '-', '_') = 'ECN'
                  AND UPPER(TRIM(s.status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')
              )
            ORDER BY w.created_at DESC, w.id DESC
        `);

        return res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error('Error in getEligibleIpqcWorkOrders: ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch eligible work orders for IPQC.', error: err.message });
    }
};

/**
 * GET /api/rrh/ipqc/work-orders/:woId/ivi-details
 * Returns IVI passed count and work order details for a specific work order
 */
export const getWorkOrderIviDetails = async (req: Request, res: Response) => {
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
            `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))::int as count
             FROM rrh_ivi_inspections ivi
             JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id AND ivis.is_deleted = false
             WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
               AND (ivi.status = 'PASS' OR (ivi.status = 'FAIL' AND ivi.passed_to_next_stage = true))
               AND COALESCE(ivi.route, 'ECN') = 'ECN'
               AND ivi.is_deleted = false`,
            [cleanWoId]
        );

        const wo = woRes.rows[0] || null;
        const iviPassedCount = countRes.rows[0]?.count || 0;

        return res.status(200).json({
            success: true,
            data: {
                work_order_id: wo?.work_order_id || cleanWoId,
                work_order_date: wo?.work_order_date || null,
                lot_quantity: Number(wo?.lot_quantity) || 0,
                ivi_passed_count: iviPassedCount
            }
        });
    } catch (err: any) {
        logger.error(`Error in getWorkOrderIviDetails: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch IVI details.', error: err.message });
    }
};


/**
 * POST /api/rrh/ipqc/sessions
 * Start or resume an IPQC session
 */
export const createIpqcSession = async (req: Request, res: Response) => {
    const { work_order_id } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id) {
        return res.status(400).json({ message: 'work_order_id is required.' });
    }

    const cleanWo = work_order_id.trim();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if an active or completed session already exists for this Work Order under ECN
        const sessionCheck = await client.query(
            `SELECT * FROM rrh_ipqc_sessions 
             WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
               AND REPLACE(COALESCE(route, 'ECN'), '-', '_') = 'ECN'
               AND UPPER(TRIM(status)) IN ('PENDING', 'IN PROGRESS', 'PAUSED', 'COMPLETED') 
               AND is_deleted = false
             ORDER BY created_at DESC 
             LIMIT 1`,
            [cleanWo]
        );

        if (sessionCheck.rows.length > 0) {
            const existing = sessionCheck.rows[0];
            await client.query('ROLLBACK');
            if (String(existing.status).toUpperCase() === 'COMPLETED') {
                return res.status(409).json({ message: `Work order "${cleanWo}" has already been completed in IPQC.` });
            }
            return res.status(409).json({ message: `An active session already exists for work order "${cleanWo}".`, session: existing });
        }

        // Create new IPQC session
        const insertRes = await client.query(
            `INSERT INTO rrh_ipqc_sessions (
                work_order_id, 
                status, 
                created_by, 
                created_by_name,
                route
             ) VALUES ($1, 'In Progress', $2, $3, 'ECN')
             RETURNING *`,
            [cleanWo, operator.username, operator.name]
        );

        await client.query('COMMIT');
        logger.info(`Started new IPQC session ID ${insertRes.rows[0].id} for Work Order ${work_order_id}`);
        return res.status(201).json(insertRes.rows[0]);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in createIpqcSession: ${err.message}`);
        return res.status(500).json({ message: 'Failed to create IPQC session.', error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/rrh/ipqc/sessions
 * List IPQC sessions with status, search and pagination
 */
export const getIpqcSessions = async (req: Request, res: Response) => {
    try {
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.max(1, parseInt(req.query.limit as string) || 5);
        const offset = (page - 1) * limit;
        const search = (req.query.search as string || '').trim();
        const status = (req.query.status as string || '').trim();

        const params: any[] = [];
        let whereConditions: string[] = [
            's.is_deleted = false',
            "REPLACE(COALESCE(s.route, 'ECN'), '-', '_') = 'ECN'"
        ];

        if (status) {
            const statuses = (status as string).split(',').map((s: string) => s.trim()).filter(Boolean);
            if (statuses.length === 1) {
                params.push(statuses[0]);
                whereConditions.push(`s.status = $${params.length}`);
            } else if (statuses.length > 1) {
                params.push(statuses);
                whereConditions.push(`s.status = ANY($${params.length})`);
            }
        }

        if (search) {
            params.push(`%${search}%`);
            whereConditions.push(`s.work_order_id ILIKE $${params.length}`);
        }

        const whereSql = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

        const countQuery = `SELECT COUNT(*) FROM rrh_ipqc_sessions s ${whereSql}`;
        const countRes = await pool.query(countQuery, params);
        const total = parseInt(countRes.rows[0].count);

        const dataQuery = `
            SELECT s.*, 
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
            FROM rrh_ipqc_sessions s
            LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
            ${whereSql}
            ORDER BY s.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const dataRes = await pool.query(dataQuery, [...params, limit, offset]);

        return res.status(200).json({
            sessions: dataRes.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1
        });
    } catch (err: any) {
        logger.error(`Error in getIpqcSessions: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch IPQC sessions.', error: err.message });
    }
};

/**
 * GET /api/rrh/ipqc/sessions/:id
 * Fetch single IPQC session with live statistics
 */
export const getIpqcSessionById = async (req: Request, res: Response) => {
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
             FROM rrh_ipqc_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'IPQC session not found.' });
        }

        const session = sessionRes.rows[0];

        // Fetch IVI available count and aggregated IPQC session stats concurrently
        const [iviPassedRes, ipqcStatsRes] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int as total
                 FROM rrh_ivi_inspections ivi
                 JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id AND ivis.is_deleted = false
                 WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
                   AND (ivi.status = 'PASS' OR (ivi.status = 'FAIL' AND ivi.passed_to_next_stage = true))
                   AND COALESCE(ivi.route, 'ECN') = 'ECN'
                   AND ivi.is_deleted = false`,
                [session.work_order_id]
            ),
            pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PASS'))::int AS completed,
                    COUNT(*) FILTER (WHERE status = 'FAIL')::int AS failed,
                    COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'PASS') AND is_reinspected = true)::int AS edited_pass
                 FROM rrh_ipqc_inspections
                 WHERE session_id = $1 AND is_deleted = false`,
                [id]
            )
        ]);

        const iviPassedCount = iviPassedRes.rows[0]?.total || 0;
        const statsRow = ipqcStatsRes.rows[0] || {};
        const completedCount = statsRow.completed || 0;
        const failedCount = statsRow.failed || 0;
        const editedPassCount = statsRow.edited_pass || 0;

        const lotQuantity = session.lot_quantity || 0;
        const pending = Math.max(0, (lotQuantity || iviPassedCount) - completedCount);
        const yieldPercent = (lotQuantity > 0 ? (completedCount / lotQuantity) * 100 : 100).toFixed(2);

        return res.status(200).json({
            session,
            stats: {
                lotQuantity,
                iviPassed: iviPassedCount,
                completed: completedCount,
                passed: completedCount,
                failed: failedCount,
                pending,
                editedPass: editedPassCount,
                yield: yieldPercent
            }
        });
    } catch (err: any) {
        logger.error(`Error in getIpqcSessionById: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch IPQC session details.', error: err.message });
    }
};

/**
 * PATCH /api/rrh/ipqc/sessions/:id/status
 * Update session status (e.g. Completed, Paused, In Progress)
 */
export const updateIpqcSessionStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const operator = getSessionUser(req);

    if (!status) {
        return res.status(400).json({ message: 'Status is required.' });
    }

    try {
        const updateRes = await pool.query(
            `UPDATE rrh_ipqc_sessions
             SET status = $1, 
                 updated_by = $2, 
                 updated_by_name = $3, 
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 AND is_deleted = false
             RETURNING *`,
            [status, operator.username, operator.name, id]
        );

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ message: 'IPQC session not found.' });
        }

        return res.status(200).json({ success: true, session: updateRes.rows[0] });
    } catch (err: any) {
        logger.error(`Error in updateIpqcSessionStatus: ${err.message}`);
        return res.status(500).json({ message: 'Failed to update IPQC session status.', error: err.message });
    }
};

/**
 * DELETE /api/rrh/ipqc/sessions/:id
 * Soft delete an IPQC session
 */
export const deleteIpqcSession = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        const deleteRes = await pool.query(
            `UPDATE rrh_ipqc_sessions
             SET is_deleted = true, 
                 deleted_at = CURRENT_TIMESTAMP, 
                 deleted_by = $1, 
                 deleted_by_name = $2
             WHERE id = $3 AND is_deleted = false
             RETURNING id`,
            [operator.username, operator.name, id]
        );

        if (deleteRes.rows.length === 0) {
            return res.status(404).json({ message: 'IPQC session not found.' });
        }

        return res.status(200).json({ success: true, message: 'IPQC session deleted successfully.' });
    } catch (err: any) {
        logger.error(`Error in deleteIpqcSession: ${err.message}`);
        return res.status(500).json({ message: 'Failed to delete IPQC session.', error: err.message });
    }
};

/**
 * GET /api/rrh/ipqc/sessions/:id/remaining-master-data
 * Fetch units passed from RRH IVI that are ready for IPQC and have not yet been inspected in this IPQC session.
 */
export const getRemainingIviMasterData = async (req: Request, res: Response) => {
    const { id } = req.params;
    const search = (req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * limit;

    try {
        const sessionRes = await pool.query(
            `SELECT work_order_id FROM rrh_ipqc_sessions WHERE id = $1 AND is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'IPQC session not found.' });
        }

        const woId = sessionRes.rows[0].work_order_id;

        const queryParams: any[] = [woId, id];
        let searchClause = '';
        if (search) {
            queryParams.push(`%${search}%`);
            searchClause = `
                AND (
                    ivi.serial_number ILIKE $${queryParams.length}
                    OR ivi.band_serial_no ILIKE $${queryParams.length}
                    OR ivi.physical_tpn ILIKE $${queryParams.length}
                    OR ivi.duplexer_main ILIKE $${queryParams.length}
                    OR ivi.duplexer_part_no ILIKE $${queryParams.length}
                    OR ivi.tejas_dc_no ILIKE $${queryParams.length}
                    OR ivi.tejas_obd_no ILIKE $${queryParams.length}
                    OR ivi.bat_lot_no ILIKE $${queryParams.length}
                    OR ivi.rrh_unit ILIKE $${queryParams.length}
                    OR ivi.sl_no ILIKE $${queryParams.length}
                )
            `;
        }

        // Base CTE to get the latest IVI inspection per physical unit
        const cteQuery = `
            WITH latest_ivi AS (
                SELECT DISTINCT ON (UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))
                    ivi.id as ivi_id,
                    COALESCE(
                        ivi.sl_no,
                        (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE ins.id = ivi.inward_scan_id LIMIT 1),
                        (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(ivi.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(ivi.serial_number)) LIMIT 1),
                        (SELECT ri.sl_no FROM rrh_inventory ri WHERE UPPER(TRIM(ri.band_serial_no)) = UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))) LIMIT 1)
                    ) as sl_no,
                    ivi.work_order_id,
                    ivi.serial_number,
                    COALESCE(ivi.band_serial_no, ivi.serial_number) as band_serial_no,
                    ivi.physical_tpn,
                    ivi.band,
                    ivi.duplexer_main,
                    ivi.duplexer_part_no,
                    ivi.rrh_unit,
                    ivi.status as ivi_status,
                    ivi.tejas_dc_no,
                    ivi.tejas_obd_no,
                    ivi.bat_lot_no as lot,
                    ivi.bat_lot_no,
                    ivi.remarks,
                    ivi.scanned_at as ivi_scanned_at,
                    ivi.passed_to_next_stage,
                    ivi.is_deleted
                FROM rrh_ivi_inspections ivi
                JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id AND ivis.is_deleted = false
                WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
                  AND (ivi.status = 'PASS' OR (ivi.status = 'FAIL' AND ivi.passed_to_next_stage = true))
                  AND COALESCE(ivi.route, 'ECN') = 'ECN'
                  AND ivi.is_deleted = false
                ORDER BY UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))), ivi.scanned_at DESC, ivi.id DESC
            )
        `;

        // Count total remaining units
        const countQuery = `
            ${cteQuery}
            SELECT COUNT(*)::int as total
            FROM latest_ivi ivi
            WHERE NOT EXISTS (
                SELECT 1 FROM rrh_ipqc_inspections ipqc
                WHERE (ipqc.session_id = $2 OR UPPER(TRIM(ipqc.work_order_id)) = UPPER(TRIM($1)))
                  AND ipqc.is_deleted = false
                  AND (
                      ipqc.ivi_inspection_id = ivi.ivi_id
                      OR UPPER(TRIM(ipqc.serial_number)) = UPPER(TRIM(ivi.serial_number))
                      OR UPPER(TRIM(COALESCE(ipqc.band_serial_no, ''))) = UPPER(TRIM(ivi.serial_number))
                      OR (ivi.band_serial_no IS NOT NULL AND (
                          UPPER(TRIM(ipqc.serial_number)) = UPPER(TRIM(ivi.band_serial_no))
                          OR UPPER(TRIM(COALESCE(ipqc.band_serial_no, ''))) = UPPER(TRIM(ivi.band_serial_no))
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
                ivi.ivi_id,
                ivi.sl_no,
                ivi.work_order_id,
                ivi.serial_number,
                ivi.band_serial_no,
                ivi.physical_tpn,
                ivi.band,
                ivi.duplexer_main,
                ivi.duplexer_part_no,
                ivi.rrh_unit,
                ivi.ivi_status,
                ivi.tejas_dc_no,
                ivi.tejas_obd_no,
                ivi.lot,
                ivi.bat_lot_no,
                ivi.remarks,
                ivi.ivi_scanned_at
            FROM latest_ivi ivi
            WHERE NOT EXISTS (
                SELECT 1 FROM rrh_ipqc_inspections ipqc
                WHERE (ipqc.session_id = $2 OR UPPER(TRIM(ipqc.work_order_id)) = UPPER(TRIM($1)))
                  AND ipqc.is_deleted = false
                  AND (
                      ipqc.ivi_inspection_id = ivi.ivi_id
                      OR UPPER(TRIM(ipqc.serial_number)) = UPPER(TRIM(ivi.serial_number))
                      OR UPPER(TRIM(COALESCE(ipqc.band_serial_no, ''))) = UPPER(TRIM(ivi.serial_number))
                      OR (ivi.band_serial_no IS NOT NULL AND (
                          UPPER(TRIM(ipqc.serial_number)) = UPPER(TRIM(ivi.band_serial_no))
                          OR UPPER(TRIM(COALESCE(ipqc.band_serial_no, ''))) = UPPER(TRIM(ivi.band_serial_no))
                      ))
                  )
            )
            ${searchClause}
            ORDER BY ivi.ivi_scanned_at DESC, ivi.ivi_id DESC
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
        logger.error('Error fetching remaining IVI master data for IPQC: ' + err);
        return res.status(500).json({ message: 'Internal server error while fetching remaining units.', error: err.message });
    }
};

/**
 * GET /api/rrh/ipqc/lookup
 * Query unit details by serial number from IVI passed inspections and master inventory
 */
export const lookupSerialDetails = async (req: Request, res: Response) => {
    const { serial, work_order_id, session_id } = req.query;

    if (!serial || typeof serial !== 'string' || !serial.trim()) {
        return res.status(400).json({ message: 'serial query parameter is required.' });
    }

    const cleanSerial = serial.trim().toUpperCase();
    const woId = typeof work_order_id === 'string' ? work_order_id.trim() : '';

    try {
        let iviQuery = `
            SELECT 
                ivi.id as ivi_id,
                COALESCE(
                    ivi.sl_no,
                    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE ins.id = ivi.inward_scan_id LIMIT 1),
                    (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(ivi.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(ivi.serial_number)) LIMIT 1),
                    (SELECT ri.sl_no FROM rrh_inventory ri WHERE UPPER(TRIM(ri.band_serial_no)) = UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))) LIMIT 1)
                ) as sl_no,
                ivi.work_order_id,
                ivi.serial_number,
                COALESCE(ivi.band_serial_no, ivi.serial_number) as band_serial_no,
                ivi.physical_tpn,
                ivi.band,
                ivi.wo_date,
                ivi.tejas_dc_no,
                ivi.tejas_obd_no,
                ivi.bat_lot_no,
                ivi.duplexer_main,
                ivi.duplexer_part_no,
                ivi.rrh_unit,
                ivi.status as ivi_status,
                ivi.scanned_by as ivi_inspected_by,
                ivi.remarks as ivi_remarks
            FROM rrh_ivi_inspections ivi
            JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id AND ivis.is_deleted = false
            WHERE (
                UPPER(TRIM(ivi.serial_number)) = $1
                OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = $1
            )
              AND (ivi.status = 'PASS' OR (ivi.status = 'FAIL' AND ivi.passed_to_next_stage = true))
              AND COALESCE(ivi.route, 'ECN') = 'ECN'
              AND ivi.is_deleted = false
        `;

        const queryParams: any[] = [cleanSerial];
        if (woId) {
            iviQuery += ` AND UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($2))`;
            queryParams.push(woId);
        }

        iviQuery += ` ORDER BY ivi.scanned_at DESC, ivi.id DESC LIMIT 1`;
        const result = await pool.query(iviQuery, queryParams);

        if (result.rows.length === 0) {
            // Check if it exists as NON_ECN route
            const nonEcnCheck = await pool.query(
                `SELECT ivi.id, ivi.route
                 FROM rrh_ivi_inspections ivi
                 JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id AND ivis.is_deleted = false
                 WHERE (
                     UPPER(TRIM(ivi.serial_number)) = $1
                     OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = $1
                 )
                   AND (ivi.status = 'PASS' OR (ivi.status = 'FAIL' AND ivi.passed_to_next_stage = true))
                   AND ivi.route = 'NON_ECN'
                   AND ivi.is_deleted = false
                 ORDER BY ivi.scanned_at DESC, ivi.id DESC LIMIT 1`,
                [cleanSerial]
            );

            if (nonEcnCheck.rows.length > 0) {
                return res.status(200).json({
                    found: false,
                    message: `Unit "${cleanSerial}" is configured for Non-ECN route and cannot be processed in IPQC.`
                });
            }

            return res.status(200).json({
                found: false,
                message: `Unit "${cleanSerial}" not found in passed RRH IVI inspections.`
            });
        }

        const item = result.rows[0];

        // Check if already inspected in IPQC
        let alreadyInspected = false;
        let previousInspection = null;

        if (session_id) {
            const checkRes = await pool.query(
                `SELECT id, status, remarks, scanned_at, scanned_by, checkpoints, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no, e_label, inspection_date, sl_no
                 FROM rrh_ipqc_inspections
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
 * POST /api/rrh/ipqc/sessions/:id/inspections
 * Submit an IPQC inspection record
 */
export const submitInspection = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const operator = getSessionUser(req);

    const {
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
        ivi_inspection_id,
        checkpoints
    } = req.body;

    if (!work_order_id || !serial_number) {
        return res.status(400).json({ message: 'work_order_id and serial_number are required.' });
    }

    // Parse checkpoints
    let parsedCheckpoints: any[] = [];
    if (typeof checkpoints === 'string') {
        try { parsedCheckpoints = JSON.parse(checkpoints); } catch (e) { parsedCheckpoints = []; }
    } else if (Array.isArray(checkpoints)) {
        parsedCheckpoints = checkpoints;
    }

    if (parsedCheckpoints.length < 7) {
        return res.status(400).json({ message: 'All 7 checklist points must be verified and confirmed.' });
    }

    // Verify all checkpoints are confirmed and have failure remarks if failed
    let isOverallPass = true;
    for (const cp of parsedCheckpoints) {
        if (!cp.confirmed) {
            return res.status(400).json({ message: `Point ${cp.id} must be explicitly confirmed.` });
        }
        if (cp.status === 'FAIL') {
            isOverallPass = false;
            if (!cp.remark || !cp.remark.trim()) {
                return res.status(400).json({ message: `Failure remark is mandatory for Point ${cp.id}.` });
            }
        }
    }

    const inspectionStatus = isOverallPass ? 'COMPLETED' : 'FAIL';
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Server-side MES Transition Verification
        const eligibility = await WorkflowEngine.verifyTransition(client, 'ECN_IPQC', work_order_id, serial_number);
        if (!eligibility.eligible) {
            await client.query('ROLLBACK');
            return res.status(422).json({
                message: eligibility.reason || `Unit ${serial_number} cannot enter ECN IPQC due to unmet transition prerequisites.`
            });
        }

        // Cross-session duplicate pass check
        const passCheck = await client.query(
            `SELECT id FROM rrh_ipqc_inspections
             WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
               AND (UPPER(TRIM(serial_number)) = UPPER(TRIM($2)) OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = UPPER(TRIM($2)))
               AND is_deleted = false
               AND status IN ('PASS', 'COMPLETED')
             LIMIT 1`,
            [work_order_id, serial_number]
        );
        if (passCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: `Unit ${serial_number} has already passed ECN IPQC for work order ${work_order_id}.`
            });
        }

        // In-session duplicate pass check
        const sessionPassCheck = await client.query(
            `SELECT id FROM rrh_ipqc_inspections
             WHERE session_id = $1
               AND (UPPER(TRIM(serial_number)) = UPPER(TRIM($2)) OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = UPPER(TRIM($2)))
               AND is_deleted = false
               AND status IN ('PASS', 'COMPLETED')
             LIMIT 1`,
            [sessionId, serial_number]
        );
        if (sessionPassCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: `Unit ${serial_number} has already passed in this session.`
            });
        }

        // Check if there was a previous FAIL record for this serial to track re-inspection
        const prevFailCheck = await client.query(
            `SELECT id, remarks, checkpoints FROM rrh_ipqc_inspections
             WHERE session_id = $1 
               AND (UPPER(TRIM(serial_number)) = UPPER(TRIM($2)) OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = UPPER(TRIM($2)))
               AND status = 'FAIL' 
               AND is_deleted = false
             ORDER BY id DESC LIMIT 1`,
            [sessionId, serial_number]
        );

        let isReinspected = false;
        let defectFixedText = null;

        if (prevFailCheck.rows.length > 0) {
            isReinspected = true;
            // Collect previous failure remarks that were resolved (stripping 'Point X:' prefixes)
            const fixedPoints = parsedCheckpoints
                .filter((c: any) => c.status === 'PASS' && c.previousFailureRemark)
                .map((c: any) => cleanDefectDescription(c.previousFailureRemark.trim()))
                .filter((s: string) => s && s !== '—');

            if (fixedPoints.length > 0) {
                defectFixedText = fixedPoints.join('; ');
            } else if (prevFailCheck.rows[0].remarks) {
                defectFixedText = cleanDefectDescription(prevFailCheck.rows[0].remarks);
            }

            // Remove or update previous FAIL record so active count stays accurate
            await client.query(
                `UPDATE rrh_ipqc_inspections 
                 SET is_deleted = true 
                 WHERE id = $1`,
                [prevFailCheck.rows[0].id]
            );
        }

        let resolvedSlNo = req.body.sl_no;
        if (!resolvedSlNo) {
            const slRes = await client.query(
                `SELECT COALESCE(ivi.sl_no, ins.sl_no, ri.sl_no) as sl_no
                 FROM rrh_ivi_inspections ivi
                 LEFT JOIN rrh_inward_scans ins ON ins.id = ivi.inward_scan_id
                 LEFT JOIN rrh_inventory ri ON (ri.id = ins.matched_inventory_id OR ri.band_serial_no = ivi.band_serial_no)
                 WHERE (ivi.id = $1 OR UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM($2)) OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = UPPER(TRIM($2)))
                   AND ivi.is_deleted = false
                 ORDER BY (CASE WHEN ivi.id = $1 THEN 1 ELSE 0 END) DESC, ivi.scanned_at DESC, ivi.id DESC LIMIT 1`,
                [ivi_inspection_id || 0, serial_number]
            );
            resolvedSlNo = slRes.rows[0]?.sl_no || null;
        }

        const insertQuery = `
            INSERT INTO rrh_ipqc_inspections (
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
                ivi_inspection_id,
                checkpoints,
                is_reinspected,
                defect_fixed,
                sl_no,
                route
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, 
                COALESCE($8, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date), 
                $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
            ) RETURNING *
        `;

        const insertRes = await client.query(insertQuery, [
            sessionId,
            work_order_id,
            serial_number,
            band_serial_no || serial_number,
            physical_serial_number || band_serial_no || serial_number,
            physical_tpn || null,
            band || getBandFromTpn(physical_tpn),
            inspection_date || null,
            e_label || null,
            pam_tpn || null,
            pam1 || null,
            pam2 || null,
            pam3 || null,
            pam4 || null,
            rfpc_tpn || null,
            rfpc_sl_no || null,
            inspectionStatus,
            remarks || null,
            operator.name || operator.username,
            ivi_inspection_id || null,
            JSON.stringify(parsedCheckpoints),
            isReinspected,
            defectFixedText,
            resolvedSlNo,
            'ECN'
        ]);

        if (isReinspected && prevFailCheck.rows.length > 0) {
            await client.query(
                `UPDATE rrh_ipqc_inspections 
                 SET superseded_by_id = $1, superseded_at = CURRENT_TIMESTAMP
                 WHERE id = $2`,
                [insertRes.rows[0].id, prevFailCheck.rows[0].id]
            );
        }

        await client.query('COMMIT');
        logger.info(`Recorded IPQC inspection ID ${insertRes.rows[0].id} (${inspectionStatus}) for serial ${serial_number}`);

        return res.status(201).json({
            success: true,
            inspection: insertRes.rows[0]
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        if (err.code === '23505' || /unique|uq_rrh_/i.test(err.message)) {
            logger.warn(`[RRH-IPQC] Duplicate concurrent scan safely rejected for serial ${serial_number}: ${err.message}`);
            return res.status(409).json({
                message: `Duplicate active scan: unit "${serial_number}" has already been recorded in IPQC.`,
                error: err.message
            });
        }
        logger.error(`Error in submitInspection: ${err.message}`);
        return res.status(500).json({ message: 'Failed to record IPQC inspection.', error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/rrh/ipqc/sessions/:id/inspections
 * Fetch Scanned Products Logs (completed/passed) for this IPQC session
 */
export const getScannedInspections = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const search = (req.query.search as string || '').trim();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
    const offset = (page - 1) * limit;

    try {
        const params: any[] = [sessionId];
        let searchClause = '';
        if (search) {
            params.push(`%${search}%`);
            searchClause = `
                AND (
                    i.serial_number ILIKE $${params.length}
                    OR i.band_serial_no ILIKE $${params.length}
                    OR i.physical_serial_number ILIKE $${params.length}
                    OR i.physical_tpn ILIKE $${params.length}
                    OR i.e_label ILIKE $${params.length}
                    OR i.pam_tpn ILIKE $${params.length}
                    OR i.pam1 ILIKE $${params.length}
                    OR i.pam2 ILIKE $${params.length}
                    OR i.pam3 ILIKE $${params.length}
                    OR i.pam4 ILIKE $${params.length}
                    OR i.rfpc_tpn ILIKE $${params.length}
                    OR i.rfpc_sl_no ILIKE $${params.length}
                    OR i.remarks ILIKE $${params.length}
                )
            `;
        }

        const countRes = await pool.query(
            `SELECT COUNT(*)::int as total
             FROM rrh_ipqc_inspections i
             WHERE i.session_id = $1 
               AND i.status IN ('COMPLETED', 'PASS') 
               AND i.is_deleted = false
               ${searchClause}`,
            params
        );
        const total = countRes.rows[0]?.total || 0;

        const dataRes = await pool.query(
            `SELECT i.*,
                    COALESCE(i.sl_no, ivi.sl_no) as sl_no,
                    COALESCE(ivi.tejas_dc_no, '—') as tejas_dc_no,
                    COALESCE(ivi.tejas_obd_no, '—') as tejas_obd_no,
                    COALESCE(ivi.bat_lot_no, '—') as lot
             FROM rrh_ipqc_inspections i
             LEFT JOIN LATERAL (
                 SELECT ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.sl_no
                 FROM rrh_ivi_inspections ivi
                 WHERE (ivi.id = i.ivi_inspection_id 
                    OR (UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(i.serial_number)) AND UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(i.work_order_id))))
                   AND ivi.is_deleted = false
                 ORDER BY (CASE WHEN ivi.id = i.ivi_inspection_id THEN 1 ELSE 0 END) DESC, ivi.scanned_at DESC, ivi.id DESC
                 LIMIT 1
             ) ivi ON true
             WHERE i.session_id = $1 
               AND i.status IN ('COMPLETED', 'PASS') 
               AND i.is_deleted = false
               ${searchClause}
             ORDER BY i.scanned_at DESC, i.id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
        );

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
        return res.status(500).json({ message: 'Failed to fetch scanned products logs.', error: err.message });
    }
};

/**
 * GET /api/rrh/ipqc/sessions/:id/failed-inspections
 * Fetch failed inspections for this IPQC session
 */
export const getFailedInspections = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;

    try {
        const dataRes = await pool.query(
            `SELECT i.*,
                    COALESCE(i.sl_no, ivi.sl_no) as sl_no,
                    COALESCE(ivi.tejas_dc_no, '—') as tejas_dc_no,
                    COALESCE(ivi.tejas_obd_no, '—') as tejas_obd_no,
                    COALESCE(ivi.bat_lot_no, '—') as lot
             FROM rrh_ipqc_inspections i
             LEFT JOIN LATERAL (
                 SELECT ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.sl_no
                 FROM rrh_ivi_inspections ivi
                 WHERE (ivi.id = i.ivi_inspection_id 
                    OR (UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(i.serial_number)) AND UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(i.work_order_id))))
                   AND ivi.is_deleted = false
                 ORDER BY (CASE WHEN ivi.id = i.ivi_inspection_id THEN 1 ELSE 0 END) DESC, ivi.scanned_at DESC, ivi.id DESC
                 LIMIT 1
             ) ivi ON true
             WHERE i.session_id = $1 
               AND i.status = 'FAIL' 
               AND i.is_deleted = false
             ORDER BY i.scanned_at DESC, i.id DESC`,
            [sessionId]
        );

        return res.status(200).json({
            success: true,
            data: dataRes.rows
        });
    } catch (err: any) {
        logger.error(`Error in getFailedInspections: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch failed inspections.', error: err.message });
    }
};

/**
 * GET /api/rrh/ipqc/sessions/:id/export
 * Export Scanned Products Logs to Excel matching SMT Post AOI standard
 */
export const exportIpqcExcel = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const operator = getSessionUser(req);

    try {
        const sessionRes = await pool.query(
            `SELECT s.*, 
                    COALESCE(w.lot_quantity, 0) as lot_quantity, 
                    COALESCE(w.work_order_date, w.date) as work_order_date,
                    (
                        SELECT ri.lot 
                        FROM rrh_inventory ri 
                        WHERE ri.import_id = w.active_import_id 
                           OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id))
                        LIMIT 1
                    ) as lot_number,
                    w.status as wo_status
             FROM rrh_ipqc_sessions s
             LEFT JOIN rrh_work_orders w ON UPPER(TRIM(w.work_order_id)) = UPPER(TRIM(s.work_order_id))
             WHERE s.id = $1 AND s.is_deleted = false`,
            [sessionId]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'IPQC session not found.' });
        }

        const session = sessionRes.rows[0];

        const type = (req.query.type as string || req.query.status as string || '').toUpperCase();
        const isFail = type === 'FAIL' || type === 'FAILED';
        const isRecent = type === 'PASS' || type === 'RECENT' || type === 'COMPLETED';
        let statusClause = '1=1';
        if (isFail) {
            statusClause = `(UPPER(TRIM(i.status)) IN ('FAIL', 'FAILED') OR i.status ILIKE '%fail%')`;
        } else if (isRecent) {
            statusClause = `(UPPER(TRIM(i.status)) IN ('COMPLETED', 'PASS') OR i.status ILIKE '%pass%' OR i.status ILIKE '%complete%') AND UPPER(TRIM(i.status)) NOT IN ('FAIL', 'FAILED')`;
        }

        // Summary counts
        const countRes = await pool.query(
            `SELECT 
                COUNT(*)::int as total_scanned,
                COUNT(*) FILTER (WHERE (UPPER(TRIM(status)) IN ('PASS', 'COMPLETED') OR status ILIKE '%pass%' OR status ILIKE '%complete%') AND UPPER(TRIM(status)) NOT IN ('FAIL', 'FAILED'))::int as passed_count,
                COUNT(*) FILTER (WHERE UPPER(TRIM(status)) IN ('FAIL', 'FAILED') OR status ILIKE '%fail%')::int as failed_count
             FROM rrh_ipqc_inspections
             WHERE session_id = $1 AND is_deleted = false
               AND COALESCE(route, 'ECN') = 'ECN'`,
            [sessionId]
        );
        const totalScanned = countRes.rows[0]?.total_scanned || 0;
        const passedCount = countRes.rows[0]?.passed_count || 0;
        const failedCount = countRes.rows[0]?.failed_count || 0;
        const lotQty = Number(session.lot_quantity) || 0;
        const pending = Math.max(0, lotQty - passedCount);
        const yieldPercent = lotQty > 0
            ? ((passedCount / lotQty) * 100).toFixed(2) + '%'
            : (totalScanned > 0 ? ((passedCount / totalScanned) * 100).toFixed(2) + '%' : '0.00%');

        const inspectionsRes = await pool.query(
            `SELECT i.*,
                    COALESCE(i.sl_no, ivi.sl_no) as sl_no,
                    COALESCE(ivi.tejas_dc_no, '—') as tejas_dc_no,
                    COALESCE(ivi.tejas_obd_no, '—') as tejas_obd_no,
                    COALESCE(ivi.bat_lot_no, '—') as lot
             FROM rrh_ipqc_inspections i
             LEFT JOIN LATERAL (
                 SELECT ivi.tejas_dc_no, ivi.tejas_obd_no, ivi.bat_lot_no, ivi.sl_no
                 FROM rrh_ivi_inspections ivi
                 WHERE (ivi.id = i.ivi_inspection_id 
                    OR (UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(i.serial_number)) AND UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(i.work_order_id))))
                   AND ivi.is_deleted = false
                 ORDER BY (CASE WHEN ivi.id = i.ivi_inspection_id THEN 1 ELSE 0 END) DESC, ivi.scanned_at DESC, ivi.id DESC
                 LIMIT 1
             ) ivi ON true
             WHERE i.session_id = $1 
               AND ${statusClause} 
               AND i.is_deleted = false
             ORDER BY i.scanned_at DESC, i.id DESC`,
            [sessionId]
        );

        const getDefectFixedText = (r: any): string => {
            if (!r.is_reinspected) return '—';
            if (r.defect_fixed && r.defect_fixed.trim()) {
                const cleaned = cleanDefectDescription(r.defect_fixed.trim());
                if (cleaned && cleaned !== '—') return cleaned;
            }
            let cps = r.checkpoints;
            if (typeof cps === 'string') {
                try { cps = JSON.parse(cps); } catch { cps = null; }
            }
            if (Array.isArray(cps)) {
                const fixed = cps
                    .filter((c: any) => c.previousFailureRemark && c.previousFailureRemark.trim())
                    .map((c: any) => cleanDefectDescription(c.previousFailureRemark.trim()))
                    .filter((s: string) => s && s !== '—');
                if (fixed.length > 0) return fixed.join('; ');
            }
            return '—';
        };

        const tableRows = inspectionsRes.rows.map((r, idx) => {
            const dateStr = r.scanned_at ? new Date(r.scanned_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '—';
            const inspDateStr = r.inspection_date ? (typeof r.inspection_date === 'string' ? r.inspection_date.split('T')[0] : (r.inspection_date instanceof Date ? `${r.inspection_date.getFullYear()}-${String(r.inspection_date.getMonth() + 1).padStart(2, '0')}-${String(r.inspection_date.getDate()).padStart(2, '0')}` : String(r.inspection_date).split('T')[0])) : '—';

            let failedRemarks = cleanDefectDescription(r.remarks);
            if (r.checkpoints) {
                try {
                    const cps = typeof r.checkpoints === 'string' ? JSON.parse(r.checkpoints) : r.checkpoints;
                    const fails = Array.isArray(cps) ? cps.filter((c: any) => c.status === 'FAIL') : [];
                    if (fails.length > 0) {
                        const failTexts = fails
                            .map((c: any) => cleanDefectDescription(c.remark || c.description || ''))
                            .filter((s: string) => s && s !== '—');
                        if (failTexts.length > 0) failedRemarks = failTexts.join('; ');
                    }
                } catch { }
            }
            if (!failedRemarks || failedRemarks === '-') failedRemarks = '—';

            const isRowFail = (r.status || '').toUpperCase() === 'FAIL' || (r.status || '').toUpperCase() === 'FAILED';
            const rowRemarks = isRowFail
                ? failedRemarks
                : (getDefectFixedText(r) !== '—' ? getDefectFixedText(r) : (cleanDefectDescription(r.remarks) || '—'));

            return {
                sl: r.sl_no || (idx + 1),
                band_serial_no: r.band_serial_no || r.serial_number || '—',
                physical_serial_number: r.physical_serial_number || r.band_serial_no || r.serial_number || '—',
                physical_tpn: r.physical_tpn || '—',
                band: r.band || getBandFromTpn(r.physical_tpn),
                inspection_date: inspDateStr,
                status: r.status || '—',
                scanned_by: r.scanned_by || '—',
                scanned_at: dateStr,
                remarks: rowRemarks
            };
        });

        const title = isFail 
            ? 'RRH IPQC FAILED INSPECTIONS REPORT' 
            : (isRecent ? 'RRH IPQC RECENT INSPECTIONS REPORT' : 'RRH IPQC SESSION REPORT');
        const section4Title = isFail ? 'FAILED INSPECTIONS HISTORY' : (isRecent ? 'RECENT INSPECTIONS HISTORY (PASSED)' : 'SCAN HISTORY');
        const filePrefix = isFail ? 'RRH_IPQC_Failed_Inspections' : (isRecent ? 'RRH_IPQC_Recent_Inspections' : 'RRH_IPQC_Session');

        await sendRrhSessionExcel(res, `${filePrefix}_${session.work_order_id}.xlsx`, {
            title,
            stageName: 'RRH IPQC',
            route: 'ECN',
            operatorName: operator.name || operator.username,
            workOrder: {
                id: session.work_order_id,
                date: session.work_order_date,
                quantity: session.lot_quantity,
                lotNumber: session.lot_number,
                status: session.wo_status
            },
            session: {
                id: session.id,
                status: session.status,
                createdBy: session.created_by,
                createdAt: session.created_at
            },
            productionSummary: {
                total: lotQty,
                passed: passedCount,
                failed: failedCount,
                pending: pending,
                yieldPercent: yieldPercent
            },
            section4Title,
            columns: [
                { header: 'SL No', key: 'sl', width: 8, align: 'center' },
                { header: 'Band Serial No', key: 'band_serial_no', width: 22, align: 'left' },
                { header: 'Physical Serial No', key: 'physical_serial_number', width: 22, align: 'left' },
                { header: 'Physical TPN', key: 'physical_tpn', width: 20, align: 'left' },
                { header: 'Band', key: 'band', width: 12, align: 'center' },
                { header: 'Inspection Date', key: 'inspection_date', width: 16, align: 'center' },
                { header: 'Status', key: 'status', width: 14, align: 'center' },
                { header: 'Scanned By', key: 'scanned_by', width: 20, align: 'left' },
                { header: 'Date & Time', key: 'scanned_at', width: 24, align: 'center' },
                { header: isFail ? 'Failed Remarks' : (isRecent ? 'Remarks / Defect Fixed' : 'Remarks / Defect Details'), key: 'remarks', width: 30, align: 'left' }
            ],
            rows: tableRows,
            sheetName: isFail ? 'Failed Inspections' : (isRecent ? 'Recent Inspections' : 'Session Report')
        });
    } catch (err: any) {
        logger.error(`Error in exportIpqcExcel: ${err.message}`);
        return res.status(500).json({ message: 'Failed to export IPQC Excel.', error: err.message });
    }
};

/**
 * GET /api/rrh/ipqc/sessions/:id/export-unscanned
 * Export remaining unscanned master data to Excel
 */
export const exportUnscannedExcel = async (req: Request, res: Response) => {
    const { id: sessionId } = req.params;

    try {
        const sessionRes = await pool.query(
            `SELECT work_order_id FROM rrh_ipqc_sessions WHERE id = $1 AND is_deleted = false`,
            [sessionId]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'IPQC session not found.' });
        }

        const woId = sessionRes.rows[0].work_order_id;

        const dataRes = await pool.query(
            `WITH latest_ivi AS (
                SELECT DISTINCT ON (UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))
                    ivi.id as ivi_id,
                    COALESCE(
                        ivi.sl_no,
                        (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE ins.id = ivi.inward_scan_id LIMIT 1),
                        (SELECT ins.sl_no FROM rrh_inward_scans ins WHERE UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(ivi.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(ivi.serial_number)) LIMIT 1),
                        (SELECT ri.sl_no FROM rrh_inventory ri WHERE UPPER(TRIM(ri.band_serial_no)) = UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))) LIMIT 1)
                    ) as sl_no,
                    ivi.physical_tpn,
                    COALESCE(ivi.band_serial_no, ivi.serial_number) as band_serial_no,
                    ivi.duplexer_main,
                    ivi.duplexer_part_no,
                    ivi.rrh_unit,
                    ivi.status as ivi_status,
                    ivi.tejas_dc_no,
                    ivi.bat_lot_no as lot,
                    ivi.remarks,
                    ivi.scanned_at as ivi_scanned_at
                FROM rrh_ivi_inspections ivi
                JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id AND ivis.is_deleted = false
                WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
                  AND (ivi.status = 'PASS' OR (ivi.status = 'FAIL' AND ivi.passed_to_next_stage = true))
                  AND COALESCE(ivi.route, 'ECN') = 'ECN'
                  AND ivi.is_deleted = false
                ORDER BY UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))), ivi.scanned_at DESC, ivi.id DESC
            )
            SELECT 
                ivi.ivi_id,
                ivi.sl_no,
                ivi.physical_tpn,
                ivi.band_serial_no,
                ivi.duplexer_main,
                ivi.duplexer_part_no,
                ivi.rrh_unit,
                ivi.ivi_status,
                ivi.tejas_dc_no,
                ivi.lot,
                ivi.remarks
            FROM latest_ivi ivi
            WHERE NOT EXISTS (
                SELECT 1 FROM rrh_ipqc_inspections ipqc
                WHERE (ipqc.session_id = $2 OR UPPER(TRIM(ipqc.work_order_id)) = UPPER(TRIM($1)))
                  AND ipqc.is_deleted = false
                  AND (
                      ipqc.ivi_inspection_id = ivi.ivi_id
                      OR UPPER(TRIM(ipqc.serial_number)) = UPPER(TRIM(ivi.band_serial_no))
                      OR UPPER(TRIM(COALESCE(ipqc.band_serial_no, ''))) = UPPER(TRIM(ivi.band_serial_no))
                  )
            )
            ORDER BY ivi.ivi_scanned_at DESC, ivi.ivi_id DESC`,
            [woId, sessionId]
        );

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Unscanned Master Data');

        worksheet.columns = [
            { header: 'S.NO.', key: 'sno', width: 8 },
            { header: 'PHYSICAL TPN', key: 'physical_tpn', width: 22 },
            { header: 'BAND SERIAL NUMBER', key: 'band_serial', width: 24 },
            { header: 'DUPLEXER MAIN (IVI)', key: 'duplexer_main', width: 22 },
            { header: 'DUPLEXER PART NO (IVI)', key: 'duplexer_part_no', width: 24 },
            { header: 'RRH UNIT (IVI)', key: 'rrh_unit', width: 20 },
            { header: 'IVI STATUS', key: 'ivi_status', width: 14 },
            { header: 'TEJAS DC NO', key: 'tejas_dc_no', width: 20 },
            { header: 'LOT', key: 'lot', width: 16 },
            { header: 'REMARKS', key: 'remarks', width: 25 },
        ];

        worksheet.getRow(1).eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '0E7490' } // Cyan/Teal
            };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        worksheet.getRow(1).height = 28;

        dataRes.rows.forEach((r, idx) => {
            const row = worksheet.addRow({
                sno: r.sl_no ?? (idx + 1),
                physical_tpn: r.physical_tpn || '—',
                band_serial: r.band_serial_no,
                duplexer_main: r.duplexer_main || '—',
                duplexer_part_no: r.duplexer_part_no || '—',
                rrh_unit: r.rrh_unit || '—',
                ivi_status: r.ivi_status,
                tejas_dc_no: r.tejas_dc_no || '—',
                lot: r.lot || '—',
                remarks: r.remarks || '—'
            });

            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'E2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                    left: { style: 'thin', color: { argb: 'E2E8F0' } },
                    right: { style: 'thin', color: { argb: 'E2E8F0' } }
                };
            });
            const maxLines = Math.max(
                estimateTextLines(r.remarks, 25),
                estimateTextLines(r.duplexer_part_no, 24),
                estimateTextLines(r.band_serial_no, 24),
                1
            );
            row.height = Math.max(24, maxLines * 18 + 6);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=RRH_IPQC_Unscanned_Master_${woId}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error(`Error in exportUnscannedExcel: ${err.message}`);
        return res.status(500).json({ message: 'Failed to export unscanned Excel.', error: err.message });
    }
};
