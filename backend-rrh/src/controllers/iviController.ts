import { Request, Response } from 'express';
import { pool } from '../utils/db';
import { createLogger } from '../utils/logger';
import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { getUploadsDir } from '../utils/uploads';
import { sendRrhSessionExcel } from '../utils/rrhExcelGenerator';

const logger = createLogger('IviController');

// ─── SKU to Band Mapping ──────────────────────────────────────────────────────
export const SKU_TO_BAND_MAP: Record<string, string> = {
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

export function getBandFromTpn(tpn: string | null | undefined): string {
    if (!tpn) return '—';
    const clean = tpn.trim().toUpperCase();
    return SKU_TO_BAND_MAP[clean] || SKU_TO_BAND_MAP[tpn.trim()] || '—';
}

import { getSessionUser } from '../utils/authHelper';
export { getSessionUser };

// ─── Helper to clean defect text (removes 'Point 1:', 'Point 1 -', 'point2:', etc.) ─────────
export const cleanDefectDescription = (text: string | null | undefined): string => {
    if (!text || text === '—' || text === '-' || text === 'no defect') return text || '—';
    const parts = String(text).split(/;\s*|\n+/);
    const cleaned = parts
        .map((p) => {
            let s = p.trim();
            // Remove variations of point prefixes: "Point 1:", "Point 1 -", "point1:", "1: ", "Point: ", etc.
            s = s.replace(/^(?:point\s*\d+[\s:\-–.]*|point[\s:\-–.]*|:?\s*\d+\s*[:\-–.]\s*)/i, '').trim();
            return s;
        })
        .filter((p) => p.length > 0 && p !== '—' && p !== '-');

    return cleaned.length > 0 ? cleaned.join('; ') : (text ? String(text).trim() : '—');
};

/**
 * GET /api/rrh/ivi/eligible-work-orders
 * Return RRH work orders that are NOT currently active in IVI (In Progress, Pending, Paused)
 * and NOT completed in IVI (Completed).
 */
export const getEligibleIviWorkOrders = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                w.id,
                w.work_order_id,
                COALESCE(w.work_order_date, w.date) as work_order_date,
                w.lot_quantity,
                w.status,
                w.created_at,
                COALESCE(
                    (
                        SELECT ri.lot 
                        FROM rrh_inventory ri 
                        WHERE ri.import_id = w.active_import_id 
                           OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id))
                        LIMIT 1
                    ),
                    (
                        SELECT rii.bat_lot_no 
                        FROM rrh_ivi_inspections rii 
                        WHERE UPPER(TRIM(rii.work_order_id)) = UPPER(TRIM(w.work_order_id)) 
                          AND rii.bat_lot_no IS NOT NULL AND rii.bat_lot_no != '' 
                        LIMIT 1
                    ),
                    '—'
                ) as lot_number
            FROM rrh_work_orders w
            WHERE (w.is_deleted IS NULL OR w.is_deleted = false)
              AND NOT EXISTS (
                SELECT 1
                FROM rrh_ivi_sessions s
                WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id))
                  AND s.is_deleted = false
                  AND UPPER(TRIM(s.status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')
            )
            ORDER BY w.created_at DESC, w.id DESC
        `);
        return res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error('Error in getEligibleIviWorkOrders: ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch eligible work orders.', error: err.message });
    }
};

/**
 * POST /api/rrh/ivi/sessions
 * Start or resume an IVI session
 */
export const createIviSession = async (req: Request, res: Response) => {
    const { work_order_id, route } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id) {
        return res.status(400).json({ message: 'work_order_id is required.' });
    }

    const rawRoute = (route || req.body.selected_route || 'ECN').toString().trim().toUpperCase().replace('-', '_');
    const cleanRoute = rawRoute === 'NON_ECN' ? 'NON_ECN' : 'ECN';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if an active session already exists for this Work Order
        const activeCheck = await client.query(
            `SELECT * FROM rrh_ivi_sessions 
             WHERE work_order_id = $1 
               AND status IN ('Pending', 'In Progress', 'Paused') 
               AND is_deleted = false
             ORDER BY created_at DESC 
             LIMIT 1`,
            [work_order_id]
        );

        if (activeCheck.rows.length > 0) {
            const existing = activeCheck.rows[0];
            if (existing.status !== 'In Progress') {
                await client.query(
                    `UPDATE rrh_ivi_sessions SET status = 'In Progress', route = COALESCE(route, $2), updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [existing.id, cleanRoute]
                );
                existing.status = 'In Progress';
            }
            await client.query('COMMIT');
            return res.status(200).json(existing);
        }

        // Create new IVI session
        const insertRes = await client.query(
            `INSERT INTO rrh_ivi_sessions (
                work_order_id, 
                status, 
                created_by, 
                created_by_name,
                route
             ) VALUES ($1, 'In Progress', $2, $3, $4)
             RETURNING *`,
            [work_order_id, operator.username, operator.name, cleanRoute]
        );

        const woMeta = await client.query(
            `SELECT (SELECT ri.lot FROM rrh_inventory ri WHERE ri.import_id = w.active_import_id LIMIT 1) as lot_number, w.lot_quantity FROM rrh_work_orders w WHERE UPPER(TRIM(w.work_order_id)) = UPPER(TRIM($1))`,
            [work_order_id]
        );
        const newSession = { ...insertRes.rows[0], lot_number: woMeta.rows[0]?.lot_number || null, lot_quantity: woMeta.rows[0]?.lot_quantity || null };
        await client.query('COMMIT');
        logger.info(`Started new IVI session ID ${insertRes.rows[0].id} for Work Order ${work_order_id} (Route: ${cleanRoute})`);
        return res.status(201).json(newSession);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error(`Error in createIviSession: ${err.message}`);
        return res.status(500).json({ message: 'Failed to create IVI session.', error: err.message });
    } finally {
        client.release();
    }
};

/**
 * GET /api/rrh/ivi/sessions
 * List IVI sessions with status, search and pagination
 */
