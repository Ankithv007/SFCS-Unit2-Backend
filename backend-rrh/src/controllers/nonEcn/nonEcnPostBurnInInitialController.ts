import { Request, Response } from 'express';
import { pool } from '../../utils/db';
import { createLogger } from '../../utils/logger';
import { StationService, StationContext } from '../../services/common/stationService';

const logger = createLogger('RRH-NON-ECN-POST-BURN-IN-INITIAL');

const NON_ECN_INITIAL_PBI_CTX: StationContext = {
    stationId: 'NON_ECN_POST_BURN_IN_INITIAL',
    route: 'NON_ECN',
    sessionTable: 'rrh_post_burn_in_sessions',
    inspectionTable: 'rrh_post_burn_in_inspections',
    postBurnInType: 'INITIAL',
    logName: 'Non-ECN Post-Burn-In (Initial)'
};

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
                    SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))::int
                    FROM rrh_ivi_inspections ivi
                    LEFT JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id
                    WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(w.work_order_id))
                      AND (UPPER(TRIM(ivi.status)) IN ('COMPLETED', 'PASS') OR ivi.status ILIKE '%pass%' OR ivi.status ILIKE '%complete%' OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
                      AND ivi.is_deleted = false
                      AND (ivis.is_deleted IS NULL OR ivis.is_deleted = false)
                      AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'
                ) as ivi_passed_count,
                (
                    SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))::int
                    FROM rrh_ivi_inspections ivi
                    LEFT JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id
                    WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(w.work_order_id))
                      AND (UPPER(TRIM(ivi.status)) IN ('COMPLETED', 'PASS') OR ivi.status ILIKE '%pass%' OR ivi.status ILIKE '%complete%' OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
                      AND ivi.is_deleted = false
                      AND (ivis.is_deleted IS NULL OR ivis.is_deleted = false)
                      AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'
                ) as hipot_passed_count,
                (
                    SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))::int
                    FROM rrh_ivi_inspections ivi
                    LEFT JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id
                    WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(w.work_order_id))
                      AND (UPPER(TRIM(ivi.status)) IN ('COMPLETED', 'PASS') OR ivi.status ILIKE '%pass%' OR ivi.status ILIKE '%complete%' OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
                      AND ivi.is_deleted = false
                      AND (ivis.is_deleted IS NULL OR ivis.is_deleted = false)
                      AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'
                ) as ipqc_passed_count
            FROM rrh_work_orders w
            WHERE (w.is_deleted IS NULL OR w.is_deleted = false)
              AND NOT EXISTS (
                SELECT 1
                FROM rrh_post_burn_in_sessions s
                WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id))
                  AND s.is_deleted = false
                  AND REPLACE(COALESCE(s.route, 'ECN'), '-', '_') = 'NON_ECN'
                  AND s.post_burn_in_type = 'INITIAL'
                  AND UPPER(TRIM(s.status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')
              )
            ORDER BY w.created_at DESC, w.id DESC
        `);

        return res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error('Error in getEligiblePostBurnInWorkOrders (Non-ECN Initial): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch eligible work orders for Non-ECN Initial Post-Burn-In.', error: err.message });
    }
};

export const getWorkOrderIpqcDetails = async (req: Request, res: Response) => {
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
             LEFT JOIN rrh_ivi_sessions ivis ON ivis.id = ivi.session_id
             WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
               AND (UPPER(TRIM(ivi.status)) IN ('COMPLETED', 'PASS') OR ivi.status ILIKE '%pass%' OR ivi.status ILIKE '%complete%' OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
               AND ivi.is_deleted = false
               AND (ivis.is_deleted IS NULL OR ivis.is_deleted = false)
               AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'`,
            [cleanWoId]
        );

        const wo = woRes.rows[0] || null;
        const passedCount = countRes.rows[0]?.count || 0;

        return res.status(200).json({
            success: true,
            data: {
                work_order_id: wo?.work_order_id || cleanWoId,
                work_order_date: wo?.work_order_date || null,
                lot_quantity: wo?.lot_quantity || 0,
                status: wo?.status || 'UNKNOWN',
                ivi_passed_count: passedCount,
                hipot_passed_count: passedCount,
                ipqc_passed_count: passedCount
            }
        });
    } catch (err: any) {
        logger.error('Error in getWorkOrderIpqcDetails (Non-ECN Initial): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch details for Non-ECN Initial Post-Burn-In.', error: err.message });
    }
};

export const getWorkOrderHipotDetails = getWorkOrderIpqcDetails;
export const getWorkOrderIviDetails = getWorkOrderIpqcDetails;

export const createPostBurnInSession = (req: Request, res: Response) =>
    StationService.createSession(NON_ECN_INITIAL_PBI_CTX, req, res);

export const getPostBurnInSessions = (req: Request, res: Response) =>
    StationService.getSessions(NON_ECN_INITIAL_PBI_CTX, req, res);

export const getPostBurnInSessionById = (req: Request, res: Response) =>
    StationService.getSessionById(NON_ECN_INITIAL_PBI_CTX, req, res);

export const updatePostBurnInSessionStatus = (req: Request, res: Response) =>
    StationService.updateSessionStatus(NON_ECN_INITIAL_PBI_CTX, req, res);

