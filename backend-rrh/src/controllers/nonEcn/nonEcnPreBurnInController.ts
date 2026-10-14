import { Request, Response } from 'express';
import { StationService, StationContext } from '../../services/common/stationService';

const NON_ECN_PRE_BURN_IN_CTX: StationContext = {
    stationId: 'NON_ECN_PRE_BURN_IN',
    route: 'NON_ECN',
    sessionTable: 'rrh_pre_burn_in_sessions',
    inspectionTable: 'rrh_pre_burn_in_inspections',
    logName: 'Non-ECN Pre-Burn-In'
};

export const createPreBurnInSession = (req: Request, res: Response) =>
    StationService.createSession(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const getPreBurnInSessions = (req: Request, res: Response) =>
    StationService.getSessions(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const getPreBurnInSessionById = (req: Request, res: Response) =>
    StationService.getSessionById(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const updatePreBurnInSessionStatus = (req: Request, res: Response) =>
    StationService.updateSessionStatus(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const deletePreBurnInSession = (req: Request, res: Response) =>
    StationService.deleteSession(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const lookupSerialDetails = (req: Request, res: Response) =>
    StationService.lookupSerial(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const submitInspection = (req: Request, res: Response) =>
    StationService.submitInspection(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const getScannedInspections = (req: Request, res: Response) =>
    StationService.getScannedInspections(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const getFailedInspections = (req: Request, res: Response) =>
    StationService.getFailedInspections(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const getDebugInspections = (req: Request, res: Response) =>
    StationService.getDebugInspections(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const updateDebugAction = (req: Request, res: Response) =>
    StationService.updateDebugAction(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const exportPreBurnInExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const exportUnscannedExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_PRE_BURN_IN_CTX, req, res);

export const exportDebugExcel = (req: Request, res: Response) =>
    StationService.exportExcel(NON_ECN_PRE_BURN_IN_CTX, req, res);

import { pool } from '../../utils/db';
import { createLogger } from '../../utils/logger';

const logger = createLogger('RRH-NON-ECN-PRE-BURN-IN');

export const getEligiblePreBurnInWorkOrders = async (_req: Request, res: Response) => {
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
                    SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(prog.band_serial_no, prog.serial_number))))::int
                    FROM rrh_programming_inspections prog
                    LEFT JOIN rrh_programming_sessions progs ON progs.id = prog.session_id
                    WHERE UPPER(TRIM(prog.work_order_id)) = UPPER(TRIM(w.work_order_id))
                      AND (UPPER(TRIM(prog.status)) IN ('COMPLETED', 'PASS') OR prog.status ILIKE '%pass%' OR prog.status ILIKE '%complete%')
                      AND prog.is_deleted = false
                      AND (progs.is_deleted IS NULL OR progs.is_deleted = false)
                      AND REPLACE(COALESCE(prog.route, 'ECN'), '-', '_') = 'NON_ECN'
                ) as programming_passed_count
            FROM rrh_work_orders w
            WHERE (w.is_deleted IS NULL OR w.is_deleted = false)
              AND NOT EXISTS (
                SELECT 1
                FROM rrh_pre_burn_in_sessions s
                WHERE UPPER(TRIM(s.work_order_id)) = UPPER(TRIM(w.work_order_id))
                  AND s.is_deleted = false
                  AND REPLACE(COALESCE(s.route, 'ECN'), '-', '_') = 'NON_ECN'
                  AND UPPER(TRIM(s.status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')
              )
            ORDER BY w.created_at DESC, w.id DESC
        `);

        return res.status(200).json({ success: true, data: result.rows });
    } catch (err: any) {
        logger.error('Error in getEligiblePreBurnInWorkOrders (Non-ECN): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch eligible work orders for Non-ECN Pre-Burn-In.', error: err.message });
    }
};

export const getWorkOrderProgrammingDetails = async (req: Request, res: Response) => {
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
            `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(prog.band_serial_no, prog.serial_number))))::int as count
             FROM rrh_programming_inspections prog
             LEFT JOIN rrh_programming_sessions progs ON progs.id = prog.session_id
             WHERE UPPER(TRIM(prog.work_order_id)) = UPPER(TRIM($1))
               AND (UPPER(TRIM(prog.status)) IN ('COMPLETED', 'PASS') OR prog.status ILIKE '%pass%' OR prog.status ILIKE '%complete%')
               AND prog.is_deleted = false
               AND (progs.is_deleted IS NULL OR progs.is_deleted = false)
               AND REPLACE(COALESCE(prog.route, 'ECN'), '-', '_') = 'NON_ECN'`,
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
                programming_passed_count: passedCount
            }
        });
    } catch (err: any) {
        logger.error('Error in getWorkOrderProgrammingDetails (Non-ECN): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch details for Non-ECN Pre-Burn-In.', error: err.message });
    }
};

export const getRemainingProgrammingMasterData = async (req: Request, res: Response) => {
    try {
        const { id: sessionId } = req.params;
        const { page = 1, limit = 50, search = '' } = req.query;
        const pageNum = Math.max(1, parseInt(String(page)) || 1);
        const limitNum = Math.max(1, parseInt(String(limit)) || 50);
        const offset = (pageNum - 1) * limitNum;

        const sessionRes = await pool.query(`SELECT work_order_id FROM rrh_pre_burn_in_sessions WHERE id = $1`, [sessionId]);
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Session not found.' });
        }
        const woId = sessionRes.rows[0].work_order_id;

        let queryParams: any[] = [woId, sessionId];
        let filterSql = '';
        if (search) {
            filterSql = ` AND (prog.serial_number ILIKE $3 OR prog.band_serial_no ILIKE $3 OR prog.physical_tpn ILIKE $3)`;
            queryParams.push(`%${String(search).trim()}%`);
        }

        const countQuery = `
            SELECT COUNT(*)::int as total
            FROM rrh_programming_inspections prog
            WHERE UPPER(TRIM(prog.work_order_id)) = UPPER(TRIM($1))
              AND (UPPER(TRIM(prog.status)) IN ('COMPLETED', 'PASS') OR prog.status ILIKE '%pass%' OR prog.status ILIKE '%complete%')
              AND prog.is_deleted = false
              AND REPLACE(COALESCE(prog.route, 'ECN'), '-', '_') = 'NON_ECN'
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_pre_burn_in_inspections pbi
                  WHERE pbi.session_id = $2
                    AND (UPPER(TRIM(pbi.serial_number)) = UPPER(TRIM(prog.serial_number)) OR UPPER(TRIM(COALESCE(pbi.band_serial_no, ''))) = UPPER(TRIM(COALESCE(prog.band_serial_no, ''))))
                    AND pbi.is_deleted = false
              )
              ${filterSql}
        `;
        const countRes = await pool.query(countQuery, queryParams);
        const total = countRes.rows[0]?.total || 0;

        const dataQuery = `
            SELECT prog.id as ipqc_id,
                   prog.id as programming_id,
                   COALESCE(prog.ivi_inspection_id, ivi.id) as ivi_id,
                   prog.work_order_id,
                   prog.serial_number,
                   prog.band_serial_no,
                   prog.physical_tpn,
                   prog.band,
                   prog.e_label,
                   prog.pam_tpn,
                   prog.pam1,
                   prog.pam2,
                   prog.pam3,
                   prog.pam4,
                   prog.rfpc_tpn,
                   prog.rfpc_sl_no,
                   prog.sl_no,
                   prog.status,
                   COALESCE(NULLIF(TRIM(prog.remarks), ''), NULLIF(TRIM(ivi.remarks), ''), '—') as remarks,
                   prog.scanned_at,
                   COALESCE(NULLIF(TRIM(ivi.duplexer_main), ''), '—') as duplexer_main,
                   COALESCE(NULLIF(TRIM(ivi.duplexer_part_no), ''), '—') as duplexer_part_no,
                   COALESCE(NULLIF(TRIM(ivi.rrh_unit), ''), 'no defect') as rrh_unit,
                   COALESCE(NULLIF(TRIM(ivi.tejas_dc_no), ''), '—') as tejas_dc_no,
                   COALESCE(NULLIF(TRIM(ivi.tejas_obd_no), ''), '—') as tejas_obd_no,
                   COALESCE(NULLIF(TRIM(ivi.bat_lot_no), ''), '—') as lot,
                   COALESCE(NULLIF(TRIM(ivi.bat_lot_no), ''), '—') as bat_lot_no
            FROM rrh_programming_inspections prog
            LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = prog.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(prog.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(prog.serial_number)) AND ivi.is_deleted = false))
            WHERE UPPER(TRIM(prog.work_order_id)) = UPPER(TRIM($1))
              AND (UPPER(TRIM(prog.status)) IN ('COMPLETED', 'PASS') OR prog.status ILIKE '%pass%' OR prog.status ILIKE '%complete%')
              AND prog.is_deleted = false
              AND REPLACE(COALESCE(prog.route, 'ECN'), '-', '_') = 'NON_ECN'
              AND NOT EXISTS (
                  SELECT 1 FROM rrh_pre_burn_in_inspections pbi
                  WHERE pbi.session_id = $2
                    AND (UPPER(TRIM(pbi.serial_number)) = UPPER(TRIM(prog.serial_number)) OR UPPER(TRIM(COALESCE(pbi.band_serial_no, ''))) = UPPER(TRIM(COALESCE(prog.band_serial_no, ''))))
                    AND pbi.is_deleted = false
              )
              ${filterSql}
            ORDER BY prog.scanned_at ASC, prog.id ASC
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
        logger.error('Error in getRemainingProgrammingMasterData (Non-ECN): ' + err.message);
        return res.status(500).json({ message: 'Failed to fetch remaining programming units for Non-ECN Pre-Burn-In.', error: err.message });
    }
};