export const getIviSessions = async (req: Request, res: Response) => {
    const { status, search, page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit as string, 10) || 10);
    const offset = (pageNum - 1) * limitNum;

    try {
        let whereClauses: string[] = ['s.is_deleted = false'];
        let params: any[] = [];
        let pIndex = 1;

        if (status) {
            const statuses = (status as string).split(',').map(s => s.trim());
            whereClauses.push(`s.status = ANY($${pIndex})`);
            params.push(statuses);
            pIndex++;
        }

        if (search) {
            whereClauses.push(`s.work_order_id ILIKE $${pIndex}`);
            params.push(`%${(search as string).trim()}%`);
            pIndex++;
        }

        const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Count query
        const countRes = await pool.query(
            `SELECT COUNT(*) FROM rrh_ivi_sessions s ${whereSql}`,
            params
        );
        const total = parseInt(countRes.rows[0].count, 10) || 0;

        // Data query
        params.push(limitNum, offset);
        const dataRes = await pool.query(
            `SELECT s.*, w.lot_quantity, w.work_order_date, w.date,
                    COALESCE(
                        (
                            SELECT ri.lot 
                            FROM rrh_inventory ri 
                            WHERE ri.import_id = w.active_import_id 
                               OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id))
                            LIMIT 1
                        ),
                        (
                            SELECT insp.bat_lot_no 
                            FROM rrh_ivi_inspections insp 
                            WHERE insp.session_id = s.id AND insp.bat_lot_no IS NOT NULL AND insp.bat_lot_no != '' 
                            LIMIT 1
                        )
                    ) as lot_number
             FROM rrh_ivi_sessions s
             LEFT JOIN rrh_work_orders w ON UPPER(TRIM(w.work_order_id)) = UPPER(TRIM(s.work_order_id))
             ${whereSql}
             ORDER BY s.created_at DESC
             LIMIT $${pIndex} OFFSET $${pIndex + 1}`,
            params
        );

        return res.status(200).json({
            sessions: dataRes.rows,
            total,
            page: pageNum,
            limit: limitNum
        });
    } catch (err: any) {
        logger.error(`Error in getIviSessions: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch IVI sessions.', error: err.message });
    }
};

/**
 * GET /api/rrh/ivi/sessions/:id
 * Get single IVI session with stats & lot quantity
 */
export const getIviSessionById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const sessionRes = await pool.query(
            `SELECT s.*, w.lot_quantity, w.work_order_date, w.date,
                    COALESCE(
                        (
                            SELECT ri.lot 
                            FROM rrh_inventory ri 
                            WHERE ri.import_id = w.active_import_id 
                               OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id))
                            LIMIT 1
                        ),
                        (
                            SELECT insp.bat_lot_no 
                            FROM rrh_ivi_inspections insp 
                            WHERE insp.session_id = s.id AND insp.bat_lot_no IS NOT NULL AND insp.bat_lot_no != '' 
                            LIMIT 1
                        )
                    ) as lot_number
             FROM rrh_ivi_sessions s
             LEFT JOIN rrh_work_orders w ON UPPER(TRIM(w.work_order_id)) = UPPER(TRIM(s.work_order_id))
             WHERE s.id = $1 AND s.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'IVI session not found.' });
        }

        const session = sessionRes.rows[0];
        const lotQuantity = parseInt(session.lot_quantity, 10) || 0;

        // Fetch inward total and aggregated inspection statistics concurrently
        const [inwardCountRes, statsRes] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int as inward_total 
                 FROM rrh_inward_scans 
                 WHERE work_order_id = $1 AND status = 'PASS' AND is_deleted = false`,
                [session.work_order_id]
            ),
            pool.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE status = 'PASS')::int AS passed,
                    COUNT(*) FILTER (WHERE status = 'FAIL')::int AS failed,
                    COUNT(*) FILTER (WHERE status = 'SCRAP')::int AS scrapped,
                    COUNT(*)::int AS total
                 FROM rrh_ivi_inspections 
                 WHERE session_id = $1 AND is_deleted = false`,
                [id]
            )
        ]);

        const totalInwarded = inwardCountRes.rows[0]?.inward_total || 0;
        const row = statsRes.rows[0] || {};
        const passed = row.passed || 0;
        const failed = row.failed || 0;
        const scrapped = row.scrapped || 0;
        const total = row.total || 0;
        const pending = Math.max(0, lotQuantity - passed - scrapped);
        const remainingInward = Math.max(0, totalInwarded - passed - scrapped);
        const yieldRate = (lotQuantity > 0 ? (passed / lotQuantity) * 100 : (total > 0 ? (passed / total) * 100 : 100)).toFixed(2);

        return res.status(200).json({
            session,
            stats: {
                lotQuantity,
                totalInwarded,
                remainingInward,
                passed,
                failed,
                scrapped,
                total,
                pending,
                yield: yieldRate
            }
        });
    } catch (err: any) {
        logger.error(`Error in getIviSessionById: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch session.', error: err.message });
    }
};

/**
 * PATCH /api/rrh/ivi/sessions/:id/status
 * Update IVI session status (Completed, Paused, Aborted, In Progress)
 */
export const updateIviSessionStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;
    const operator = getSessionUser(req);

    if (!status) {
        return res.status(400).json({ message: 'status is required.' });
    }

    try {
        const result = await pool.query(
            `UPDATE rrh_ivi_sessions 
             SET status = $1, updated_by = $2, updated_by_name = $3, updated_at = CURRENT_TIMESTAMP
             WHERE id = $4 AND is_deleted = false
             RETURNING *`,
            [status, operator.username, operator.name, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'IVI session not found.' });
        }

        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error(`Error in updateIviSessionStatus: ${err.message}`);
        return res.status(500).json({ message: 'Failed to update status.', error: err.message });
    }
};

/**
 * DELETE /api/rrh/ivi/sessions/:id
 * Soft delete an IVI session
 */
export const deleteIviSession = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        const result = await pool.query(
            `UPDATE rrh_ivi_sessions 
             SET is_deleted = true, deleted_by = $1, deleted_by_name = $2, deleted_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND is_deleted = false
             RETURNING *`,
            [operator.username, operator.name, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'IVI session not found or already deleted.' });
        }

        return res.status(200).json({ message: 'Session deleted successfully.' });
    } catch (err: any) {
        logger.error(`Error in deleteIviSession: ${err.message}`);
        return res.status(500).json({ message: 'Failed to delete session.', error: err.message });
    }
};

/**
 * GET /api/rrh/ivi/sessions/:id/remaining-master-data
 * Returns uninspected master records for the active IVI session
 * fetched from RRH Inward scanned logs (rrh_inward_scans where status = 'PASS').
 * Deducts units that have already been inspected in IVI for this session.
 * Supports search and pagination.
 */
export const getRemainingInwardMasterData = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limitParam = req.query.limit as string;
        let limit = 10;
        if (limitParam === 'all' || limitParam === '-1') {
            limit = 10000;
        } else {
            const parsedLimit = parseInt(limitParam, 10);
            if (!isNaN(parsedLimit) && parsedLimit > 0) {
                limit = Math.min(parsedLimit, 10000);
            }
        }
        const offset = (page - 1) * limit;
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

        // 1. Get session work_order_id
        const sessionRes = await pool.query(
            `SELECT s.work_order_id, s.id, w.lot_quantity, w.work_order_date, w.date
             FROM rrh_ivi_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'IVI session not found.' });
        }

        const session = sessionRes.rows[0];
        const woId = session.work_order_id;

        // 2. Base query params
        const queryParams: any[] = [woId, id];
        let searchClause = '';

        if (search) {
            queryParams.push(`%${search}%`);
            const sIdx = queryParams.length;
            searchClause = ` AND (
                ins.serial_number ILIKE $${sIdx}
                OR ins.band_serial_no ILIKE $${sIdx}
                OR ins.physical_tpn ILIKE $${sIdx}
                OR ri.physical_tpn ILIKE $${sIdx}
                OR ri.tejas_dc_no ILIKE $${sIdx}
                OR ri.tejas_obd_no ILIKE $${sIdx}
                OR ri.lot ILIKE $${sIdx}
                OR ins.sl_no ILIKE $${sIdx}
                OR ri.sl_no ILIKE $${sIdx}
            )`;
        }

        // 3. Count total remaining inward units not yet inspected in this IVI session
        const countQuery = `
            SELECT COUNT(ins.id)::int as total
            FROM rrh_inward_scans ins
            LEFT JOIN rrh_inventory ri ON ri.id = ins.matched_inventory_id
            WHERE ins.work_order_id = $1
              AND ins.status IN ('PASS', 'EDITED PASS')
              AND ins.is_deleted = false
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_ivi_inspections ivi
                  WHERE ivi.session_id = $2 AND ivi.is_deleted = false
                    AND (
                        UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(ins.serial_number))
                        OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = UPPER(TRIM(ins.serial_number))
                        OR (ins.band_serial_no IS NOT NULL AND (
                            UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(ins.band_serial_no))
                            OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = UPPER(TRIM(ins.band_serial_no))
                        ))
                    )
              )
              ${searchClause}
        `;

        const countRes = await pool.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        // 4. Stable global row number across all passed inward scans for this WO
        const remainingParams: any[] = [woId, id];
        if (search) {
            remainingParams.push(`%${search}%`);
        }
        const searchFilter = search
            ? `AND (
                ins.serial_number ILIKE $3
                OR ins.band_serial_no ILIKE $3
                OR ins.physical_tpn ILIKE $3
                OR ri.physical_tpn ILIKE $3
                OR ri.tejas_dc_no ILIKE $3
                OR ri.tejas_obd_no ILIKE $3
                OR ri.lot ILIKE $3
                OR ins.sl_no ILIKE $3
                OR ri.sl_no ILIKE $3
            )`
            : '';

        const dataQuery = `
            WITH all_wo_inward AS (
                SELECT ins.id,
                       ROW_NUMBER() OVER (ORDER BY ins.id ASC) AS global_row_number
                FROM rrh_inward_scans ins
                WHERE ins.work_order_id = $1
                  AND ins.status IN ('PASS', 'EDITED PASS')
                  AND ins.is_deleted = false
            )
            SELECT
                ins.id,
                ins.id as inward_scan_id,
                ins.work_order_id,
                ins.serial_number,
                ins.band_serial_no,
                COALESCE(ins.physical_tpn, ri.physical_tpn) as physical_tpn,
                ins.scanned_by as inward_scanned_by,
                ins.scanned_at as inward_scanned_at,
                ri.tejas_dc_no,
                ri.tejas_obd_no,
                ri.lot as bat_lot_no,
                COALESCE(ins.sl_no, ri.sl_no) as sl_no,
                rwo.work_order_date,
                rwo.date,
                awi.global_row_number
            FROM rrh_inward_scans ins
            JOIN all_wo_inward awi ON awi.id = ins.id
            LEFT JOIN rrh_inventory ri ON ri.id = ins.matched_inventory_id
            LEFT JOIN rrh_work_orders rwo ON rwo.work_order_id = ins.work_order_id
            WHERE ins.work_order_id = $1
              AND ins.status IN ('PASS', 'EDITED PASS')
              AND ins.is_deleted = false
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_ivi_inspections ivi
                  WHERE ivi.session_id = $2 AND ivi.is_deleted = false
                    AND (
                        UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(ins.serial_number))
                        OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = UPPER(TRIM(ins.serial_number))
                        OR (ins.band_serial_no IS NOT NULL AND (
                            UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(ins.band_serial_no))
                            OR UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))) = UPPER(TRIM(ins.band_serial_no))
                        ))
                    )
              )
              ${searchFilter}
            ORDER BY ins.id ASC
            LIMIT $${remainingParams.length + 1} OFFSET $${remainingParams.length + 2}
        `;

        const dataRes = await pool.query(dataQuery, [...remainingParams, limit, offset]);

        // Map band for each record
        const enrichedRows = dataRes.rows.map(row => {
            return {
                ...row,
                sl_no: row.sl_no || row.global_row_number?.toString() || null,
                band: getBandFromTpn(row.physical_tpn),
                band_serial_no: row.band_serial_no || row.serial_number
            };
        });

        return res.status(200).json({
            success: true,
            data: enrichedRows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit) || 1
            }
        });
    } catch (err: any) {
        logger.error('Error fetching remaining inward master data: ' + err);
        return res.status(500).json({ message: 'Internal server error while fetching remaining master data.', error: err.message });
    }
};

