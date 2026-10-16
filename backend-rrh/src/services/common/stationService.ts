import { Request, Response } from 'express';
import { pool, getClient } from '../../utils/db';
import { createLogger } from '../../utils/logger';
import { getSessionUser } from '../../utils/authHelper';
import { StationId, RouteType, STATION_REGISTRY } from '../../workflows/common/stationRegistry';
import { WorkflowEngine } from '../../workflows/common/workflowEngine';
import ExcelJS from 'exceljs';
import { sendRrhSessionExcel } from '../../utils/rrhExcelGenerator';

const logger = createLogger('StationService');

export interface StationContext {
    stationId: StationId;
    route: RouteType;
    sessionTable: string;
    inspectionTable: string;
    postBurnInType?: 'INITIAL' | 'FINAL';
    logName: string;
}

export class StationService {
    /**
     * Get sessions for a given station and route with pagination and filtering.
     */
    public static async getSessions(ctx: StationContext, req: Request, res: Response) {
        try {
            const { status, search, page = 1, limit = 10 } = req.query;
            const pageNum = Math.max(1, parseInt(String(page)) || 1);
            const limitNum = Math.max(1, parseInt(String(limit)) || 10);
            const offset = (pageNum - 1) * limitNum;

            let whereClause = `WHERE s.is_deleted = false AND REPLACE(COALESCE(s.route, 'ECN'), '-', '_') = $1`;
            const params: any[] = [ctx.route];
            let pIdx = 2;

            if (ctx.postBurnInType) {
                whereClause += ` AND s.post_burn_in_type = $${pIdx}`;
                params.push(ctx.postBurnInType);
                pIdx++;
            }

            if (status) {
                const statusList = String(status)
                    .split(',')
                    .map(s => s.trim().toUpperCase())
                    .filter(Boolean);
                if (statusList.length === 1) {
                    whereClause += ` AND UPPER(TRIM(s.status)) = $${pIdx}`;
                    params.push(statusList[0]);
                    pIdx++;
                } else if (statusList.length > 1) {
                    whereClause += ` AND UPPER(TRIM(s.status)) = ANY($${pIdx})`;
                    params.push(statusList);
                    pIdx++;
                }
            }

            if (search) {
                whereClause += ` AND (s.work_order_id ILIKE $${pIdx} OR s.created_by_name ILIKE $${pIdx})`;
                params.push(`%${String(search).trim()}%`);
                pIdx++;
            }

            const countRes = await pool.query(`SELECT COUNT(*)::int as total FROM ${ctx.sessionTable} s ${whereClause}`, params);
            const total = countRes.rows[0]?.total || 0;

            const dataQuery = `
                SELECT s.*, 
                       COALESCE(w.work_order_date, w.date) as work_order_date,
                       w.lot_quantity
                FROM ${ctx.sessionTable} s
                LEFT JOIN rrh_work_orders w ON UPPER(TRIM(w.work_order_id)) = UPPER(TRIM(s.work_order_id))
                ${whereClause}
                ORDER BY s.created_at DESC
                LIMIT $${pIdx} OFFSET $${pIdx + 1}
            `;
            params.push(limitNum, offset);

            const dataRes = await pool.query(dataQuery, params);
            return res.status(200).json({
                success: true,
                data: dataRes.rows,
                sessions: dataRes.rows,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum) || 1
            });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error fetching sessions: ${err.message}`);
            return res.status(500).json({ message: `Failed to fetch ${ctx.logName} sessions.`, error: err.message });
        }
    }

    /**
     * Get session by ID
     */
    public static async getSessionById(ctx: StationContext, req: Request, res: Response) {
        const { id } = req.params;
        try {
            const query = `
                SELECT s.*, 
                       w.lot_quantity, 
                       COALESCE(w.work_order_date, w.date) as work_order_date,
                       w.status as wo_status
                FROM ${ctx.sessionTable} s
                LEFT JOIN rrh_work_orders w ON UPPER(TRIM(w.work_order_id)) = UPPER(TRIM(s.work_order_id))
                WHERE s.id = $1 AND s.is_deleted = false
            `;
            const result = await pool.query(query, [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ message: `${ctx.logName} session not found.` });
            }
            const session = result.rows[0];

            // Calculate stats for the session
            const statsRes = await pool.query(
                `SELECT 
                    COUNT(*)::int AS total_scanned,
                    COUNT(*) FILTER (WHERE UPPER(TRIM(status)) IN ('COMPLETED', 'PASS'))::int AS passed,
                    COUNT(*) FILTER (WHERE UPPER(TRIM(status)) = 'FAIL')::int AS failed,
                    COUNT(*) FILTER (WHERE defect_fixed IS NOT NULL AND defect_fixed != '')::int AS debug
                 FROM ${ctx.inspectionTable}
                 WHERE session_id = $1 AND is_deleted = false
                   AND REPLACE(COALESCE(route, 'ECN'), '-', '_') = $2`,
                [id, ctx.route]
            );
            const statsRow = statsRes.rows[0] || {};
            const totalScanned = statsRow.total_scanned || 0;
            const passed = statsRow.passed || 0;
            const failed = statsRow.failed || 0;
            const debug = statsRow.debug || 0;

            // Fetch predecessor passed count based on ctx
            let predecessorPassed = 0;
            if (ctx.stationId === 'NON_ECN_POST_BURN_IN_INITIAL') {
                const predRes = await pool.query(
                    `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(ivi.band_serial_no, ivi.serial_number))))::int as total
                     FROM rrh_ivi_inspections ivi
                     WHERE UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM($1))
                       AND (UPPER(TRIM(ivi.status)) IN ('COMPLETED', 'PASS') OR ivi.status ILIKE '%pass%' OR (UPPER(TRIM(ivi.status)) = 'FAIL' AND ivi.passed_to_next_stage = true))
                       AND REPLACE(COALESCE(ivi.route, 'ECN'), '-', '_') = 'NON_ECN'
                       AND ivi.is_deleted = false`,
                    [session.work_order_id]
                );
                predecessorPassed = predRes.rows[0]?.total || 0;
            } else if (ctx.stationId === 'NON_ECN_PROGRAMMING') {
                const predRes = await pool.query(
                    `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(pbi.band_serial_no, pbi.serial_number))))::int as total
                     FROM rrh_post_burn_in_inspections pbi
                     WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
                       AND UPPER(TRIM(pbi.status)) IN ('COMPLETED', 'PASS')
                       AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
                       AND pbi.post_burn_in_type = 'INITIAL'
                       AND pbi.is_deleted = false`,
                    [session.work_order_id]
                );
                predecessorPassed = predRes.rows[0]?.total || 0;
            } else if (ctx.stationId === 'NON_ECN_PRE_BURN_IN') {
                const predRes = await pool.query(
                    `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(prog.band_serial_no, prog.serial_number))))::int as total
                     FROM rrh_programming_inspections prog
                     WHERE UPPER(TRIM(prog.work_order_id)) = UPPER(TRIM($1))
                       AND UPPER(TRIM(prog.status)) IN ('COMPLETED', 'PASS')
                       AND REPLACE(COALESCE(prog.route, 'ECN'), '-', '_') = 'NON_ECN'
                       AND prog.is_deleted = false`,
                    [session.work_order_id]
                );
                predecessorPassed = predRes.rows[0]?.total || 0;
            } else if (ctx.stationId === 'NON_ECN_HIPOT') {
                const predRes = await pool.query(
                    `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(pbi.band_serial_no, pbi.serial_number))))::int as total
                     FROM rrh_pre_burn_in_inspections pbi
                     WHERE UPPER(TRIM(pbi.work_order_id)) = UPPER(TRIM($1))
                       AND UPPER(TRIM(pbi.status)) IN ('COMPLETED', 'PASS')
                       AND REPLACE(COALESCE(pbi.route, 'ECN'), '-', '_') = 'NON_ECN'
                       AND pbi.is_deleted = false`,
                    [session.work_order_id]
                );
                predecessorPassed = predRes.rows[0]?.total || 0;
            } else if (ctx.stationId === 'NON_ECN_POST_BURN_IN_FINAL') {
                const predRes = await pool.query(
                    `SELECT COUNT(DISTINCT UPPER(TRIM(COALESCE(h.band_serial_no, h.serial_number))))::int as total
                     FROM rrh_hipot_inspections h
                     WHERE UPPER(TRIM(h.work_order_id)) = UPPER(TRIM($1))
                       AND UPPER(TRIM(h.status)) IN ('COMPLETED', 'PASS')
                       AND REPLACE(COALESCE(h.route, 'ECN'), '-', '_') = 'NON_ECN'
                       AND h.is_deleted = false`,
                    [session.work_order_id]
                );
                predecessorPassed = predRes.rows[0]?.total || 0;
            }

            const stats = {
                totalScanned,
                passed,
                failed,
                debug,
                remaining: Math.max(0, (session.lot_quantity || predecessorPassed) - totalScanned),
                iviPassed: predecessorPassed,
                hipotPassed: predecessorPassed,
                postBurnInPassed: predecessorPassed,
                programmingPassed: predecessorPassed,
                preBurnInPassed: predecessorPassed,
                ipqcPassed: predecessorPassed
            };

            return res.status(200).json({
                ...session,
                stats
            });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error fetching session ${id}: ${err.message}`);
            return res.status(500).json({ message: 'Internal server error.', error: err.message });
        }
    }

    /**
     * Create a new session for a given station and route.
     */
    public static async createSession(ctx: StationContext, req: Request, res: Response) {
        const client = await getClient();
        try {
            const { work_order_id } = req.body;
            if (!work_order_id || !work_order_id.trim()) {
                return res.status(400).json({ message: 'work_order_id is required.' });
            }

            const cleanWo = work_order_id.trim();
            const operator = getSessionUser(req);

            await client.query('BEGIN');

            const woCheck = await client.query(
                `SELECT id, work_order_id, status FROM rrh_work_orders WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1)) AND is_deleted = false`,
                [cleanWo]
            );
            if (woCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: `Work order "${cleanWo}" not found.` });
            }

            // Check if active or completed session already exists for this WO and route
            let checkSql = `SELECT id, status FROM ${ctx.sessionTable} 
                            WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1)) 
                              AND is_deleted = false 
                              AND REPLACE(COALESCE(route, 'ECN'), '-', '_') = $2 
                              AND UPPER(TRIM(status)) IN ('IN PROGRESS', 'PENDING', 'PAUSED', 'COMPLETED')`;
            const checkParams: any[] = [cleanWo, ctx.route];
            if (ctx.postBurnInType) {
                checkSql += ` AND post_burn_in_type = $3`;
                checkParams.push(ctx.postBurnInType);
            }
            const activeRes = await client.query(checkSql, checkParams);
            if (activeRes.rows.length > 0) {
                await client.query('ROLLBACK');
                const existingStatus = String(activeRes.rows[0].status).toUpperCase();
                if (existingStatus === 'COMPLETED') {
                    return res.status(409).json({ message: `Work order "${cleanWo}" has already been completed in ${ctx.logName}.` });
                }
                return res.status(409).json({ message: `An active session already exists for work order "${cleanWo}".` });
            }

            let insertSql = `
                INSERT INTO ${ctx.sessionTable} (
                    work_order_id, status, created_by, created_by_name, route
            `;
            let valuesSql = `VALUES ($1, 'In Progress', $2, $3, $4`;
            const insertParams: any[] = [cleanWo, operator.username, operator.name, ctx.route];

            if (ctx.postBurnInType) {
                insertSql += `, post_burn_in_type`;
                valuesSql += `, $5`;
                insertParams.push(ctx.postBurnInType);
            }
            insertSql += `) ` + valuesSql + `) RETURNING *`;

            const insertRes = await client.query(insertSql, insertParams);
            await client.query('COMMIT');
            return res.status(201).json(insertRes.rows[0]);
        } catch (err: any) {
            await client.query('ROLLBACK');
            logger.error(`[${ctx.logName}] Error creating session: ${err.message}`);
            return res.status(500).json({ message: `Failed to create ${ctx.logName} session.`, error: err.message });
        } finally {
            client.release();
        }
    }

    /**
     * Update session status (e.g. COMPLETED)
     */
    public static async updateSessionStatus(ctx: StationContext, req: Request, res: Response) {
        const { id } = req.params;
        const { status } = req.body;
        const operator = getSessionUser(req);

        if (!status) {
            return res.status(400).json({ message: 'Status is required.' });
        }

        try {
            const query = `
                UPDATE ${ctx.sessionTable}
                SET status = $1,
                    updated_by = $2,
                    updated_by_name = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4 AND is_deleted = false
                RETURNING *
            `;
            const result = await pool.query(query, [status, operator.username, operator.name, id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ message: `${ctx.logName} session not found.` });
            }
            return res.status(200).json(result.rows[0]);
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error updating session status: ${err.message}`);
            return res.status(500).json({ message: 'Internal server error.', error: err.message });
        }
    }

    /**
     * Soft-delete session
     */
    public static async deleteSession(ctx: StationContext, req: Request, res: Response) {
        const { id } = req.params;
        const operator = getSessionUser(req);

        try {
            const query = `
                UPDATE ${ctx.sessionTable}
                SET is_deleted = true,
                    deleted_by = $1,
                    deleted_by_name = $2,
                    deleted_at = CURRENT_TIMESTAMP
                WHERE id = $3 AND is_deleted = false
                RETURNING id
            `;
            const result = await pool.query(query, [operator.username, operator.name, id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ message: `${ctx.logName} session not found.` });
            }
            return res.status(200).json({ message: `${ctx.logName} session deleted successfully.` });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error deleting session: ${err.message}`);
            return res.status(500).json({ message: 'Internal server error.', error: err.message });
        }
    }

    /**
     * Authoritatively look up a serial number and verify MES transition eligibility.
     */
    public static async lookupSerial(ctx: StationContext, req: Request, res: Response) {
        const { serial, work_order_id } = req.query;
        if (!serial || typeof serial !== 'string' || !serial.trim()) {
            return res.status(400).json({ message: 'serial query parameter is required.' });
        }

        const cleanSerial = serial.trim().toUpperCase();
        const woId = typeof work_order_id === 'string' ? work_order_id.trim() : '';

        const client = await getClient();
        try {
            const eligibility = await WorkflowEngine.verifyTransition(client, ctx.stationId, woId, cleanSerial);
            if (!eligibility.eligible) {
                return res.status(200).json({
                    found: false,
                    message: eligibility.reason || `Unit ${cleanSerial} is not eligible for ${ctx.logName}.`
                });
            }

            const session_id = req.query.session_id ? String(req.query.session_id) : null;
            let alreadyInspected = false;
            let previousInspection = null;

            if (session_id) {
                const prevRes = await client.query(
                    `SELECT * FROM ${ctx.inspectionTable}
                     WHERE session_id = $1
                       AND (UPPER(TRIM(serial_number)) = $2 OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = $2)
                       AND is_deleted = false
                     ORDER BY id DESC LIMIT 1`,
                    [session_id, cleanSerial]
                );
                if (prevRes.rows.length > 0) {
                    alreadyInspected = true;
                    previousInspection = prevRes.rows[0];
                }
            }

            const payload = {
                found: true,
                ...eligibility.predecessorRecord,
                already_inspected: alreadyInspected,
                previous_inspection: previousInspection
            };

            return res.status(200).json({
                ...payload,
                data: {
                    ...payload
                }
            });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error during serial lookup: ${err.message}`);
            return res.status(500).json({ message: 'Internal server error during serial lookup.', error: err.message });
        } finally {
            client.release();
        }
    }

    /**
     * Submit an inspection wrapped in a safe transaction with server-side transition enforcement.
     */
    public static async submitInspection(ctx: StationContext, req: Request, res: Response) {
        const { id: sessionId } = req.params;
        const operator = getSessionUser(req);
        const client = await getClient();

        try {
            await client.query('BEGIN');

            const sessionRes = await client.query(
                `SELECT * FROM ${ctx.sessionTable} WHERE id = $1 AND is_deleted = false FOR UPDATE`,
                [sessionId]
            );
            if (sessionRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ message: 'Session not found or deleted.' });
            }
            const session = sessionRes.rows[0];
            if (String(session.status).toUpperCase() === 'COMPLETED') {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'Cannot add inspections to a completed session.' });
            }

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
                ipqc_inspection_id,
                ivi_inspection_id,
                checkpoints,
                sl_no,
                status = 'COMPLETED',
                defect_fixed
            } = req.body;

            const cleanSerial = String(serial_number || '').trim().toUpperCase();
            const cleanWo = String(work_order_id || session.work_order_id).trim();

            if (!cleanSerial) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'serial_number is required.' });
            }

            const eligibility = await WorkflowEngine.verifyTransition(client, ctx.stationId, cleanWo, cleanSerial);
            if (!eligibility.eligible) {
                await client.query('ROLLBACK');
                return res.status(422).json({
                    message: eligibility.reason || `Unit ${cleanSerial} cannot enter ${ctx.logName} due to unmet transition prerequisites.`
                });
            }

            const isDuplicate = await WorkflowEngine.checkDuplicateScan(client, ctx.inspectionTable, Number(sessionId), cleanSerial);
            if (isDuplicate) {
                await client.query('ROLLBACK');
                return res.status(409).json({ message: `Unit ${cleanSerial} has already been inspected in this session.` });
            }

            let resolvedIviInspectionId: any = ivi_inspection_id 
                || eligibility.predecessorRecord?.ivi_inspection_id 
                || eligibility.predecessorRecord?.ivi_id 
                || null;

            if (!resolvedIviInspectionId && (ctx.stationId === 'NON_ECN_POST_BURN_IN_INITIAL' || ctx.stationId === 'ECN_IPQC')) {
                resolvedIviInspectionId = eligibility.predecessorRecord?.id || null;
            }

            if (!resolvedIviInspectionId) {
                const iviLookup = await client.query(
                    `SELECT id FROM rrh_ivi_inspections 
                     WHERE UPPER(TRIM(work_order_id)) = UPPER(TRIM($1))
                       AND (UPPER(TRIM(serial_number)) = $2 OR UPPER(TRIM(COALESCE(band_serial_no, ''))) = $2)
                       AND is_deleted = false
                     ORDER BY id DESC LIMIT 1`,
                    [cleanWo, cleanSerial]
                );
                if (iviLookup.rows.length > 0) {
                    resolvedIviInspectionId = iviLookup.rows[0].id;
                }
            }

            if (resolvedIviInspectionId) {
                const iviCheck = await client.query('SELECT id FROM rrh_ivi_inspections WHERE id = $1', [resolvedIviInspectionId]);
                if (iviCheck.rows.length === 0) {
                    resolvedIviInspectionId = null;
                }
            }

            let insertSql = `
                INSERT INTO ${ctx.inspectionTable} (
                    session_id, work_order_id, serial_number, band_serial_no,
                    physical_serial_number, physical_tpn, band, inspection_date,
                    e_label, pam_tpn, pam1, pam2, pam3, pam4, rfpc_tpn, rfpc_sl_no,
                    status, remarks, scanned_by, ivi_inspection_id, checkpoints,
                    sl_no, defect_fixed, route
            `;
            let valSql = `
                VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, CURRENT_DATE),
                        $9, $10, $11, $12, $13, $14, $15, $16,
                        $17, $18, $19, $20, $21, $22, $23, $24
            `;
            const params: any[] = [
                sessionId,
                cleanWo,
                cleanSerial,
                band_serial_no ? String(band_serial_no).trim().toUpperCase() : cleanSerial,
                physical_serial_number ? String(physical_serial_number).trim() : null,
                physical_tpn ? String(physical_tpn).trim() : null,
                band || null,
                inspection_date || null,
                e_label || null,
                pam_tpn || null,
                pam1 || null,
                pam2 || null,
                pam3 || null,
                pam4 || null,
                rfpc_tpn || null,
                rfpc_sl_no || null,
                status ? String(status).toUpperCase() : 'COMPLETED',
                remarks ? String(remarks).trim() : null,
                operator.username,
                resolvedIviInspectionId,
                JSON.stringify(Array.isArray(checkpoints) ? checkpoints : []),
                sl_no || null,
                defect_fixed || null,
                ctx.route
            ];

            if (ctx.postBurnInType) {
                insertSql += `, post_burn_in_type`;
                valSql += `, $25`;
                params.push(ctx.postBurnInType);
            }
            insertSql += `) ` + valSql + `) RETURNING *`;

            const insertRes = await client.query(insertSql, params);
            await client.query('COMMIT');

            return res.status(201).json(insertRes.rows[0]);
        } catch (err: any) {
            await client.query('ROLLBACK');
            logger.error(`[${ctx.logName}] Error submitting inspection: ${err.message}`);
            return res.status(500).json({ message: `Failed to record inspection for ${ctx.logName}.`, error: err.message });
        } finally {
            client.release();
        }
    }

    /**
     * Get scanned inspections for session
     * Recent inspections strictly means PASSED inspections (never FAIL/FAILED)
     */
    public static async getScannedInspections(ctx: StationContext, req: Request, res: Response) {
        const { id: sessionId } = req.params;
        const search = (req.query.search as string || '').trim();
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.max(1, parseInt(req.query.limit as string) || 10);
        const offset = (page - 1) * limit;

        try {
            const params: any[] = [sessionId, ctx.route];
            let searchClause = '';

            if (search) {
                params.push(`%${search}%`);
                searchClause = `
                    AND (
                        ins.serial_number ILIKE $${params.length}
                        OR ins.band_serial_no ILIKE $${params.length}
                        OR ins.physical_tpn ILIKE $${params.length}
                        OR ins.physical_serial_number ILIKE $${params.length}
                        OR ins.band ILIKE $${params.length}
                        OR ins.scanned_by ILIKE $${params.length}
                        OR ins.status ILIKE $${params.length}
                        OR ins.remarks ILIKE $${params.length}
                        OR ins.defect_fixed ILIKE $${params.length}
                    )
                `;
            }

            const countRes = await pool.query(
                `SELECT COUNT(*)::int as total FROM ${ctx.inspectionTable} ins
                 WHERE ins.session_id = $1 AND ins.is_deleted = false
                   AND REPLACE(COALESCE(ins.route, 'ECN'), '-', '_') = $2
                   AND (UPPER(TRIM(ins.status)) IN ('PASS', 'COMPLETED') OR ins.status ILIKE '%pass%' OR ins.status ILIKE '%complete%')
                   AND UPPER(TRIM(ins.status)) NOT IN ('FAIL', 'FAILED')
                   ${searchClause}`,
                params
            );
            const total = countRes.rows[0]?.total || 0;

            const dataRes = await pool.query(
                `SELECT ins.*,
                        COALESCE(NULLIF(TRIM(ins.remarks), ''), NULLIF(TRIM(ivi.remarks), ''), '—') as remarks,
                        COALESCE(NULLIF(TRIM(ivi.duplexer_main), ''), '—') as duplexer_main,
                        COALESCE(NULLIF(TRIM(ivi.duplexer_part_no), ''), '—') as duplexer_part_no,
                        COALESCE(NULLIF(TRIM(ivi.rrh_unit), ''), 'no defect') as rrh_unit,
                        COALESCE(NULLIF(TRIM(ivi.tejas_dc_no), ''), '—') as tejas_dc_no,
                        COALESCE(NULLIF(TRIM(ivi.tejas_obd_no), ''), '—') as tejas_obd_no,
                        COALESCE(NULLIF(TRIM(ivi.bat_lot_no), ''), '—') as lot
                 FROM ${ctx.inspectionTable} ins
                 LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = ins.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(ins.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(ins.serial_number)) AND ivi.is_deleted = false))
                 WHERE ins.session_id = $1 AND ins.is_deleted = false
                   AND REPLACE(COALESCE(ins.route, 'ECN'), '-', '_') = $2
                   AND (UPPER(TRIM(ins.status)) IN ('PASS', 'COMPLETED') OR ins.status ILIKE '%pass%' OR ins.status ILIKE '%complete%')
                   AND UPPER(TRIM(ins.status)) NOT IN ('FAIL', 'FAILED')
                   ${searchClause}
                 ORDER BY ins.scanned_at DESC, ins.id DESC
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
            logger.error(`[${ctx.logName}] Error fetching scanned inspections: ${err.message}`);
            return res.status(500).json({ message: 'Failed to fetch inspections.', error: err.message });
        }
    }

    /**
     * Get failed inspections for session
     */
    public static async getFailedInspections(ctx: StationContext, req: Request, res: Response) {
        const { id: sessionId } = req.params;
        try {
            const dataRes = await pool.query(
                `SELECT 
                    ins.*,
                    COALESCE(NULLIF(TRIM(ins.remarks), ''), NULLIF(TRIM(ivi.remarks), ''), '—') as remarks,
                    COALESCE(NULLIF(TRIM(ivi.duplexer_main), ''), '—') as duplexer_main,
                    COALESCE(NULLIF(TRIM(ivi.duplexer_part_no), ''), '—') as duplexer_part_no,
                    COALESCE(NULLIF(TRIM(ivi.rrh_unit), ''), 'no defect') as rrh_unit,
                    COALESCE(NULLIF(TRIM(ivi.tejas_dc_no), ''), '—') as tejas_dc_no,
                    COALESCE(NULLIF(TRIM(ivi.tejas_obd_no), ''), '—') as tejas_obd_no,
                    COALESCE(NULLIF(TRIM(ivi.bat_lot_no), ''), '—') as lot
                 FROM ${ctx.inspectionTable} ins
                 LEFT JOIN rrh_ivi_inspections ivi ON (ivi.id = ins.ivi_inspection_id OR (UPPER(TRIM(ivi.work_order_id)) = UPPER(TRIM(ins.work_order_id)) AND UPPER(TRIM(ivi.serial_number)) = UPPER(TRIM(ins.serial_number)) AND ivi.is_deleted = false))
                 WHERE ins.session_id = $1 
                   AND (UPPER(TRIM(ins.status)) IN ('FAIL', 'FAILED') OR ins.status ILIKE '%fail%')
                   AND (ins.debug_status IS NULL OR ins.debug_status = 'PENDING' OR ins.debug_status NOT IN ('DEBUG_PASS', 'REPAIRED', 'RECTIFIED', 'PASS'))
                   AND (ins.is_reinspected IS NULL OR ins.is_reinspected = false)
                   AND ins.is_deleted = false
                   AND REPLACE(COALESCE(ins.route, 'ECN'), '-', '_') = $2
                 ORDER BY ins.scanned_at DESC, ins.id DESC`,
                [sessionId, ctx.route]
            );
            return res.status(200).json({ success: true, data: dataRes.rows });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error fetching failed inspections: ${err.message}`);
            return res.status(500).json({ message: 'Failed to fetch failed inspections.', error: err.message });
        }
    }

    /**
     * Get debug inspections
     */
    public static async getDebugInspections(ctx: StationContext, req: Request, res: Response) {
        const { id: sessionId } = req.params;
        try {
            const dataRes = await pool.query(
                `SELECT * FROM ${ctx.inspectionTable}
                 WHERE session_id = $1 AND is_deleted = false AND debug_status IS NOT NULL
                   AND REPLACE(COALESCE(route, 'ECN'), '-', '_') = $2
                 ORDER BY scanned_at DESC, id DESC`,
                [sessionId, ctx.route]
            );
            return res.status(200).json({ success: true, data: dataRes.rows });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error fetching debug inspections: ${err.message}`);
            return res.status(500).json({ message: 'Failed to fetch debug inspections.', error: err.message });
        }
    }

    /**
     * Update debug action
     */
    public static async updateDebugAction(ctx: StationContext, req: Request, res: Response) {
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
                    `UPDATE ${ctx.inspectionTable}
                     SET debug_status = $1,
                         status = 'COMPLETED',
                         is_reinspected = true,
                         defect_fixed = COALESCE(remarks, $2, 'Defect rectified and verified in Debug.'),
                         debug_remarks = COALESCE($2, debug_remarks),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $3 AND is_deleted = false
                     RETURNING *`,
                    [cleanStatus, debug_remarks || null, id]
                );
            } else {
                updateRes = await pool.query(
                    `UPDATE ${ctx.inspectionTable}
                     SET debug_status = $1,
                         status = 'FAIL',
                         debug_remarks = COALESCE($2, debug_remarks),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = $3 AND is_deleted = false
                     RETURNING *`,
                    [cleanStatus, debug_remarks || null, id]
                );
            }

            if (updateRes.rows.length === 0) {
                return res.status(404).json({ message: 'Inspection record not found.' });
            }

            return res.status(200).json({
                success: true,
                message: isPassing ? 'Unit rectified and passed!' : 'Debug status updated.',
                data: updateRes.rows[0]
            });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error updating debug action: ${err.message}`);
            return res.status(500).json({ message: 'Failed to update debug action.', error: err.message });
        }
    }

    /**
     * Export session inspection records to Excel matching SMT Post AOI visual format
     */
    public static async exportExcel(ctx: StationContext, req: Request, res: Response) {
        const { id } = req.params;
        const operator = getSessionUser(req);

        try {
            const sessionRes = await pool.query(
                `SELECT s.*, 
                        w.lot_quantity, 
                        COALESCE(w.work_order_date, w.date) as work_order_date,
                        (
                            SELECT ri.lot 
                            FROM rrh_inventory ri 
                            WHERE ri.import_id = w.active_import_id 
                               OR (w.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = w.id))
                            LIMIT 1
                        ) as lot_number,
                        w.status as wo_status
                 FROM ${ctx.sessionTable} s
                 LEFT JOIN rrh_work_orders w ON UPPER(TRIM(w.work_order_id)) = UPPER(TRIM(s.work_order_id))
                 WHERE s.id = $1 AND s.is_deleted = false`,
                [id]
            );

            if (sessionRes.rows.length === 0) {
                return res.status(404).json({ message: 'Session not found.' });
            }
            const session = sessionRes.rows[0];

            const statusParam = (req.query.status as string || req.query.type as string || '').trim().toUpperCase();
            const isFail = statusParam === 'FAIL' || statusParam === 'FAILED';
            const isRecent = statusParam === 'PASS' || statusParam === 'RECENT';
            const isDebug = statusParam === 'DEBUG';

            let filterSql = '';
            if (isRecent) {
                filterSql = ` AND (UPPER(TRIM(status)) IN ('PASS', 'COMPLETED') OR status ILIKE '%pass%' OR status ILIKE '%complete%') AND UPPER(TRIM(status)) NOT IN ('FAIL', 'FAILED')`;
            } else if (isFail) {
                filterSql = ` AND (UPPER(TRIM(status)) IN ('FAIL', 'FAILED') OR status ILIKE '%fail%')`;
            } else if (isDebug) {
                filterSql = ` AND debug_status IS NOT NULL`;
            }

            if (ctx.postBurnInType) {
                filterSql += ` AND post_burn_in_type = '${ctx.postBurnInType}'`;
            }

            // Summary counts
            let countSql = `
                SELECT 
                    COUNT(*)::int as total_scanned,
                    COUNT(*) FILTER (WHERE (UPPER(TRIM(status)) IN ('PASS', 'COMPLETED') OR status ILIKE '%pass%' OR status ILIKE '%complete%') AND UPPER(TRIM(status)) NOT IN ('FAIL', 'FAILED'))::int as passed_count,
                    COUNT(*) FILTER (WHERE UPPER(TRIM(status)) IN ('FAIL', 'FAILED') OR status ILIKE '%fail%')::int as failed_count
                FROM ${ctx.inspectionTable}
                WHERE session_id = $1 AND is_deleted = false
                  AND REPLACE(COALESCE(route, 'ECN'), '-', '_') = $2
            `;
            if (ctx.postBurnInType) {
                countSql += ` AND post_burn_in_type = '${ctx.postBurnInType}'`;
            }

            const countRes = await pool.query(countSql, [id, ctx.route]);
            const totalScanned = countRes.rows[0]?.total_scanned || 0;
            const passedCount = countRes.rows[0]?.passed_count || 0;
            const failedCount = countRes.rows[0]?.failed_count || 0;
            const lotQty = Number(session.lot_quantity) || 0;
            const pending = Math.max(0, lotQty - passedCount);
            const yieldPercent = lotQty > 0
                ? ((passedCount / lotQty) * 100).toFixed(2) + '%'
                : (totalScanned > 0 ? ((passedCount / totalScanned) * 100).toFixed(2) + '%' : '0.00%');

            const recordsRes = await pool.query(
                `SELECT * FROM ${ctx.inspectionTable}
                 WHERE session_id = $1 AND is_deleted = false
                   AND REPLACE(COALESCE(route, 'ECN'), '-', '_') = $2
                   ${filterSql}
                 ORDER BY scanned_at DESC, id DESC`,
                [id, ctx.route]
            );
            const rows = recordsRes.rows;

            const tableRows = rows.map((r, idx) => ({
                sl: r.sl_no || (idx + 1),
                serial_number: r.serial_number || '—',
                band_serial_no: r.band_serial_no || r.serial_number || '—',
                physical_tpn: r.physical_tpn || '—',
                band: r.band || '—',
                status: r.status || '—',
                scanned_by: r.scanned_by || '—',
                scanned_at: r.scanned_at ? new Date(r.scanned_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '—',
                remarks: r.defect_fixed || r.remarks || (isFail ? (r.remarks || 'Failed Inspection') : '—')
            }));

            let title = `RRH ${ctx.logName.toUpperCase()} SESSION REPORT`;
            let section4Title = 'SCAN HISTORY';
            let filePrefix = `RRH_${ctx.logName.replace(/\s+/g, '_')}_Session`;

            if (isFail) {
                title = `RRH ${ctx.logName.toUpperCase()} FAILED INSPECTIONS REPORT`;
                section4Title = 'FAILED INSPECTIONS HISTORY';
                filePrefix = `RRH_${ctx.logName.replace(/\s+/g, '_')}_Failed_Inspections`;
            } else if (isRecent) {
                title = `RRH ${ctx.logName.toUpperCase()} RECENT INSPECTIONS REPORT`;
                section4Title = 'RECENT INSPECTIONS HISTORY (PASSED)';
                filePrefix = `RRH_${ctx.logName.replace(/\s+/g, '_')}_Recent_Inspections`;
            } else if (isDebug) {
                title = `RRH ${ctx.logName.toUpperCase()} DEBUG INSPECTIONS REPORT`;
                section4Title = 'DEBUG INSPECTIONS HISTORY';
                filePrefix = `RRH_${ctx.logName.replace(/\s+/g, '_')}_Debug_Inspections`;
            }

            await sendRrhSessionExcel(res, `${filePrefix}_${session.work_order_id}.xlsx`, {
                title,
                stageName: ctx.logName,
                route: ctx.route,
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
                    { header: 'Serial Number', key: 'serial_number', width: 22, align: 'left' },
                    { header: 'Band Serial No', key: 'band_serial_no', width: 22, align: 'left' },
                    { header: 'Physical TPN', key: 'physical_tpn', width: 20, align: 'left' },
                    { header: 'Band', key: 'band', width: 12, align: 'center' },
                    { header: 'Status', key: 'status', width: 14, align: 'center' },
                    { header: 'Scanned By', key: 'scanned_by', width: 20, align: 'left' },
                    { header: 'Date & Time', key: 'scanned_at', width: 24, align: 'center' },
                    { header: 'Remarks / Defect Fixed', key: 'remarks', width: 30, align: 'left' }
                ],
                rows: tableRows,
                sheetName: isFail ? 'Failed Inspections' : (isRecent ? 'Recent Inspections' : 'Session Report')
            });
        } catch (err: any) {
            logger.error(`[${ctx.logName}] Error exporting Excel: ${err.message}`);
            return res.status(500).json({ message: 'Failed to export report.', error: err.message });
        }
    }
}