export const deletePostBurnInSession = (req: Request, res: Response) =>
    StationService.deleteSession(NON_ECN_INITIAL_PBI_CTX, req, res);

export const lookupSerialDetails = (req: Request, res: Response) =>
    StationService.lookupSerial(NON_ECN_INITIAL_PBI_CTX, req, res);

export const submitInspection = (req: Request, res: Response) =>
    StationService.submitInspection(NON_ECN_INITIAL_PBI_CTX, req, res);

export const getScannedInspections = (req: Request, res: Response) =>
    StationService.getScannedInspections(NON_ECN_INITIAL_PBI_CTX, req, res);

export const getFailedInspections = (req: Request, res: Response) =>
    StationService.getFailedInspections(NON_ECN_INITIAL_PBI_CTX, req, res);

export const getDebugInspections = (req: Request, res: Response) =>
    StationService.getDebugInspections(NON_ECN_INITIAL_PBI_CTX, req, res);

export const updateDebugAction = (req: Request, res: Response) =>
    StationService.updateDebugAction(NON_ECN_INITIAL_PBI_CTX, req, res);

export const exportPostBurnInExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_INITIAL_PBI_CTX, req, res);

export const exportUnscannedExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_INITIAL_PBI_CTX, req, res);

export const exportDebugExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_INITIAL_PBI_CTX, req, res);

export const getRemainingIpqcMasterData = async (req: Request, res: Response) => {
    try {
        const { id: sessionId } = req.params;
        const { page = 1, limit = 50, search = '' } = req.query;
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.max(1, parseInt(String(limit)) || 50);
        const offset = (pageNum - 1) * limitNum;

        const sessionRes = await pool.query(`SELECT work_order_id FROM rrh_post_burn_in_sessions WHERE id = $1`, [sessionId]);
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found.' });
        }
        const woId = sessionRes.rows[0].work_order_id;

        let queryParams: any[] = [woId, sessionId];
        let filterSql = '';
        if (search) {
            filterSql = ` AND (ivi.serial_number ILIKE $3 OR ivi.band_serial_no ILIKE $3)`;
            queryParams.push(`%${String(search).trim()}%`);
        }

        const countQuery = `
            SELECT COUNT(*)::int as total
            FROM rrh_ivi_inspections ivi
            WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
              AND (UPPER(TRIM(ivi.status)) IN ('COMPLETED', 'PASS') OR ivi.status ILIKE '%pass%' OR ivi.status ILIKE '%complete%' OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
              AND ivi.is_deleted = false
              AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_post_burn_in_inspections pbi
                  WHERE pbi.session_id = $2
                    AND (UPPER(TRIM(pbi.serial_number)) = UPPER(TRIM(ivi.serial_number)) OR UPPER(TRIM(COALESCE(pbi.band_serial_no, ''))) = UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))))
                    AND pbi.is_deleted = false
              )
              ${filterSql}
        `;
        const countRes = await pool.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        const dataQuery = `
            SELECT ivi.id as ipqc_id,
                   ivi.id as ivi_id,
                   ivi.id as hipot_id,
                   ivi.work_order_id,
                   ivi.serial_number,
                   ivi.band_serial_no,
                   ivi.physical_tpn,
                   ivi.band,
                   ivi.duplexer_main,
                   ivi.duplexer_part_no,
                   ivi.rrh_unit,
                   ivi.tejas_dc_no,
                   ivi.tejas_obd_no,
                   ivi.bat_lot_no,
                   ivi.sl_no,
                   ivi.remarks,
                   ivi.remarks as ivi_remarks,
                   ivi.remarks as hipot_remarks,
                   ivi.status,
                   ivi.status as ivi_status,
                   ivi.status as hipot_status,
                   ivi.scanned_by,
                   ivi.scanned_by as ivi_inspected_by,
                   ivi.scanned_by as hipot_inspected_by,
                   ivi.scanned_at
            FROM rrh_ivi_inspections ivi
            WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
              AND (UPPER(TRIM(ivi.status)) IN ('COMPLETED', 'PASS') OR ivi.status ILIKE '%pass%' OR ivi.status ILIKE '%complete%' OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
              AND ivi.is_deleted = false
              AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_post_burn_in_inspections pbi
                  WHERE pbi.session_id = $2
                    AND (UPPER(TRIM(pbi.serial_number)) = UPPER(TRIM(ivi.serial_number)) OR UPPER(TRIM(COALESCE(pbi.band_serial_no, ''))) = UPPER(TRIM(COALESCE(ivi.band_serial_no, ''))))
                    AND pbi.is_deleted = false
              )
              ${filterSql}
            ORDER BY ivi.scanned_at ASC, ivi.id ASC
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
        `;
        const dataRes = await pool.query(dataQuery, [...queryParams, limitNum, offset]);

        return res.status(200).json({
            success: true,
            data: dataRes.rows,
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum) || 1
        });
    } catch (err: any) {
        logger.error('Error in getRemainingIpqcMasterData (Non-ECN Initial): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch remaining IVI units.', error: err.message });
    }
};

export const getRemainingHipotMasterData = getRemainingIpqcMasterData;