/**
 * GET /api/rrh/ivi/lookup
 * Query master data by serial number (Band Serial No or Physical SL No)
 * Fetches and checks primarily against RRH Inward scanned logs data
 */
export const lookupSerialDetails = async (req: Request, res: Response) => {
    const { serial, work_order_id } = req.query;

    if (!serial || typeof serial !== 'string' || !serial.trim()) {
        return res.status(400).json({ message: 'serial query parameter is required.' });
    }

    const cleanSerial = serial.trim().toUpperCase();
    const woId = typeof work_order_id === 'string' ? work_order_id.trim() : '';

    try {
        // 1. Search primarily in rrh_inward_scans
        let inwardQuery = `
            SELECT ins.id as inward_scan_id, ins.work_order_id, ins.serial_number, ins.band_serial_no,
                   COALESCE(ins.physical_tpn, ri.physical_tpn) as physical_tpn,
                   ins.status as inward_status, ins.scanned_by as inward_scanned_by,
                   ins.scanned_at as inward_scanned_at,
                   ri.tejas_dc_no, ri.tejas_obd_no, ri.lot as bat_lot_no,
                   COALESCE(ins.sl_no, ri.sl_no) as sl_no,
                   rwo.work_order_date, rwo.date
            FROM rrh_inward_scans ins
            LEFT JOIN rrh_inventory ri ON ri.id = ins.matched_inventory_id
            LEFT JOIN rrh_work_orders rwo ON rwo.work_order_id = ins.work_order_id
            WHERE (
                UPPER(TRIM(ins.serial_number)) = $1 
                OR UPPER(TRIM(ins.band_serial_no)) = $1
                OR UPPER(TRIM(COALESCE(ins.original_serial_number, ''))) = $1
                OR UPPER(TRIM(COALESCE(ins.corrected_serial_number, ''))) = $1
                OR UPPER(TRIM(COALESCE(ins.sl_no, ''))) = $1
                OR UPPER(TRIM(COALESCE(ri.band_serial_no, ''))) = $1
                OR UPPER(TRIM(COALESCE(ri.sl_no, ''))) = $1
            )
              AND ins.is_deleted = false
        `;
        const inwardParams: any[] = [cleanSerial];

        if (woId) {
            inwardQuery += ` AND ins.work_order_id = $2`;
            inwardParams.push(woId);
        }

        inwardQuery += ` ORDER BY ins.id DESC LIMIT 1`;

        let result = await pool.query(inwardQuery, inwardParams);

        // Fallback: If not found under specified work order, search global inward scans
        if (result.rows.length === 0 && woId) {
            const fallbackResult = await pool.query(
                `SELECT ins.id as inward_scan_id, ins.work_order_id, ins.serial_number, ins.band_serial_no,
                        COALESCE(ins.physical_tpn, ri.physical_tpn) as physical_tpn,
                        ins.status as inward_status, ins.scanned_by as inward_scanned_by,
                        ins.scanned_at as inward_scanned_at,
                        ri.tejas_dc_no, ri.tejas_obd_no, ri.lot as bat_lot_no,
                        COALESCE(ins.sl_no, ri.sl_no) as sl_no,
                        rwo.work_order_date, rwo.date
                 FROM rrh_inward_scans ins
                 LEFT JOIN rrh_inventory ri ON ri.id = ins.matched_inventory_id
                 LEFT JOIN rrh_work_orders rwo ON rwo.work_order_id = ins.work_order_id
                 WHERE (
                     UPPER(TRIM(ins.serial_number)) = $1 
                     OR UPPER(TRIM(ins.band_serial_no)) = $1
                     OR UPPER(TRIM(COALESCE(ins.original_serial_number, ''))) = $1
                     OR UPPER(TRIM(COALESCE(ins.corrected_serial_number, ''))) = $1
                     OR UPPER(TRIM(COALESCE(ins.sl_no, ''))) = $1
                     OR UPPER(TRIM(COALESCE(ri.band_serial_no, ''))) = $1
                     OR UPPER(TRIM(COALESCE(ri.sl_no, ''))) = $1
                 )
                   AND ins.is_deleted = false
                 ORDER BY ins.id DESC LIMIT 1`,
                [cleanSerial]
            );
            if (fallbackResult.rows.length > 0) {
                result = fallbackResult;
            }
        }

        // If found in inward scans:
        if (result.rows.length > 0) {
            const row = result.rows[0];

            // Verify Inward status
            if (row.inward_status !== 'PASS' && row.inward_status !== 'EDITED PASS') {
                return res.status(400).json({
                    found: false,
                    inward_failed: true,
                    message: `Serial number "${cleanSerial}" has Inward status "${row.inward_status}". Only PASSED units from RRH Inward can proceed to IVI.`
                });
            }

            // Check if unit has been marked as SCRAP in IVI
            const scrapCheck = await pool.query(
                `SELECT * FROM rrh_ivi_scrap_inspections 
                 WHERE (UPPER(TRIM(serial_number)) = $1 OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = $1)
                   AND is_deleted = false
                 LIMIT 1`,
                [cleanSerial]
            );
            if (scrapCheck.rows.length > 0) {
                const sc = scrapCheck.rows[0];
                return res.status(400).json({
                    found: false,
                    scrapped: true,
                    message: `Serial number "${cleanSerial}" has been marked as SCRAP by ${sc.scanned_by || 'operator'} and cannot be inspected or processed further.`
                });
            }

            // Check if already inspected in IVI
            const alreadyInspectedRes = await pool.query(
                `SELECT id, status, scanned_at, scanned_by, duplexer_main, duplexer_part_no, duplexer_sl_no 
                 FROM rrh_ivi_inspections 
                 WHERE (UPPER(TRIM(serial_number)) = $1 OR UPPER(TRIM(band_serial_no)) = $1)
                   AND is_deleted = false
                 ORDER BY id DESC LIMIT 1`,
                [cleanSerial]
            );

            const band = getBandFromTpn(row.physical_tpn);

            // Format WO Date
            let woDateFormatted = '—';
            const rawDate = row.work_order_date || row.date;
            if (rawDate) {
                try {
                    const d = new Date(rawDate);
                    if (!isNaN(d.getTime())) {
                        woDateFormatted = d.toLocaleDateString('en-GB'); // DD/MM/YYYY
                    } else {
                        woDateFormatted = String(rawDate);
                    }
                } catch {
                    woDateFormatted = String(rawDate);
                }
            }

            return res.status(200).json({
                found: true,
                source: 'inward_scans',
                inward_scan_id: row.inward_scan_id,
                serial_number: cleanSerial,
                band_serial_no: row.band_serial_no || cleanSerial,
                work_order_no: row.work_order_id || woId || '—',
                sl_no: row.sl_no || null,
                wo_date: woDateFormatted,
                tejas_dc_no: row.tejas_dc_no || '—',
                tejas_obd_no: row.tejas_obd_no || '—',
                bat_lot_no: row.bat_lot_no || '—',
                physical_tpn: row.physical_tpn || '—',
                band,
                inward_scanned_by: row.inward_scanned_by || '—',
                inward_scanned_at: row.inward_scanned_at,
                already_inspected: alreadyInspectedRes.rows.length > 0,
                previous_inspection: alreadyInspectedRes.rows[0] || null
            });
        }

        // 2. If not found in rrh_inward_scans, check if it exists in rrh_inventory
        const invCheck = await pool.query(
            `SELECT ri.id, ri.sl_no, ri.physical_tpn, ri.band_serial_no, rwo.work_order_id
             FROM rrh_inventory ri
             JOIN rrh_work_orders rwo ON (
                 (rwo.active_import_id IS NOT NULL AND ri.import_id = rwo.active_import_id)
                 OR (rwo.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = rwo.id))
             )
             WHERE (UPPER(TRIM(ri.band_serial_no)) = $1 OR UPPER(TRIM(ri.sl_no)) = $1)
             ORDER BY ri.id DESC LIMIT 1`,
            [cleanSerial]
        );

        if (invCheck.rows.length > 0) {
            const inv = invCheck.rows[0];
            return res.status(400).json({
                found: false,
                not_inwarded: true,
                message: `Serial number "${cleanSerial}" is registered in Work Order (${inv.work_order_id}) inventory, but has NOT been scanned and passed in RRH Inward yet. Unit must complete RRH Inward first.`
            });
        }

        return res.status(404).json({
            found: false,
            message: `Serial number "${cleanSerial}" not found in RRH Inward scanned logs or master inventory.`
        });
    } catch (err: any) {
        logger.error(`Error in lookupSerialDetails: ${err.message}`);
        return res.status(500).json({ message: 'Failed to lookup serial details.', error: err.message });
    }
};

