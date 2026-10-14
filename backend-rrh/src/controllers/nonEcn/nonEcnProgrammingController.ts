import { Request, Response } from 'express';
import { pool } from '../../utils/db';
import { createLogger } from '../../utils/logger';
import { StationService, StationContext } from '../../services/common/stationService';

const logger = createLogger('RRH-NON-ECN-PROGRAMMING');

const NON_ECN_PROGRAMMING_CTX: StationContext = {
    stationId: 'NON_ECN_PROGRAMMING',
    route: 'NON_ECN',
    sessionTable: 'rrh_programming_sessions',
    inspectionTable: 'rrh_programming_inspections',
    logName: 'Non-ECN Programming'
};

export const getEligibleProgrammingWorkOrders = async (_req: Request, res: Response) => {
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
                    SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(pbi.band_serial_no, pbi.serial_number))))::int
                    FROM rrh_post_burn_in_inspections pbi
                    LEFT JOIN rrh_post_burn_in_sessions pbis ON pbis.id = pbi.session_id
                    WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM(w.work_order_id))
                      AND (UPPER(TRIM(pbi.status)) IN ('COMPLETED', 'PASS') OR pbi.status ILIKE '%pass%' OR pbi.status ILIKE '%complete%')
                      AND pbi.is_deleted = false
                      AND (pbis.is_deleted IS NULL OR pbis.is_deleted = false)
                      AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
                      AND pbi.post_burn_in_type = 'INITIAL'
                ) as ipqc_passed_count
            FROM rrh_work_orders w
            WHERE (w.is_deleted IS NULL OR w.is_deleted = false)
              AND NOT EXISTS (
                SELECT 1
                FROM rrh_programming_sessions s
                WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id))
                  AND s.is_deleted = false
                  AND REPLACE(COALESCE(s.route, 'ECN'), '-', '_') = 'NON_ECN'
                  AND UPPER(TRIM(s.status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')
              )
            ORDER BY w.created_at DESC, w.id DESC
        `);

        return res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error('Error in getEligibleProgrammingWorkOrders (Non-ECN): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch eligible work orders for Non-ECN Programming.', error: err.message });
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
            `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(pbi.band_serial_no, pbi.serial_number))))::int as count
             FROM rrh_post_burn_in_inspections pbi
             LEFT JOIN rrh_post_burn_in_sessions pbis ON pbis.id = pbi.session_id
             WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
               AND (UPPER(TRIM(pbi.status)) IN ('COMPLETED', 'PASS') OR pbi.status ILIKE '%pass%' OR pbi.status ILIKE '%complete%')
               AND pbi.is_deleted = false
               AND (pbis.is_deleted IS NULL OR pbis.is_deleted = false)
               AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
               AND pbi.post_burn_in_type = 'INITIAL'`,
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
                ipqc_passed_count: passedCount
            }
        });
    } catch (err: any) {
        logger.error('Error in getWorkOrderIpqcDetails (Non-ECN): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch details for Non-ECN work order.', error: err.message });
    }
};

export const createProgrammingSession = (req: Request, res: Response) =>
    StationService.createSession(NON_ECN_PROGRAMMING_CTX, req, res);

export const getProgrammingSessions = (req: Request, res: Response) =>
    StationService.getSessions(NON_ECN_PROGRAMMING_CTX, req, res);

export const getProgrammingSessionById = (req: Request, res: Response) =>
    StationService.getSessionById(NON_ECN_PROGRAMMING_CTX, req, res);

export const updateProgrammingSessionStatus = (req: Request, res: Response) =>
    StationService.updateSessionStatus(NON_ECN_PROGRAMMING_CTX, req, res);

export const deleteProgrammingSession = (req: Request, res: Response) =>
    StationService.deleteSession(NON_ECN_PROGRAMMING_CTX, req, res);

export const lookupSerialDetails = (req: Request, res: Response) =>
    StationService.lookupSerial(NON_ECN_PROGRAMMING_CTX, req, res);

export const submitInspection = (req: Request, res: Response) =>
    StationService.submitInspection(NON_ECN_PROGRAMMING_CTX, req, res);

export const getScannedInspections = (req: Request, res: Response) =>
    StationService.getScannedInspections(NON_ECN_PROGRAMMING_CTX, req, res);

export const getFailedInspections = (req: Request, res: Response) =>
    StationService.getFailedInspections(NON_ECN_PROGRAMMING_CTX, req, res);

export const getDebugInspections = (req: Request, res: Response) =>
    StationService.getDebugInspections(NON_ECN_PROGRAMMING_CTX, req, res);

export const updateDebugAction = (req: Request, res: Response) =>
    StationService.updateDebugAction(NON_ECN_PROGRAMMING_CTX, req, res);

export const exportProgrammingExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_PROGRAMMING_CTX, req, res);

export const exportUnscannedExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_PROGRAMMING_CTX, req, res);

export const exportDebugExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_PROGRAMMING_CTX, req, res);

export const getRemainingIpqcMasterData = async (req: Request, res: Response) => {
    try {
        const { id: sessionId } = req.params;
        const { page = 1, limit = 50, search = '' } = req.query;
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.max(1, parseInt(String(limit)) || 50);
        const offset = (pageNum - 1) * limitNum;

        const sessionRes = await pool.query(`SELECT work_order_id FROM rrh_programming_sessions WHERE id = $1`, [sessionId]);
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found.' });
        }
        const woId = sessionRes.rows[0].work_order_id;

        let queryParams: any[] = [woId, sessionId];
        let filterSql = '';
        if (search) {
            filterSql = ` AND (pbi.serial_number ILIKE $3 OR pbi.band_serial_no ILIKE $3 OR pbi.physical_tpn ILIKE $3)`;
            queryParams.push(`%${String(search).trim()}%`);
        }

        const countQuery = `
            SELECT COUNT(*)::int as total
            FROM rrh_post_burn_in_inspections pbi
            WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
              AND (UPPER(TRIM(pbi.status)) IN ('COMPLETED', 'PASS') OR pbi.status ILIKE '%pass%' OR pbi.status ILIKE '%complete%')
              AND pbi.is_deleted = false
              AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
              AND pbi.post_burn_in_type = 'INITIAL'
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_programming_inspections prog
                  WHERE prog.session_id = $2
                    AND UPPER(TRIM(prog.serial_number)) = UPPER(TRIM(pbi.serial_number))
                    AND prog.is_deleted = false
              )
              ${filterSql}
        `;
        const countRes = await pool.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        const dataQuery = `
            SELECT pbi.id as ipqc_id,
                   pbi.id as pbi_id,
                   COALESCE(pbi.ivi_inspection_id, ivi.id) as ivi_id,
                   pbi.work_order_id,
                   pbi.serial_number,
                   pbi.band_serial_no,
                   pbi.physical_tpn,
                   pbi.band,
                   pbi.e_label,
                   pbi.pam_tpn,
                   pbi.pam1,
                   pbi.pam2,
                   pbi.pam3,
                   pbi.pam4,
                   pbi.rfpc_tpn,
                   pbi.rfpc_sl_no,
                   pbi.sl_no,
                   pbi.status,
                   COALESCE(NULLIF(TRIM(pbi.remarks), ''), NULLIF(TRIM(ivi.remarks), ''), '—') as remarks,
                   pbi.scanned_at,
                   COALESCE(NULLIF(TRIM(ivi.duplexer_main), ''), '—') as duplexer_main,
                   COALESCE(NULLIF(TRIM(ivi.duplexer_part_no), ''), '—') as duplexer_part_no,
                   COALESCE(NULLIF(TRIM(ivi.rrh_unit), ''), 'no defect') as rrh_unit,
                   COALESCE(NULLIF(TRIM(ivi.tejas_dc_no), ''), '—') as tejas_dc_no,
                   COALESCE(NULLIF(TRIM(ivi.tejas_obd_no), ''), '—') as tejas_obd_no,
                   COALESCE(NULLIF(TRIM(ivi.bat_lot_no), ''), '—') as lot,
                   COALESCE(NULLIF(TRIM(ivi.bat_lot_no), ''), '—') as bat_lot_no
            FROM rrh_post_burn_in_inspections pbi
            LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = pbi.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(pbi.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(pbi.serial_number)) AND ivi.is_deleted = false))
            WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
              AND (UPPER(TRIM(pbi.status)) IN ('COMPLETED', 'PASS') OR pbi.status ILIKE '%pass%' OR pbi.status ILIKE '%complete%')
              AND pbi.is_deleted = false
              AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
              AND pbi.post_burn_in_type = 'INITIAL'
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_programming_inspections prog
                  WHERE prog.session_id = $2
                    AND UPPER(TRIM(prog.serial_number)) = UPPER(TRIM(pbi.serial_number))
                    AND prog.is_deleted = false
              )
              ${filterSql}
            ORDER BY pbi.scanned_at ASC, pbi.id ASC
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
        logger.error('Error in getRemainingIpqcMasterData (Non-ECN): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch remaining units.', error: err.message });
    }
};