/**
 * POST /api/rrh/ivi/sessions/:id/inspections
 * Submit an IVI inspection entry
 */
export const submitInspection = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    const {
        work_order_id,
        serial_number,
        duplexer_main,
        duplexer_part_no,
        duplexer_sl_no,
        rrh_unit,
        status,
        remarks,
        tejas_dc_no,
        tejas_obd_no,
        bat_lot_no,
        physical_tpn,
        band,
        wo_date
    } = req.body;

    if (!serial_number || !serial_number.toString().trim()) {
        return res.status(400).json({ message: 'Serial number is required.' });
    }

    const cleanStatus = (status || 'PASS').toString().trim().toUpperCase();
    if (!['PASS', 'FAIL', 'SCRAP'].includes(cleanStatus)) {
        return res.status(400).json({ message: 'Status must be PASS, FAIL, or SCRAP.' });
    }

    const rawDuplexerMake = req.body.duplexer_make || req.body.duplexer_main;
    const cleanDuplexerMake = rawDuplexerMake ? rawDuplexerMake.toString().trim() : '—';

    const rawRrhUnitDefect = req.body.rrh_unit_defect !== undefined ? req.body.rrh_unit_defect : req.body.rrh_unit;
    const cleanRrhUnitDefect = rawRrhUnitDefect !== null && rawRrhUnitDefect !== undefined ? rawRrhUnitDefect.toString().trim() : null;

    let cleanDuplexerPart = duplexer_part_no ? duplexer_part_no.toString().trim() : '—';
    const rawDuplexerSlNo = req.body.duplexer_sl_no || req.body.duplexer_serial_no;
    let cleanDuplexerSlNo = rawDuplexerSlNo ? rawDuplexerSlNo.toString().trim() : '—';

    if (cleanStatus !== 'SCRAP') {
        if (!rawDuplexerMake || !rawDuplexerMake.toString().trim()) {
            return res.status(400).json({ message: 'Duplexer Make is required.' });
        }

        if (!duplexer_part_no || !duplexer_part_no.toString().trim()) {
            return res.status(400).json({ message: 'Duplexer Part No. is required.' });
        }

        // Validate number and alphabets mix
        const hasAlpha = /[a-zA-Z]/.test(cleanDuplexerPart);
        const hasDigit = /[0-9]/.test(cleanDuplexerPart);
        if (!hasAlpha || !hasDigit) {
            return res.status(400).json({
                message: 'Duplexer Part No. must contain a mix of numbers and alphabets.'
            });
        }

        if (!rawDuplexerSlNo || !rawDuplexerSlNo.toString().trim()) {
            return res.status(400).json({ message: 'Duplexer SL.No is required.' });
        }
    }

    const cleanSerial = serial_number.toString().trim().toUpperCase();
    const cleanBandNo = (req.body.band_serial_no ? req.body.band_serial_no.toString().trim() : cleanSerial).toUpperCase();
    const safeBandNo = cleanBandNo.replace(/[/\\?%*:|"<>]/g, '_');

    // Process uploaded images (max 600 KB each)
    // Naming rule: if 1 image: bandNo.ext; if multiple: bandNo/1.ext, bandNo/2.ext, etc.
    const imageUrls: string[] = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        for (const file of req.files) {
            if (file.size > 600 * 1024) {
                // Clean up any files saved to disk
                for (const f of req.files) {
                    try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { }
                }
                return res.status(400).json({ message: 'Upload image under 600 KB.' });
            }
        }

        const count = req.files.length;
        if (count === 1) {
            // "if only 1 image uploaded then only band no"
            const file = req.files[0];
            const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
            const fileName = `${safeBandNo}${ext}`;
            const targetPath = path.join(getUploadsDir(), 'rrh', 'ivi', fileName);
            fs.copyFileSync(file.path, targetPath);
            try { fs.unlinkSync(file.path); } catch { }
            imageUrls.push(`/uploads/rrh/ivi/${fileName}`);
        } else {
            // "like if 3 images are uploaded for the same band no then bandNo/1 , bandNo/2, bandNo/3"
            const bandDir = path.join(getUploadsDir(), 'rrh', 'ivi', safeBandNo);
            if (!fs.existsSync(bandDir)) {
                fs.mkdirSync(bandDir, { recursive: true });
            }
            for (let idx = 0; idx < count; idx++) {
                const file = req.files[idx];
                const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
                const order = idx + 1;
                const fileName = `${order}${ext}`;
                const targetPath = path.join(bandDir, fileName);
                fs.copyFileSync(file.path, targetPath);
                try { fs.unlinkSync(file.path); } catch { }
                imageUrls.push(`/uploads/rrh/ivi/${safeBandNo}/${fileName}`);
            }
        }
    }

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check if this unit already passed IVI for this work order (prevent duplicate pass / constraint crash)
            const alreadyPassedCheck = await client.query(
                `SELECT id FROM rrh_ivi_inspections
                 WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
                   AND (UPPER(TRIM(serial_number)) = $2 OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = $2)
                   AND is_deleted = false
                   AND status IN ('PASS', 'COMPLETED')
                 LIMIT 1`,
                [work_order_id || '', cleanSerial]
            );
            if (alreadyPassedCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    message: `Unit "${cleanSerial}" has already passed IVI inspection for work order "${work_order_id}".`
                });
            }

            // Find matching inward scan record (mandatory prerequisite)
            const inwardCheck = await client.query(
                `SELECT ins.id, ins.status, COALESCE(ins.sl_no, ri.sl_no) as sl_no
                 FROM rrh_inward_scans ins
                 LEFT JOIN rrh_inventory ri ON ri.id = ins.matched_inventory_id
                 WHERE (UPPER(TRIM(ins.serial_number)) = $1 OR UPPER(TRIM(ins.band_serial_no)) = $1)
                   AND UPPER(TRIM(ins.work_order_id)) = UPPER(TRIM($2))
                   AND ins.is_deleted = false
                 ORDER BY ins.id DESC LIMIT 1`,
                [cleanSerial, work_order_id || '']
            );

            let inwardScanId: number | null = null;
            let inwardSlNo: string | null = (req.body.sl_no || '').toString().trim() || null;
            if (inwardCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(422).json({
                    message: `Unit "${cleanSerial}" has not been received at Inward Scan for work order "${work_order_id}".`
                });
            }

            if (inwardCheck.rows[0].status !== 'PASS' && inwardCheck.rows[0].status !== 'EDITED PASS') {
                await client.query('ROLLBACK');
                return res.status(422).json({
                    message: `Cannot submit IVI inspection: Serial number "${cleanSerial}" failed Inward (Status: ${inwardCheck.rows[0].status}).`
                });
            }
            inwardScanId = inwardCheck.rows[0].id;
            if (!inwardSlNo && inwardCheck.rows[0].sl_no) {
                inwardSlNo = inwardCheck.rows[0].sl_no;
            }

            let formattedCheckpoints = null;
            if (req.body.checkpoints) {
                try {
                    formattedCheckpoints = typeof req.body.checkpoints === 'string'
                        ? JSON.parse(req.body.checkpoints)
                        : req.body.checkpoints;
                } catch {
                    formattedCheckpoints = req.body.checkpoints;
                }
            }

            // Check if this serial previously had a FAIL in this session
            const prevFailCheck = await client.query(
                `SELECT id, rrh_unit, checkpoints, remarks, image_urls FROM rrh_ivi_inspections
                 WHERE session_id = $1 
                   AND (
                     UPPER(TRIM(serial_number)) = $2 OR UPPER(TRIM(band_serial_no)) = $2
                     OR UPPER(TRIM(serial_number)) = $3 OR UPPER(TRIM(band_serial_no)) = $3
                   )
                   AND status = 'FAIL'
                   AND is_deleted = false
                 ORDER BY id DESC`,
                [id, cleanSerial, cleanBandNo]
            );

            const isReinspected = prevFailCheck.rows.length > 0 && cleanStatus === 'PASS';
            let defectFixedText: string | null = null;

            if (isReinspected) {
                // If no new images uploaded during re-inspection, import/inherit images from the previous failed inspection
                if (imageUrls.length === 0) {
                    for (const prevRow of prevFailCheck.rows) {
                        let prevImgs: string[] = [];
                        if (Array.isArray(prevRow.image_urls)) {
                            prevImgs = prevRow.image_urls;
                        } else if (typeof prevRow.image_urls === 'string') {
                            try {
                                const parsed = JSON.parse(prevRow.image_urls);
                                if (Array.isArray(parsed)) prevImgs = parsed;
                            } catch { }
                        }
                        if (prevImgs.length > 0) {
                            imageUrls.push(...prevImgs);
                            break;
                        }
                    }
                }

                // Collect defect remarks that were fixed
                if (Array.isArray(formattedCheckpoints)) {
                    const fixed = formattedCheckpoints
                        .filter((c: any) => c.previousFailureRemark && c.previousFailureRemark.trim())
                        .map((c: any) => cleanDefectDescription(c.previousFailureRemark.trim()))
                        .filter((s: string) => s && s !== '—' && s !== '-');
                    if (fixed.length > 0) {
                        defectFixedText = fixed.join('; ');
                    }
                }
                if (!defectFixedText && prevFailCheck.rows.length > 0) {
                    const prevRow = prevFailCheck.rows[0];
                    const rawDefect = (prevRow.rrh_unit && prevRow.rrh_unit !== 'no defect') ? prevRow.rrh_unit : prevRow.remarks;
                    defectFixedText = cleanDefectDescription(rawDefect);
                }

                // Remove previous FAIL record(s) so it is removed from the failed inspection table!
                await client.query(
                    `UPDATE rrh_ivi_inspections 
                     SET is_deleted = true
                     WHERE id = ANY($1::int[])`,
                    [prevFailCheck.rows.map(r => r.id)]
                );
            }

            const rawRoute = (req.body.route || req.body.selected_route || 'ECN').toString().trim().toUpperCase().replace('-', '_');
            const cleanRoute = rawRoute === 'NON_ECN' ? 'NON_ECN' : 'ECN';

            // Insert inspection with is_reinspected flag, defect_fixed text, and route
            const insertRes = await client.query(
                `INSERT INTO rrh_ivi_inspections (
                    session_id,
                    work_order_id,
                    serial_number,
                    band_serial_no,
                    tejas_dc_no,
                    tejas_obd_no,
                    bat_lot_no,
                    physical_tpn,
                    band,
                    wo_date,
                    duplexer_main,
                    duplexer_part_no,
                    duplexer_sl_no,
                    rrh_unit,
                    image_urls,
                    status,
                    remarks,
                    scanned_by,
                    inward_scan_id,
                    sl_no,
                    checkpoints,
                    is_reinspected,
                    defect_fixed,
                    route
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
                RETURNING *`,
                [
                    id,
                    work_order_id || '',
                    cleanSerial,
                    cleanBandNo,
                    tejas_dc_no || null,
                    tejas_obd_no || null,
                    bat_lot_no || null,
                    physical_tpn || null,
                    band || null,
                    wo_date || null,
                    cleanDuplexerMake,
                    cleanDuplexerPart,
                    cleanDuplexerSlNo,
                    cleanRrhUnitDefect,
                    JSON.stringify(imageUrls),
                    cleanStatus,
                    remarks ? remarks.toString().trim() : null,
                    operator.name,
                    inwardScanId,
                    inwardSlNo,
                    formattedCheckpoints ? JSON.stringify(formattedCheckpoints) : null,
                    isReinspected && cleanStatus === 'PASS',
                    defectFixedText,
                    cleanRoute
                ]
            );

            // If re-inspected, link superseded_by_id to the new inspection record for full ISO-9001 auditability
            if (isReinspected && prevFailCheck.rows.length > 0) {
                await client.query(
                    `UPDATE rrh_ivi_inspections 
                     SET superseded_by_id = $1, superseded_at = CURRENT_TIMESTAMP
                     WHERE id = ANY($2::int[])`,
                    [insertRes.rows[0].id, prevFailCheck.rows.map(r => r.id)]
                );
            }

            // If status is SCRAP, also record in dedicated rrh_ivi_scrap_inspections table
            if (cleanStatus === 'SCRAP') {
                await client.query(
                    `INSERT INTO rrh_ivi_scrap_inspections (
                        session_id,
                        work_order_id,
                        serial_number,
                        band_serial_no,
                        sl_no,
                        tejas_dc_no,
                        tejas_obd_no,
                        bat_lot_no,
                        physical_tpn,
                        band,
                        duplexer_main,
                        duplexer_part_no,
                        duplexer_sl_no,
                        remarks,
                        scanned_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
                    [
                        id,
                        work_order_id || '',
                        cleanSerial,
                        cleanBandNo,
                        inwardSlNo,
                        tejas_dc_no || null,
                        tejas_obd_no || null,
                        bat_lot_no || null,
                        physical_tpn || null,
                        band || null,
                        cleanDuplexerMake,
                        cleanDuplexerPart,
                        cleanDuplexerSlNo,
                        remarks ? remarks.toString().trim() : null,
                        operator.name
                    ]
                );
            }

            // Update session updated_at
            await client.query(
                `UPDATE rrh_ivi_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );

            await client.query('COMMIT');
            logger.info(`Recorded IVI inspection for serial ${serial_number} with status ${cleanStatus}`);
            return res.status(201).json(insertRes.rows[0]);
        } catch (dbErr: any) {
            await client.query('ROLLBACK');
            throw dbErr;
        } finally {
            client.release();
        }
    } catch (err: any) {
        if (err.code === '23505' || /unique|uq_rrh_/i.test(err.message)) {
            logger.warn(`[RRH-IVI] Duplicate concurrent scan safely rejected for serial ${serial_number}: ${err.message}`);
            return res.status(409).json({
                message: `Duplicate active scan: unit "${serial_number}" has already been inspected in IVI.`,
                error: err.message
            });
        }
        logger.error(`Error in submitInspection: ${err.message}`);
        return res.status(500).json({ message: 'Failed to submit inspection.', error: err.message });
    }
};

/**
 * GET /api/rrh/ivi/sessions/:id/inspections
 * Get recent inspections for this session
 */
export const getRecentInspections = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT 
                rii.*,
                COALESCE(rii.sl_no, ins.sl_no, ri.sl_no) as sl_no,
                COALESCE(rii.bat_lot_no, ri.lot) as bat_lot_no
             FROM rrh_ivi_inspections rii
             LEFT JOIN rrh_inward_scans ins ON ins.id = rii.inward_scan_id 
                 OR (rii.inward_scan_id IS NULL AND (UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(rii.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(rii.serial_number))))
             LEFT JOIN rrh_inventory ri ON ri.id = ins.matched_inventory_id
             WHERE rii.session_id = $1 AND rii.is_deleted = false
             ORDER BY rii.scanned_at DESC, rii.id DESC`,
            [id]
        );

        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error(`Error in getRecentInspections: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch inspections.', error: err.message });
    }
};

/**
 * GET /api/rrh/ivi/sessions/:id/scrap-inspections
 * Get scrap inspections for this session
 */
export const getScrapInspections = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT * FROM rrh_ivi_scrap_inspections 
             WHERE session_id = $1 AND is_deleted = false
             ORDER BY scanned_at DESC, id DESC`,
            [id]
        );

        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error(`Error in getScrapInspections: ${err.message}`);
        return res.status(500).json({ message: 'Failed to fetch scrap inspections.', error: err.message });
    }
};

/**
 * GET /api/rrh/ivi/sessions/:id/export
 * Export inspections table to an Excel file with hyperlinked photo column
 */
export const exportIviExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);
    const statusFilter = (req.query.status as string)?.trim().toUpperCase();
    const idsStr = (req.query.ids as string)?.trim();
    const isFailedOnly = statusFilter === 'FAIL';
    const isPassOnly = statusFilter === 'PASS';
    const isScrapOnly = statusFilter === 'SCRAP';

    try {
        const sessionRes = await pool.query(
            `SELECT s.*, 
                    COALESCE(w.work_order_id, s.work_order_id) as work_order_id, 
                    COALESCE(w.lot_quantity, 0) as lot_quantity, 
                    COALESCE(
                        w.work_order_date, 
                        w.date, 
                        (SELECT rii.wo_date FROM rrh_ivi_inspections rii WHERE rii.session_id = s.id AND rii.wo_date IS NOT NULL LIMIT 1)::date,
                        s.created_at::date
                    ) as work_order_date,
                    COALESCE(
                        (SELECT ri.lot FROM rrh_inventory ri WHERE ri.import_id = w.active_import_id OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id)) LIMIT 1),
                        (SELECT rii.bat_lot_no FROM rrh_ivi_inspections rii WHERE rii.session_id = s.id AND rii.bat_lot_no IS NOT NULL AND rii.bat_lot_no != '' LIMIT 1),
                        '—'
                    ) as lot_number,
                    COALESCE(w.status, 'In Progress') as wo_status
             FROM rrh_ivi_sessions s
             LEFT JOIN rrh_work_orders w ON UPPER(TRIM(w.work_order_id)) = UPPER(TRIM(s.work_order_id))
             WHERE s.id = $1`,
            [id]
        );
        const session = sessionRes.rows[0];
        const woId = session?.work_order_id || `Session_${id}`;

        // Summary counts
        const countRes = await pool.query(
            `SELECT 
                COUNT(*)::int as total_scanned,
                COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'PASS')::int as passed_count,
                COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'FAIL')::int as failed_count
             FROM rrh_ivi_inspections
             WHERE session_id = $1 AND is_deleted = false`,
            [id]
        );
        const totalScanned = countRes.rows[0]?.total_scanned || 0;
        const passedCount = countRes.rows[0]?.passed_count || 0;
        const failedCount = countRes.rows[0]?.failed_count || 0;
        const lotQty = Number(session?.lot_quantity) || 0;
        const pending = Math.max(0, lotQty - passedCount);
        const yieldPercent = lotQty > 0
            ? ((passedCount / lotQty) * 100).toFixed(2) + '%'
            : (totalScanned > 0 ? ((passedCount / totalScanned) * 100).toFixed(2) + '%' : '0.00%');

        const params: any[] = [id];

        let query = `SELECT 
                rii.*,
                COALESCE(rii.sl_no, ins.sl_no, ri.sl_no) as sl_no,
                COALESCE(rii.bat_lot_no, ri.lot) as bat_lot_no
             FROM rrh_ivi_inspections rii
             LEFT JOIN rrh_inward_scans ins ON ins.id = rii.inward_scan_id 
                 OR (rii.inward_scan_id IS NULL AND (UPPER(TRIM(ins.serial_number)) = UPPER(TRIM(rii.serial_number)) OR UPPER(TRIM(ins.band_serial_no)) = UPPER(TRIM(rii.serial_number))))
             LEFT JOIN rrh_inventory ri ON ri.id = ins.matched_inventory_id
             WHERE rii.session_id = $1 AND rii.is_deleted = false`;

        if (idsStr) {
            const idList = idsStr.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
            if (idList.length > 0) {
                params.push(idList);
                query += ` AND rii.id = ANY($${params.length}::int[])`;
            }
        }

        if (isFailedOnly) {
            query += ` AND UPPER(TRIM(rii.status)) = 'FAIL'
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_ivi_inspections p 
                  WHERE p.session_id = rii.session_id 
                    AND p.is_deleted = false 
                    AND UPPER(TRIM(p.status)) = 'PASS' 
                    AND (
                        (p.serial_number IS NOT NULL AND rii.serial_number IS NOT NULL AND UPPER(TRIM(p.serial_number)) = UPPER(TRIM(rii.serial_number)))
                        OR (p.band_serial_no IS NOT NULL AND rii.band_serial_no IS NOT NULL AND UPPER(TRIM(p.band_serial_no)) = UPPER(TRIM(rii.band_serial_no)))
                        OR (p.serial_number IS NOT NULL AND rii.band_serial_no IS NOT NULL AND UPPER(TRIM(p.serial_number)) = UPPER(TRIM(rii.band_serial_no)))
                        OR (p.band_serial_no IS NOT NULL AND rii.serial_number IS NOT NULL AND UPPER(TRIM(p.band_serial_no)) = UPPER(TRIM(rii.serial_number)))
                    )
              )`;
        } else if (isScrapOnly) {
            query += ` AND UPPER(TRIM(rii.status)) = 'SCRAP'`;
        } else {
            // Default (including recent inspections and work order selection download): ONLY show passed!
            query += ` AND UPPER(TRIM(rii.status)) = 'PASS'`;
        }

        query += ` ORDER BY rii.scanned_at DESC, rii.id DESC`;

        const inspectionsRes = await pool.query(query, params);
        let rows = inspectionsRes.rows;

        if (isFailedOnly) {
            const seenSerials = new Set<string>();
            rows = rows.filter((r: any) => {
                const sn = (r.band_serial_no || r.serial_number || '').trim().toUpperCase();
                if (sn && seenSerials.has(sn)) return false;
                if (sn) seenSerials.add(sn);
                return true;
            });
        }

        const getDefectFixedText = (r: any): string => {
            if (!r.is_reinspected) return '—';
            if (r.defect_fixed && r.defect_fixed.trim()) {
                const cleaned = cleanDefectDescription(r.defect_fixed.trim());
                if (cleaned && cleaned !== '—' && cleaned !== '-') return cleaned;
            }
            let cps = r.checkpoints;
            if (typeof cps === 'string') {
                try { cps = JSON.parse(cps); } catch { cps = null; }
            }
            if (Array.isArray(cps)) {
                const fixed = cps
                    .filter((c: any) => c.previousFailureRemark && c.previousFailureRemark.trim())
                    .map((c: any) => cleanDefectDescription(c.previousFailureRemark.trim()))
                    .filter((s: string) => s && s !== '—' && s !== '-');
                if (fixed.length > 0) return fixed.join('; ');
            }
            if (r.rrh_unit && r.rrh_unit !== 'no defect') {
                return cleanDefectDescription(r.rrh_unit);
            }
            return '—';
        };

        const tableRows = rows.map((r, idx) => {
            const dateStr = r.scanned_at ? new Date(r.scanned_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '—';
            let defectText = isFailedOnly
                ? cleanDefectDescription(r.rrh_unit || r.remarks || '—')
                : (r.rrh_unit && r.rrh_unit !== 'no defect' ? cleanDefectDescription(r.rrh_unit) : (r.rrh_unit || '—'));
            if (!isFailedOnly && getDefectFixedText(r) !== '—') {
                defectText = getDefectFixedText(r);
            }

            return {
                sl: r.sl_no || (idx + 1),
                band_serial_no: r.band_serial_no || r.serial_number || '—',
                physical_tpn: r.physical_tpn || '—',
                band: r.band || '—',
                bat_lot_no: r.bat_lot_no || session?.lot_number || '—',
                duplexer_main: r.duplexer_main || '—',
                duplexer_part_no: r.duplexer_part_no || '—',
                duplexer_sl_no: r.duplexer_sl_no || r.duplexer_sno || '—',
                rrh_unit: defectText,
                status: r.status || '—',
                photos: r.image_urls,
                image_urls: r.image_urls,
                scanned_by: r.scanned_by || '—',
                scanned_at: dateStr,
                remarks: r.remarks || '—',
                is_reinspected: Boolean(r.is_reinspected)
            };
        });

        const title = isFailedOnly 
            ? 'RRH IVI FAILED INSPECTIONS REPORT' 
            : (isPassOnly ? 'RRH IVI RECENT INSPECTIONS REPORT' : (isScrapOnly ? 'RRH IVI SCRAP INSPECTIONS REPORT' : 'RRH IVI PASSED INSPECTIONS REPORT'));
        const section4Title = isFailedOnly 
            ? 'FAILED INSPECTIONS HISTORY' 
            : (isPassOnly ? 'RECENT INSPECTIONS HISTORY (PASSED)' : (isScrapOnly ? 'SCRAP INSPECTIONS HISTORY' : 'PASSED INSPECTIONS HISTORY'));
        const filePrefix = isFailedOnly 
            ? 'RRH_IVI_Failed_Inspections' 
            : (isPassOnly ? 'RRH_IVI_Recent_Inspections' : (isScrapOnly ? 'RRH_IVI_Scrap_Inspections' : 'RRH_IVI_Passed_Inspections'));

        const columns = [
            { header: 'SL No', key: 'sl', width: 8, align: 'center' as const },
            { header: 'Band Serial No', key: 'band_serial_no', width: 22, align: 'left' as const },
            { header: 'Physical TPN', key: 'physical_tpn', width: 20, align: 'left' as const },
            { header: 'Band', key: 'band', width: 12, align: 'center' as const },
            { header: 'BAT Lot No', key: 'bat_lot_no', width: 16, align: 'center' as const },
            { header: 'Duplexer Make', key: 'duplexer_main', width: 18, align: 'left' as const },
            { header: 'Duplexer Part No', key: 'duplexer_part_no', width: 20, align: 'left' as const },
            { header: 'Duplexer SL.No', key: 'duplexer_sl_no', width: 20, align: 'left' as const },
            { header: isFailedOnly ? 'Failed Stage Remarks' : 'RRH Unit Defect / Fixed', key: 'rrh_unit', width: 28, align: 'left' as const },
            { header: 'Status', key: 'status', width: 14, align: 'center' as const },
            { header: 'Defect Images', key: 'photos', width: 28, align: 'center' as const },
            { header: 'Scanned By', key: 'scanned_by', width: 20, align: 'left' as const },
            { header: 'Date & Time', key: 'scanned_at', width: 24, align: 'center' as const },
            { header: 'Remarks', key: 'remarks', width: 26, align: 'left' as const }
        ];

        await sendRrhSessionExcel(res, `${filePrefix}_${woId}.xlsx`, {
            title,
            stageName: 'RRH IVI Inspection',
            route: 'Common',
            operatorName: operator.name || operator.username,
            workOrder: {
                id: session?.work_order_id || woId,
                date: session?.work_order_date,
                quantity: session?.lot_quantity,
                lotNumber: session?.lot_number,
                status: session?.wo_status
            },
            session: {
                id: session?.id || id,
                status: session?.status,
                createdBy: session?.created_by_name || session?.created_by,
                createdAt: session?.created_at
            },
            productionSummary: {
                total: lotQty,
                passed: passedCount,
                failed: failedCount,
                pending: pending,
                yieldPercent: yieldPercent
            },
            section4Title,
            columns,
            rows: tableRows,
            sheetName: isFailedOnly ? 'Failed Inspections' : (isPassOnly ? 'Recent Inspections' : (isScrapOnly ? 'Scrapped Inspections' : 'Session Report'))
        });
    } catch (err: any) {
        logger.error(`Error in exportIviExcel: ${err.message}`);
        return res.status(500).json({ message: 'Failed to export inspections.', error: err.message });
    }
};

/**
 * GET /api/rrh/ivi/inspections/:id/photos
 * Public viewer & downloader for an inspection's photos (linked from Excel exports)
 */
export const viewInspectionPhotos = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const result = await pool.query(
            `SELECT * FROM rrh_ivi_inspections WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).send(`
                <!DOCTYPE html>
                <html>
                <head><title>Inspection Not Found</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h2>Inspection Not Found</h2>
                    <p>The requested inspection record could not be found.</p>
                </body>
                </html>
            `);
        }

        const inspection = result.rows[0];
        const rawImgs = inspection.image_urls;
        let images: string[] = [];
        if (Array.isArray(rawImgs)) {
            images = rawImgs;
        } else if (typeof rawImgs === 'string') {
            try {
                const parsed = JSON.parse(rawImgs);
                if (Array.isArray(parsed)) {
                    images = parsed;
                } else if (typeof parsed === 'string' && parsed.trim().length > 0) {
                    images = [parsed.trim()];
                }
            } catch {
                if (rawImgs.trim().startsWith('/uploads') || rawImgs.trim().startsWith('http')) {
                    images = [rawImgs.trim()];
                } else {
                    images = [];
                }
            }
        }

        if (images.length === 0) {
            return res.status(200).send(`
                <!DOCTYPE html>
                <html>
                <head><title>No Photos Uploaded</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #f8fafc;">
                    <div style="max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <h2 style="color: #64748b; margin-bottom: 10px;">No Photos Uploaded</h2>
                        <p style="color: #475569;">No inspection photos were uploaded for serial: <strong>${inspection.band_serial_no || inspection.serial_number}</strong></p>
                    </div>
                </body>
                </html>
            `);
        }

        // If direct download requested for single image
        if (req.query.download === '1' && images.length === 1) {
            const filename = path.basename(images[0]);
            const filePath = path.join(getUploadsDir(), 'rrh', 'ivi', filename);
            if (fs.existsSync(filePath)) {
                return res.download(filePath, filename);
            }
        }

        const serial = inspection.band_serial_no || inspection.serial_number || 'N/A';
        const isPass = inspection.status === 'PASS';
        const formattedDate = inspection.scanned_at ? new Date(inspection.scanned_at).toLocaleString('en-IN') : 'N/A';

        // Render HTML page
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Inspection Photos - Serial: ${serial}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #f8fafc;
            color: #0f172a;
            min-height: 100vh;
        }
        .header {
            background: linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%);
            color: #ffffff;
            padding: 1.25rem 2rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .header-title {
            font-size: 1.25rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .header-badge {
            background: #4f46e5;
            color: #fff;
            padding: 0.2rem 0.6rem;
            border-radius: 4px;
            font-size: 0.75rem;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }
        .container {
            max-width: 1200px;
            margin: 2rem auto;
            padding: 0 1.5rem;
        }
        .info-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 1.25rem 1.5rem;
            margin-bottom: 2rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
        }
        .info-item {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
        }
        .info-label {
            font-size: 0.75rem;
            text-transform: uppercase;
            font-weight: 600;
            color: #64748b;
            letter-spacing: 0.05em;
        }
        .info-val {
            font-size: 0.95rem;
            font-weight: 600;
            color: #1e293b;
        }
        .badge {
            display: inline-block;
            padding: 0.2rem 0.65rem;
            border-radius: 9999px;
            font-size: 0.8rem;
            font-weight: 700;
            width: fit-content;
        }
        .badge-pass { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
        .badge-fail { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
        .gallery-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1rem;
        }
        .gallery-title {
            font-size: 1.1rem;
            font-weight: 700;
            color: #1e293b;
        }
        .btn-download-all {
            background: #2563eb;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            border-radius: 6px;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: background 0.15s;
        }
        .btn-download-all:hover { background: #1d4ed8; }
        .gallery-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
            gap: 1.5rem;
        }
        .photo-card {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
            display: flex;
            flex-direction: column;
        }
        .photo-wrapper {
            background: #0f172a;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 380px;
            position: relative;
            cursor: pointer;
        }
        .photo-wrapper img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            transition: transform 0.2s;
        }
        .photo-wrapper:hover img {
            transform: scale(1.02);
        }
        .photo-footer {
            padding: 0.9rem 1.25rem;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #ffffff;
            border-top: 1px solid #e2e8f0;
        }
        .btn-download {
            background: #059669;
            color: white;
            padding: 0.45rem 0.9rem;
            border-radius: 6px;
            font-size: 0.85rem;
            font-weight: 600;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 5px;
            transition: background 0.15s;
        }
        .btn-download:hover { background: #047857; }
        .btn-view-raw {
            color: #4f46e5;
            text-decoration: none;
            font-size: 0.85rem;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }
        .btn-view-raw:hover { text-decoration: underline; }
        /* Modal for full screen view */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.9);
            justify-content: center;
            align-items: center;
        }
        .modal.active { display: flex; }
        .modal img { max-width: 92vw; max-height: 92vh; object-fit: contain; border-radius: 4px; }
        .modal-close {
            position: absolute;
            top: 20px; right: 25px;
            color: white;
            font-size: 2rem;
            cursor: pointer;
            background: none;
            border: none;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">
            <span>Velankani SFCS</span>
            <span class="header-badge">RRH IVI</span>
            <span>Inspection Photos</span>
        </div>
        <div style="font-size: 0.85rem; color: #cbd5e1;">
            Serial: <strong style="color: #fff; font-family: monospace;">${serial}</strong>
        </div>
    </div>

    <div class="container">
        <!-- Inspection Details Card -->
        <div class="info-card">
            <div class="info-item">
                <span class="info-label">Band Serial No</span>
                <span class="info-val" style="font-family: monospace; color: #1e3a8a;">${serial}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Work Order No</span>
                <span class="info-val">${inspection.work_order_id || '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Physical TPN</span>
                <span class="info-val" style="font-family: monospace;">${inspection.physical_tpn || '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Band</span>
                <span class="info-val" style="color: #2563eb;">${inspection.band || '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Duplexer Part No</span>
                <span class="info-val" style="font-family: monospace;">${inspection.duplexer_part_no || '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Duplexer SL.No</span>
                <span class="info-val" style="font-family: monospace;">${inspection.duplexer_sl_no || '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Status</span>
                <span class="info-val">
                    <span class="badge ${isPass ? 'badge-pass' : 'badge-fail'}">${inspection.status}</span>
                </span>
            </div>
            <div class="info-item">
                <span class="info-label">Scanned By</span>
                <span class="info-val">${inspection.scanned_by || '—'}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Date & Time</span>
                <span class="info-val" style="font-size: 0.85rem;">${formattedDate}</span>
            </div>
        </div>

        <!-- Gallery Header -->
        <div class="gallery-header">
            <div class="gallery-title">
                Uploaded Images (${images.length} ${images.length === 1 ? 'photo' : 'photos'})
            </div>
            ${images.length > 1 ? `
                <button type="button" class="btn-download-all" onclick="downloadAll()">
                    📥 Download All Photos
                </button>
            ` : ''}
        </div>

        <!-- Photo Grid -->
        <div class="gallery-grid">
            ${images.map((imgUrl, idx) => {
            const cleanRel = imgUrl.replace(/^\/?uploads\/rrh\/ivi\//, '');
            const fname = path.basename(imgUrl);
            const dlUrl = `/api/rrh/ivi/photos/download/${cleanRel}`;
            return `
                    <div class="photo-card">
                        <div class="photo-wrapper" onclick="openModal('${imgUrl}')" title="Click to view full size">
                            <img src="${imgUrl}" alt="Photo ${idx + 1}" />
                        </div>
                        <div class="photo-footer">
                            <span style="font-size: 0.85rem; font-weight: 600; color: #475569;">
                                Photo ${idx + 1} of ${images.length}
                            </span>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <a href="${imgUrl}" target="_blank" class="btn-view-raw">🔍 View Raw</a>
                                <a href="${dlUrl}" class="btn-download download-item" download="${fname}">📥 Download</a>
                            </div>
                        </div>
                    </div>
                `;
        }).join('')}
        </div>
    </div>

    <!-- Lightbox Modal -->
    <div id="modal" class="modal" onclick="closeModal()">
        <button class="modal-close" onclick="closeModal()">&times;</button>
        <img id="modal-img" src="" alt="Full preview" onclick="event.stopPropagation()" />
    </div>

    <script>
        function openModal(src) {
            document.getElementById('modal-img').src = src;
            document.getElementById('modal').classList.add('active');
        }
        function closeModal() {
            document.getElementById('modal').classList.remove('active');
        }
        function downloadAll() {
            const items = document.querySelectorAll('.download-item');
            items.forEach((item, index) => {
                setTimeout(() => {
                    const link = document.createElement('a');
                    link.href = item.href;
                    link.download = item.getAttribute('download') || 'photo.jpg';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }, index * 400);
            });
        }
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') closeModal();
        });
    </script>
</body>
</html>
        `;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (err: any) {
        logger.error(`Error in viewInspectionPhotos: ${err.message}`);
        return res.status(500).send('Failed to load inspection photos.');
    }
};

/**
 * GET /api/rrh/ivi/photos/download/*
 * GET /api/rrh/ivi/photos/download/:filename
 * Directly download an uploaded inspection photo with Content-Disposition: attachment
 */
export const downloadInspectionPhoto = async (req: Request, res: Response) => {
    const rawSubpath = (req.params[0] || req.params.filename || (req.params as any)['0'] || '').toString().trim();
    if (!rawSubpath) {
        return res.status(400).send('Filename or path is required.');
    }
    const baseDir = path.resolve(getUploadsDir(), 'rrh', 'ivi');
    const cleanSubpath = rawSubpath.replace(/^[/\\]+/, '');
    const resolvedPath = path.resolve(baseDir, cleanSubpath);
    if (!resolvedPath.startsWith(baseDir) || !fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        return res.status(404).send('Image file not found.');
    }
    const downloadName = path.basename(resolvedPath);
    return res.download(resolvedPath, downloadName);
};

/**
 * PATCH /api/rrh/ivi/inspections/:id/pass-to-next-stage
 * Mark a failed inspection as passed to next stage (IPQC for ECN, Post Burn-in for Non-ECN)
 */
export const passToNextStage = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        const updateRes = await pool.query(
            `UPDATE rrh_ivi_inspections
             SET passed_to_next_stage = TRUE,
                 passed_to_next_stage_at = CURRENT_TIMESTAMP,
                 passed_to_next_stage_by = $1
             WHERE id = $2 AND is_deleted = false
             RETURNING *`,
            [operator.name || operator.username || 'System Admin', id]
        );

        if (updateRes.rows.length === 0) {
            return res.status(404).json({ message: 'Inspection record not found.' });
        }

        const updated = updateRes.rows[0];
        logger.info(`Inspection ID ${id} (Serial ${updated.serial_number}) passed to next stage by ${operator.username}`);

        return res.status(200).json({
            success: true,
            message: 'Unit successfully passed to next stage.',
            inspection: updated
        });
    } catch (err: any) {
        logger.error(`Error in passToNextStage: ${err.message}`);
        return res.status(500).json({ message: 'Failed to pass unit to next stage.', error: err.message });
    }
};

/**
 * POST /api/rrh/ivi/inspections/:id/images
 * Add additional photos to an existing IVI inspection
 */
export const addInspectionImages = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({ message: 'No images uploaded.' });
    }

    try {
        const findRes = await pool.query(
            `SELECT id, work_order_id, serial_number, band_serial_no, image_urls 
             FROM rrh_ivi_inspections 
             WHERE id = $1 AND is_deleted = false`,
            [id]
        );

        if (findRes.rows.length === 0) {
            for (const f of req.files) {
                try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { }
            }
            return res.status(404).json({ message: 'Inspection record not found.' });
        }

        const inspection = findRes.rows[0];

        // Validate file size under 600 KB
        for (const file of req.files) {
            if (file.size > 600 * 1024) {
                for (const f of req.files) {
                    try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { }
                }
                return res.status(400).json({ message: 'Upload image under 600 KB.' });
            }
        }

        // Parse existing images
        let existingImages: string[] = [];
        const rawImgs = inspection.image_urls;
        if (Array.isArray(rawImgs)) {
            existingImages = [...rawImgs];
        } else if (typeof rawImgs === 'string') {
            try {
                const parsed = JSON.parse(rawImgs);
                if (Array.isArray(parsed)) existingImages = parsed;
                else if (rawImgs.trim()) existingImages = [rawImgs.trim()];
            } catch {
                if (rawImgs.trim()) existingImages = [rawImgs.trim()];
            }
        }

        const cleanBandNo = (inspection.band_serial_no || inspection.serial_number || 'BAND').toUpperCase().trim();
        const safeBandNo = cleanBandNo.replace(/[/\\?%*:|"<>]/g, '_');
        const bandDir = path.join(getUploadsDir(), 'rrh', 'ivi', safeBandNo);
        if (!fs.existsSync(bandDir)) {
            fs.mkdirSync(bandDir, { recursive: true });
        }

        const newImageUrls: string[] = [];
        for (let idx = 0; idx < req.files.length; idx++) {
            const file = req.files[idx];
            const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
            const order = existingImages.length + idx + 1;
            const fileName = `${order}_${Date.now()}${ext}`;
            const targetPath = path.join(bandDir, fileName);
            fs.copyFileSync(file.path, targetPath);
            try { fs.unlinkSync(file.path); } catch { }
            newImageUrls.push(`/uploads/rrh/ivi/${safeBandNo}/${fileName}`);
        }

        const updatedImages = [...existingImages, ...newImageUrls];

        const updateRes = await pool.query(
            `UPDATE rrh_ivi_inspections
             SET image_urls = $1
             WHERE id = $2
             RETURNING *`,
            [JSON.stringify(updatedImages), id]
        );

        logger.info(`Added ${newImageUrls.length} images to inspection ID ${id} (${cleanBandNo})`);

        return res.status(200).json({
            success: true,
            message: 'Images added successfully.',
            image_urls: updatedImages,
            inspection: updateRes.rows[0]
        });
    } catch (err: any) {
        logger.error(`Error in addInspectionImages: ${err.message}`);
        if (req.files && Array.isArray(req.files)) {
            for (const f of req.files) {
                try { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch { }
            }
        }
        return res.status(500).json({ message: 'Failed to add images to inspection.', error: err.message });
    }
};


