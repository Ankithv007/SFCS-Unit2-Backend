import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import * as ExcelJS from 'exceljs';
import { getAutoPopulateDetailsHelper, resolveWorkOrderSide, getEligibleWorkOrdersHelper } from '../utils/smtHelper';

const logger = createLogger('ReworkController');

// Helper to get session operator details
const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    return {
        id: user?.id || user?.userId || null,
        name: user?.name || user?.email || 'Unknown User',
        username: user?.username || user?.name || user?.email || 'unknown',
        role: user?.role || 'OPERATOR'
    };
};

/**
 * GET /api/smt/rework/eligible-wos
 * Fetch all work orders eligible for Rework.
 */
export const getEligibleWorkOrders = async (req: Request, res: Response) => {
    try {
        const rows = await getEligibleWorkOrdersHelper('Rework');
        return res.status(200).json(rows);
    } catch (err: any) {
        logger.error('Error fetching eligible work orders:', err);
        return res.status(500).json({ message: 'Internal server error while fetching eligible work orders.' });
    }
};

/**
 * GET /api/smt/rework/stencil-details/:woId
 * Fetch active stencil details associated with a Work Order.
 */
export const getStencilDetailsForWo = async (req: Request, res: Response) => {
    const { woId } = req.params;
    const side = req.query.side as string; // 'Top' or 'Bottom'
    try {
        let query = `
            SELECT 
                lc.id AS stencil_lifecycle_id,
                lc.stencil_record_id,
                lc.stencil_name,
                sm.revision AS stencil_version,
                sm.status AS stencil_status,
                sm.job_number,
                sm.thickness_mills,
                lc.qty_life_cycle,
                lc.balance_life_cycle AS remaining_life,
                lc.current_used_life_cycle AS current_life_count,
                lc.sides AS stencil_side,
                sm.remarks AS stencil_remarks,
                sm.manufacturing_date AS stencil_manufacturing_date,
                (
                    SELECT created_at FROM audit_log 
                    WHERE entity_type = 'STENCIL_MASTER' 
                      AND entity_id = sm.id::text 
                      AND event_type = 'CLEAN'
                    ORDER BY created_at DESC LIMIT 1
                ) AS last_cleaning_date,
                (
                    SELECT created_at FROM audit_log 
                    WHERE entity_type = 'STENCIL_MASTER' 
                      AND entity_id = sm.id::text 
                      AND event_type = 'INSPECT'
                    ORDER BY created_at DESC LIMIT 1
                ) AS last_inspection_date
            FROM smt_stencil_lifecycle lc
            JOIN stencil_master sm ON lc.stencil_record_id = sm.id
            WHERE lc.work_order_id = $1
              AND lc.is_deleted = false
        `;
        const params: any[] = [woId];
        if (side) {
            query += ` AND LOWER(lc.sides) = $2`;
            params.push(side.toLowerCase());
        }
        query += ` ORDER BY lc.created_at DESC LIMIT 1`;

        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'No active stencil lifecycle record found for this Work Order.' });
        }
        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error fetching stencil details:', err);
        return res.status(500).json({ message: 'Internal server error while fetching stencil details.' });
    }
};

/**
 * POST /api/smt/rework/sessions
 * Start a new Rework Session.
 */
export const createReworkSession = async (req: Request, res: Response) => {
    const { work_order_id, stencil_lifecycle_id, squeegee_number, solder_paste_barcode, side } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id || !stencil_lifecycle_id || !squeegee_number || !solder_paste_barcode || !side) {
        return res.status(400).json({ message: 'All session fields are mandatory.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if there is already an active session for this Work Order
        const activeCheck = await client.query(
            `SELECT id FROM smt_rework_sessions 
             WHERE work_order_id = $1 
               AND status IN ('Pending', 'In Progress', 'Paused') 
               AND is_deleted = false`,
            [work_order_id]
        );

        if (activeCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'An active Rework Session already exists for this Work Order. Please resume the existing session.' 
            });
        }

        // Check if a completed session already exists for this Work Order and side in this stage
        const completedCheck = await client.query(
            `SELECT id FROM smt_rework_sessions 
             WHERE work_order_id = $1 
               AND LOWER(side) = $2
               AND status = 'Completed'
               AND is_deleted = false`,
            [work_order_id, side.toLowerCase()]
        );
        if (completedCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Rework has already been Completed for Work Order ${work_order_id} on side ${side}.`
            });
        }

        // 1. Verify required setup information exists
        const printingRes = await client.query(
            `SELECT id FROM smt_printing_sessions 
             WHERE work_order_id = $1 
               AND LOWER(side) = $2 
               AND is_deleted = false 
             LIMIT 1`,
            [work_order_id, side.toLowerCase()]
        );
        if (printingRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `SMT Printing setup information not found for Work Order ${work_order_id} on side ${side}. Please start the SMT Printing stage setup first.`
            });
        }

        // 2. Verify there are eligible FAIL barcodes from Post AOI that have not been repaired yet
        const failCheck = await client.query(
            `SELECT i.serial_id, i.scanned_barcode, i.scanned_at FROM smt_inspections i
             JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
             WHERE i.work_order_id = $1
               AND LOWER(ps.side) = $2
               AND i.process_step = 'Post AOI'
               AND i.status = 'FAIL'
               AND ps.is_deleted = false
             ORDER BY i.scanned_at DESC`,
            [work_order_id, side.toLowerCase()]
        );

        let hasEligibleFail = false;
        for (const row of failCheck.rows) {
            const reworkCheck = await client.query(
                `SELECT ri.id FROM smt_inspections ri
                 JOIN smt_rework_sessions rs ON ri.rework_session_id = rs.id
                 WHERE ri.work_order_id = $1
                   AND LOWER(rs.side) = $2
                   AND (
                     (ri.serial_id IS NOT NULL AND ri.serial_id = $3)
                     OR (ri.scanned_barcode = $4)
                   )
                   AND ri.process_step = 'Rework'
                   AND ri.status = 'PASS'
                   AND ri.scanned_at > $5
                   AND rs.is_deleted = false
                 LIMIT 1`,
                [work_order_id, side.toLowerCase(), row.serial_id, row.scanned_barcode, row.scanned_at]
            );
            if (reworkCheck.rows.length === 0) {
                hasEligibleFail = true;
                break;
            }
        }

        if (!hasEligibleFail) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `There are no active failed barcodes from the SMT Post AOI stage requiring repair for Work Order ${work_order_id} on side ${side}.`
            });
        }

        // Check Work Order side and sequence
        const woRes = await client.query(
            `SELECT sides FROM smt_work_orders WHERE id = $1`,
            [work_order_id]
        );
        if (woRes.rows.length > 0) {
            const resolvedSide = await resolveWorkOrderSide(work_order_id, woRes.rows[0].sides);
            if (side.toLowerCase() !== resolvedSide.toLowerCase()) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: `Selected side ${side} does not match the resolved active side ${resolvedSide} for this Work Order.`
                });
            }
        }

        // Update smt_production_status of Work Order to 'In Progress' if it is 'Pending'
        await client.query(
            `UPDATE smt_work_orders 
             SET smt_production_status = 'In Progress' 
             WHERE id = $1 AND smt_production_status = 'Pending'`,
            [work_order_id]
        );

        const insertQuery = `
            INSERT INTO smt_rework_sessions (
                work_order_id, stencil_lifecycle_id, squeegee_number, solder_paste_barcode, side, status,
                created_by, created_by_name, updated_by, updated_by_name
            ) VALUES ($1, $2, $3, $4, $5, 'In Progress', $6, $7, $6, $7)
            RETURNING *
        `;
        const result = await client.query(insertQuery, [
            work_order_id, stencil_lifecycle_id, squeegee_number, solder_paste_barcode, side, operator.name, operator.name
        ]);
        const session = result.rows[0];

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                'SESSION_CREATED',
                'REWORK_SESSION',
                session.id,
                operator.name,
                `Started Rework session for Work Order ${work_order_id} on side ${side}.`
            ]
        );

        await client.query('COMMIT');
        return res.status(201).json(session);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error starting Rework session:', err);
        return res.status(500).json({ message: 'Internal server error while starting Rework session.' });
    } finally {
        client.release();
    }
};

const fetchReworkSessionStatsHelper = async (client: any, sessionId: string, workOrderId: string, side: string) => {
    // Target Quantity: total failed boards in Post AOI on this side
    const targetRes = await client.query(
        `WITH latest_post_aoi AS (
            SELECT DISTINCT ON (i.serial_id) 
                i.serial_id, i.status, i.scanned_at
            FROM smt_inspections i
            JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
            WHERE i.work_order_id = $1 AND ps.side = $2 AND i.process_step = 'Post AOI'
            ORDER BY i.serial_id, i.scanned_at DESC, i.id DESC
        )
        SELECT COUNT(*) AS count FROM latest_post_aoi WHERE status = 'FAIL'`,
        [workOrderId, side]
    );
    const workOrderQty = parseInt(targetRes.rows[0].count, 10) || 0;

    // Passed: unique serials with status PASS in this rework session
    const passedRes = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
         FROM smt_inspections 
         WHERE rework_session_id = $1 AND status = 'PASS'`,
        [sessionId]
    );
    const passed = parseInt(passedRes.rows[0].count, 10) || 0;

    // Failed: unique serials with status FAIL in this rework session
    const failedRes = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
         FROM smt_inspections 
         WHERE rework_session_id = $1 AND status = 'FAIL'`,
        [sessionId]
    );
    const failed = parseInt(failedRes.rows[0].count, 10) || 0;

    const processed = passed + failed;
    const pending = Math.max(0, workOrderQty - processed);

    const invalidRes = await client.query(
        `SELECT COUNT(id) AS count 
         FROM smt_inspections 
         WHERE rework_session_id = $1 AND status = 'INVALID'`,
        [sessionId]
    );
    const invalid = parseInt(invalidRes.rows[0].count, 10) || 0;

    const dupRes = await client.query(
        `SELECT duplicate_scan_count FROM smt_rework_sessions WHERE id = $1`,
        [sessionId]
    );
    const duplicate = dupRes.rows[0]?.duplicate_scan_count || 0;

    return {
        passed,
        failed,
        pending,
        invalid,
        duplicate,
        workOrderQuantity: workOrderQty
    };
};

/**
 * GET /api/smt/rework/sessions
 * Fetch Rework sessions.
 */
export const getReworkSessions = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;

    try {
        let countQuery = `
            SELECT COUNT(ps.id) 
            FROM smt_rework_sessions ps
            JOIN smt_work_orders wo ON ps.work_order_id = wo.id
            JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
            WHERE ps.is_deleted = false
        `;
        let selectQuery = `
            SELECT 
                ps.*,
                wo.po_id,
                wo.product_name,
                wo.product_description,
                wo.quantity AS work_order_quantity,
                wo.panel_quantity,
                wo.remark AS work_order_remarks,
                lc.stencil_name,
                sm.revision AS stencil_version,
                lc.balance_life_cycle AS remaining_life,
                lc.current_used_life_cycle AS current_life_count
            FROM smt_rework_sessions ps
            JOIN smt_work_orders wo ON ps.work_order_id = wo.id
            JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
            JOIN stencil_master sm ON lc.stencil_record_id = sm.id
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
            countQuery += ` AND (ps.work_order_id ILIKE $${filterCount} OR wo.product_name ILIKE $${filterCount} OR wo.po_id ILIKE $${filterCount})`;
            selectQuery += ` AND (ps.work_order_id ILIKE $${filterCount} OR wo.product_name ILIKE $${filterCount} OR wo.po_id ILIKE $${filterCount})`;
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
        logger.error('Error fetching Rework sessions:', err);
        return res.status(500).json({ message: 'Internal server error while fetching Rework sessions.' });
    }
};

/**
 * GET /api/smt/rework/sessions/:id
 * Get single Rework session details by ID.
 */
export const getSessionById = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const query = `
            SELECT 
                ps.*,
                wo.po_id,
                wo.product_name,
                wo.product_description,
                wo.quantity AS work_order_quantity,
                wo.panel_quantity,
                wo.remark AS work_order_remarks,
                lc.stencil_name,
                sm.revision AS stencil_version,
                lc.balance_life_cycle AS remaining_life,
                lc.current_used_life_cycle AS current_life_count
            FROM smt_rework_sessions ps
            JOIN smt_work_orders wo ON ps.work_order_id = wo.id
            JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
            JOIN stencil_master sm ON lc.stencil_record_id = sm.id
            WHERE ps.id = $1 AND ps.is_deleted = false
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error fetching Rework session by ID:', err);
        return res.status(500).json({ message: 'Internal server error while fetching Rework session.' });
    }
};

/**
 * PATCH /api/smt/rework/sessions/:id/status
 */
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

        // Check if session exists
        const checkRes = await client.query(
            `SELECT * FROM smt_rework_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        const oldSession = checkRes.rows[0];

        // Update status
        const updateQuery = `
            UPDATE smt_rework_sessions 
            SET status = $1, updated_by = $2, updated_by_name = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4 RETURNING *
        `;
        const updateRes = await client.query(updateQuery, [status, operator.name, operator.name, id]);
        const session = updateRes.rows[0];

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'SESSION_STATUS_CHANGED',
                'REWORK_SESSION',
                id,
                operator.name,
                `Changed Rework session status from ${oldSession.status} to ${status}.`,
                JSON.stringify({ status: oldSession.status }),
                JSON.stringify({ status })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json(session);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error updating Rework session status:', err);
        return res.status(500).json({ message: 'Internal server error while updating session status.' });
    } finally {
        client.release();
    }
};

/**
 * DELETE /api/smt/rework/sessions/:id
 */
export const deleteReworkSession = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    if (operator.role !== 'Super Admin') {
        return res.status(403).json({
            success: false,
            message: 'Only Super Admin is authorized to delete records.',
            error: 'Only Super Admin is authorized to delete records.'
        });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const checkRes = await client.query(
            `SELECT id FROM smt_rework_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Session not found.' });
        }

        await client.query(
            `UPDATE smt_rework_sessions 
             SET is_deleted = true, deleted_by = $1, deleted_by_name = $2, deleted_at = CURRENT_TIMESTAMP 
             WHERE id = $3`,
            [operator.name, operator.name, id]
        );

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'DELETE',
                'REWORK_SESSION',
                id,
                operator.name,
                `Deleted (soft-deleted) Rework Session ${id}.`,
                JSON.stringify({
                    userId: operator.id || operator.username,
                    userName: operator.name,
                    userRole: operator.role,
                    moduleName: 'Rework',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ message: 'Rework session soft-deleted successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error deleting Rework session:', err);
        return res.status(500).json({ message: 'Internal server error while deleting session.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/smt/rework/sessions/:id/scan
 * Validate and record barcode scan in Rework session.
 * Enforce:
 * 1. Barcode must have failed Post AOI on this side.
 * 2. Barcode must not have been already repaired in Rework since its latest Post AOI FAIL.
 */
export const validateAndRecordScan = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { barcode } = req.body;
    const operator = getSessionUser(req);

    if (!barcode || barcode.trim() === '') {
        return res.status(400).json({ message: 'Barcode is required.' });
    }

    const cleanBarcode = barcode.trim().toUpperCase();
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Fetch Session details
        const sessionRes = await client.query(
            `SELECT * FROM smt_rework_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        const session = sessionRes.rows[0];

        if (session.status !== 'In Progress') {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: `Scanning is only allowed in 'In Progress' sessions. Current session is '${session.status}'.` 
            });
        }

        // Validate barcode belongs to WO
        const serialRes = await client.query(
            `SELECT id, serial_number FROM smt_serial_numbers 
             WHERE serial_number = $1 AND work_order_id = $2`,
            [cleanBarcode, session.work_order_id]
        );

        if (serialRes.rows.length === 0) {
            // Save as INVALID inspection
            const insertInspection = `
                INSERT INTO smt_inspections (
                    serial_id, process_step, scanned_by, status, rework_reason, work_order_id, rework_session_id, scanned_barcode
                ) VALUES (NULL, 'Rework', $1, 'INVALID', 'Invalid Serial Number - does not belong to selected Work Order', $2, $3, $4)
                RETURNING *
            `;
            const insRes = await client.query(insertInspection, [
                operator.name, session.work_order_id, id, cleanBarcode
            ]);

            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    'INVALID_SCAN',
                    'REWORK_SESSION',
                    id,
                    operator.name,
                    `Invalid barcode scanned: ${cleanBarcode}`,
                    JSON.stringify(insRes.rows[0])
                ]
            );

            const stats = await fetchReworkSessionStatsHelper(client, id, session.work_order_id, session.side);
            await client.query('COMMIT');
            return res.status(200).json({
                success: true,
                isValid: false,
                isCompleted: false,
                sessionStatus: 'In Progress',
                message: 'Invalid Serial Number. This Serial Number does not belong to the selected Work Order.',
                statistics: stats
            });
        }

        const serial = serialRes.rows[0];

        // 1. Verify latest status in Post AOI is 'FAIL'
        const latestPostAoiRes = await client.query(
            `SELECT i.status, i.scanned_at FROM smt_inspections i
             JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
             WHERE i.work_order_id = $1
               AND ps.side = $2
               AND i.serial_id = $3
               AND i.process_step = 'Post AOI'
             ORDER BY i.scanned_at DESC, i.id DESC
             LIMIT 1`,
            [session.work_order_id, session.side, serial.id]
        );

        if (latestPostAoiRes.rows.length === 0 || latestPostAoiRes.rows[0].status !== 'FAIL') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'This barcode is not eligible for rework because it does not have a FAIL status in the Post AOI stage.'
            });
        }

        const failTime = latestPostAoiRes.rows[0].scanned_at;

        // 2. Check if a subsequent Rework PASS already exists (i.e. already repaired)
        const reworkCheck = await client.query(
            `SELECT ri.id FROM smt_inspections ri
             JOIN smt_rework_sessions rs ON ri.rework_session_id = rs.id
             WHERE ri.work_order_id = $1
               AND rs.side = $2
               AND ri.serial_id = $3
               AND ri.process_step = 'Rework'
               AND ri.status = 'PASS'
               AND ri.scanned_at > $4
             ORDER BY ri.scanned_at DESC, ri.id DESC
             LIMIT 1`,
            [session.work_order_id, session.side, serial.id, failTime]
        );

        if (reworkCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'This failed board has already been repaired in Rework.'
            });
        }

        // 3. Rework Repair Lifecycle: Require mandatory Repair Remark
        const { repairRemark } = req.body;
        if (!repairRemark || repairRemark.trim() === '') {
            await client.query('COMMIT');
            return res.status(200).json({
                needsRepairRemark: true,
                message: 'Barcode is eligible for Rework. Repair remark is required to complete repair.'
            });
        }

        // 4. Insert PASS inspection for Rework stage with repair remark
        const insertInspection = `
            INSERT INTO smt_inspections (
                serial_id, process_step, scanned_by, status, work_order_id, rework_session_id, scanned_barcode, repair_remark, repair_time
            ) VALUES ($1, 'Rework', $2, 'PASS', $3, $4, $5, $6, CURRENT_TIMESTAMP)
            RETURNING *
        `;
        const insRes = await client.query(insertInspection, [
            serial.id, operator.name, session.work_order_id, id, cleanBarcode, repairRemark.trim()
        ]);

        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'REPAIR_INSPECTION',
                'REWORK_SESSION',
                id,
                operator.name,
                `Rework PCB Barcode ${cleanBarcode} repaired (PASS) with remark: ${repairRemark.trim()}`,
                JSON.stringify(insRes.rows[0])
            ]
        );

        // Recalculate unique Passed scans in this Rework session
        const passRes = await client.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
             FROM smt_inspections 
             WHERE rework_session_id = $1 AND status = 'PASS'`,
            [id]
        );
        const passCount = parseInt(passRes.rows[0].count, 10);

        // Also fetch total processed count (same as passed in Rework)
        const processedCount = passCount;

        // Calculate Target Quantity = total failed boards in Post AOI on this side
        const targetRes = await client.query(
            `WITH latest_post_aoi AS (
                SELECT DISTINCT ON (i.serial_id) 
                    i.serial_id, i.status, i.scanned_at
                FROM smt_inspections i
                JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                WHERE i.work_order_id = $1 AND ps.side = $2 AND i.process_step = 'Post AOI'
                ORDER BY i.serial_id, i.scanned_at DESC, i.id DESC
            )
            SELECT COUNT(*) AS count FROM latest_post_aoi WHERE status = 'FAIL'`,
            [session.work_order_id, session.side]
        );
        const reworkTargetQty = parseInt(targetRes.rows[0].count, 10) || 0;

        let completed = false;
        if (reworkTargetQty > 0 && passCount >= reworkTargetQty) {
            completed = true;
            await client.query(
                `UPDATE smt_rework_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );

            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    'SESSION_COMPLETED',
                    'REWORK_SESSION',
                    id,
                    'System',
                    `Rework Session automatically completed. Passed Count (${passCount}) reached failed target count (${reworkTargetQty}).`
                ]
            );
        }

        const stats = await fetchReworkSessionStatsHelper(client, id, session.work_order_id, session.side);
        await client.query('COMMIT');
        return res.status(200).json({
            success: true,
            isValid: true,
            isRepair: false,
            isCompleted: completed,
            sessionStatus: completed ? 'Completed' : 'In Progress',
            statistics: stats
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error validating barcode scan:', err);
        return res.status(500).json({ message: 'Internal server error while processing barcode scan.' });
    } finally {
        client.release();
    }
};

/**
 * PUT /api/smt/rework/sessions/:id/scan/:scanId
 */
export const updateScanBarcode = async (req: Request, res: Response) => {
    const { id, scanId } = req.params;
    const { barcode } = req.body;
    const operator = getSessionUser(req);

    if (!barcode || barcode.trim() === '') {
        return res.status(400).json({ message: 'Barcode is required.' });
    }

    const cleanBarcode = barcode.trim().toUpperCase();
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check session
        const sessionRes = await client.query(
            `SELECT * FROM smt_rework_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Session not found.' });
        }
        const session = sessionRes.rows[0];

        if (session.status === 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Completed sessions are read-only.' });
        }

        // Check inspection record
        const oldRecordRes = await client.query(
            `SELECT * FROM smt_inspections WHERE id = $1 AND rework_session_id = $2 FOR UPDATE`,
            [scanId, id]
        );
        if (oldRecordRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Scan record not found.' });
        }
        const oldRecord = oldRecordRes.rows[0];

        // Validate barcode belongs to WO
        const serialRes = await client.query(
            `SELECT id FROM smt_serial_numbers WHERE work_order_id = $1 AND serial_number = $2`,
            [session.work_order_id, cleanBarcode]
        );
        if (serialRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'Invalid Serial Number. This Serial Number does not belong to the selected Work Order.' 
            });
        }
        const newSerial = serialRes.rows[0];

        // Check Post AOI FAIL status
        const postAoiCheck = await client.query(
            `SELECT i.status, i.scanned_at FROM smt_inspections i
             JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
             WHERE i.work_order_id = $1 
               AND ps.side = $2
               AND i.serial_id = $3
               AND i.process_step = 'Post AOI'
             ORDER BY i.scanned_at DESC, i.id DESC
             LIMIT 1`,
            [session.work_order_id, session.side, newSerial.id]
        );

        if (postAoiCheck.rows.length === 0 || postAoiCheck.rows[0].status !== 'FAIL') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'Selected barcode does not have a FAIL status in Post AOI stage.'
            });
        }

        // Validate new barcode is not a duplicate in this session (excluding current row)
        const duplicateCheck = await client.query(
            `SELECT id FROM smt_inspections 
             WHERE rework_session_id = $1 AND id <> $2
               AND (scanned_barcode = $3 OR (serial_id IS NOT NULL AND serial_id = $4))`,
            [id, scanId, cleanBarcode, newSerial.id]
        );
        if (duplicateCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'This barcode has already been scanned in this Rework Session.' 
            });
        }

        // Update record
        await client.query(
            `UPDATE smt_inspections 
             SET serial_id = $1,
                 scanned_barcode = $2,
                 status = 'PASS',
                 scanned_by = $3,
                 scanned_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [newSerial.id, cleanBarcode, operator.name, scanId]
        );

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'BARCODE_EDITED',
                'REWORK_SESSION',
                id,
                operator.name,
                `Edited scanned barcode from ${oldRecord.scanned_barcode} to ${cleanBarcode}.`,
                JSON.stringify(oldRecord),
                JSON.stringify({ serial_id: newSerial.id, scanned_barcode: cleanBarcode, status: 'PASS' })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ message: 'Scanned barcode updated successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error updating scan barcode:', err);
        return res.status(500).json({ message: 'Internal server error while updating scan barcode.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/smt/rework/sessions/:id/scan/:scanId/fail
 * Transition a scanned row from PASS to FAIL in Rework.
 */
export const failScanRow = async (req: Request, res: Response) => {
    const { id, scanId } = req.params;
    const { remark } = req.body;
    const operator = getSessionUser(req);

    if (!remark || remark.trim() === '') {
        return res.status(400).json({ message: 'Failure remark is mandatory to mark a PCB as failed.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check session
        const sessionRes = await client.query(
            `SELECT * FROM smt_rework_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        const session = sessionRes.rows[0];

        if (session.status === 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Completed sessions are read-only.' });
        }

        // Check inspection record
        const inspectionRes = await client.query(
            `SELECT * FROM smt_inspections WHERE id = $1 AND rework_session_id = $2 FOR UPDATE`,
            [scanId, id]
        );
        if (inspectionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Scanned record not found.' });
        }
        const oldRecord = inspectionRes.rows[0];

        if (oldRecord.status !== 'PASS') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Only successfully passed scans can be manually failed.' });
        }

        // Update status to FAIL and clear repair details
        await client.query(
            `UPDATE smt_inspections 
             SET status = 'FAIL',
                 rework_reason = $1,
                 scanned_by = $2,
                 scanned_at = CURRENT_TIMESTAMP,
                 repair_time = NULL,
                 repair_remark = NULL
             WHERE id = $3`,
            [remark.trim(), operator.name, scanId]
        );

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'FAIL_INSPECTION',
                'REWORK_SESSION',
                id,
                operator.name,
                `PCB barcode ${oldRecord.scanned_barcode} manually failed in Rework. Reason: ${remark.trim()}`,
                JSON.stringify({ status: 'PASS' }),
                JSON.stringify({ status: 'FAIL', rework_reason: remark.trim() })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ message: 'Scan result changed to FAIL successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error failing scan row:', err);
        return res.status(500).json({ message: 'Internal server error while failing scan record.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/smt/rework/sessions/:id/stats
 */
export const getSessionStatistics = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const sessionRes = await pool.query(
            `SELECT ps.*, wo.quantity AS work_order_quantity 
             FROM smt_rework_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        const session = sessionRes.rows[0];

        // Target Quantity: total failed boards in Post AOI on this side
        const targetRes = await pool.query(
            `WITH latest_post_aoi AS (
                SELECT DISTINCT ON (i.serial_id) 
                    i.serial_id, i.status, i.scanned_at
                FROM smt_inspections i
                JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                WHERE i.work_order_id = $1 AND ps.side = $2 AND i.process_step = 'Post AOI'
                ORDER BY i.serial_id, i.scanned_at DESC, i.id DESC
            )
            SELECT COUNT(*) AS count FROM latest_post_aoi WHERE status = 'FAIL'`,
            [session.work_order_id, session.side]
        );
        const reworkTargetQty = parseInt(targetRes.rows[0].count, 10) || 0;

        // Passed: unique serials with status PASS in this rework session
        const passedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
             FROM smt_inspections 
             WHERE rework_session_id = $1 AND status = 'PASS'`,
            [id]
        );
        const passed = parseInt(passedRes.rows[0].count);

        // Failed: unique serials with status FAIL in this rework session
        const failedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
             FROM smt_inspections 
             WHERE rework_session_id = $1 AND status = 'FAIL'`,
            [id]
        );
        const failed = parseInt(failedRes.rows[0].count);

        const processed = passed + failed;
        const pending = Math.max(0, reworkTargetQty - processed);

        // Invalid: total invalid scan attempts
        const invalidRes = await pool.query(
            `SELECT COUNT(id) AS count 
             FROM smt_inspections 
             WHERE rework_session_id = $1 AND status = 'INVALID'`,
            [id]
        );
        const invalid = parseInt(invalidRes.rows[0].count);

        // Fetch scanned barcodes list
        const scansListQuery = `
            SELECT 
                ins.id AS scan_id,
                ins.scanned_barcode AS barcode,
                ins.status AS result,
                ins.rework_reason AS remark,
                ins.scanned_by,
                ins.scanned_at,
                ins.repair_time,
                ins.repair_remark
            FROM smt_inspections ins
            WHERE ins.rework_session_id = $1
            ORDER BY ins.scanned_at DESC
        `;
        const scansListRes = await pool.query(scansListQuery, [id]);

        return res.status(200).json({
            workOrderQuantity: reworkTargetQty,
            processedQuantity: processed,
            passed,
            failed,
            pending,
            invalid,
            duplicate: session.duplicate_scan_count,
            sessionStatus: session.status,
            isCompleted: session.status === 'Completed',
            scans: scansListRes.rows
        });
    } catch (err: any) {
        logger.error('Error fetching session statistics:', err);
        return res.status(500).json({ message: 'Internal server error while fetching statistics.' });
    }
};

/**
 * GET /api/smt/rework/sessions/:id/export/excel
 */
export const exportReworkSessionExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        const sessionRes = await pool.query(
            `SELECT 
                ps.*,
                wo.product_name, wo.product_description, wo.po_id,
                wo.quantity AS work_order_quantity, wo.panel_quantity,
                wo.sides AS work_order_sides, wo.line_id, wo.remark AS work_order_remarks,
                lc.stencil_name, lc.qty_life_cycle, lc.balance_life_cycle, lc.current_used_life_cycle,
                lc.sides AS stencil_side,
                sm.job_number, sm.revision, sm.thickness_mills, sm.manufacturing_date
             FROM smt_rework_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
             JOIN stencil_master sm ON lc.stencil_record_id = sm.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        const session = sessionRes.rows[0];

        // Target Quantity: total failed boards in Post AOI on this side
        const targetRes = await pool.query(
            `WITH latest_post_aoi AS (
                SELECT DISTINCT ON (i.serial_id) 
                    i.serial_id, i.status, i.scanned_at
                FROM smt_inspections i
                JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                WHERE i.work_order_id = $1 AND ps.side = $2 AND i.process_step = 'Post AOI'
                ORDER BY i.serial_id, i.scanned_at DESC, i.id DESC
            )
            SELECT COUNT(*) AS count FROM latest_post_aoi WHERE status = 'FAIL'`,
            [session.work_order_id, session.side]
        );
        const reworkTargetQty = parseInt(targetRes.rows[0].count, 10) || 0;

        // Production counts
        const passedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count FROM smt_inspections WHERE rework_session_id = $1 AND status = 'PASS'`, [id]
        );
        const failedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count FROM smt_inspections WHERE rework_session_id = $1 AND status = 'FAIL'`, [id]
        );
        const passed = parseInt(passedRes.rows[0].count);
        const failed = parseInt(failedRes.rows[0].count);
        const pending = Math.max(0, reworkTargetQty - passed - failed);

        const invalidRes = await pool.query(
            `SELECT COUNT(id) AS count FROM smt_inspections WHERE rework_session_id = $1 AND status = 'INVALID'`, [id]
        );
        const invalid = parseInt(invalidRes.rows[0].count);

        // Scans list
        const scansRes = await pool.query(
            `SELECT scanned_barcode AS barcode, status AS result, rework_reason AS remark, scanned_by, scanned_at, repair_time, repair_remark
             FROM smt_inspections WHERE rework_session_id = $1 ORDER BY scanned_at ASC`,
            [id]
        );

        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description) VALUES ($1, $2, $3, $4, $5)`,
            ['EXPORT', 'REWORK_SESSION', id, operator.name, `Exported Rework session full report to Excel.`]
        );

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SFCS SMT System';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('Rework Report', {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
        });

        const NAVY:  ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        const BLUE:  ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        const TEAL:  ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        const INDIGO: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
        const PLUM:  ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        const GREEN: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
        const LIGHT_GRAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        const WHITE_FILL:  ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        const WHITE_FONT  = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' }, bold: true };
        const DARK_FONT   = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        const BOLD_DARK   = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' }, bold: true };

        const thinBorder: Partial<ExcelJS.Borders> = {
            top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
            right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
        };

        ws.columns = [
            { key: 'a', width: 30 },
            { key: 'b', width: 25 },
            { key: 'c', width: 25 },
            { key: 'd', width: 15 },
            { key: 'e', width: 30 },
            { key: 'f', width: 25 },
            { key: 'g', width: 30 }
        ];

        const addSectionHeader = (label: string, fill: ExcelJS.Fill, startRow: number) => {
            const row = ws.getRow(startRow);
            row.height = 22;
            const cell = ws.getCell(`A${startRow}`);
            cell.value = label;
            cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = fill;
            cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
            ws.mergeCells(`A${startRow}:G${startRow}`);
        };

        const addKVRow = (rowNum: number, label: string, value: any) => {
            const row = ws.getRow(rowNum);
            row.height = 18;
            ws.mergeCells(`A${rowNum}:B${rowNum}`);
            const lCell = ws.getCell(`A${rowNum}`);
            lCell.value = label;
            lCell.font = BOLD_DARK;
            lCell.fill = LIGHT_GRAY;
            lCell.border = thinBorder;
            lCell.alignment = { vertical: 'middle', indent: 1 };

            ws.mergeCells(`C${rowNum}:G${rowNum}`);
            const vCell = ws.getCell(`C${rowNum}`);
            vCell.value = (value !== null && value !== undefined && value !== '') ? String(value) : '-';
            vCell.font = DARK_FONT;
            vCell.fill = WHITE_FILL;
            vCell.border = thinBorder;
            vCell.alignment = { vertical: 'middle', indent: 1 };
        };

        const fmtDate = (d: any) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '-';
        const fmtDateOnly = (d: any) => d ? new Date(d).toLocaleDateString('en-IN') : '-';

        let r = 1;

        // TITLE BANNER
        ws.getRow(r).height = 38;
        const titleCell = ws.getCell(`A${r}`);
        titleCell.value = '🏭  SMT REWORK SESSION REPORT';
        titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = NAVY;
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:G${r}`);
        r++;

        ws.getRow(r).height = 18;
        const subCell = ws.getCell(`A${r}`);
        subCell.value = `Stage: Rework  |  Generated: ${fmtDate(new Date())}  |  Generated By: ${operator.name}`;
        subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FFCBD5E1' } };
        subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        subCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:G${r}`);
        r++;

        r++; // Spacer

        // SECTION 1: Work Order Details
        addSectionHeader('  1.  WORK ORDER DETAILS', BLUE, r); r++;
        addKVRow(r, 'Work Order Number', session.work_order_id); r++;
        addKVRow(r, 'PO Number', session.po_id); r++;
        addKVRow(r, 'Product Name', session.product_name); r++;
        addKVRow(r, 'Product Description', session.product_description); r++;
        addKVRow(r, 'Work Order Quantity', session.work_order_quantity); r++;
        addKVRow(r, 'Panel Quantity', session.panel_quantity); r++;
        addKVRow(r, 'Number of Sides', session.work_order_sides); r++;
        addKVRow(r, 'Line ID', session.line_id); r++;
        addKVRow(r, 'Work Order Remarks', session.work_order_remarks); r++;

        r++; // Spacer

        // SECTION 2: Stencil Details
        addSectionHeader('  2.  STENCIL DETAILS', TEAL, r); r++;
        addKVRow(r, 'Stencil / Model Name', session.stencil_name); r++;
        addKVRow(r, 'Job Number', session.job_number); r++;
        addKVRow(r, 'Revision', session.revision); r++;
        addKVRow(r, 'Thickness (mils)', session.thickness_mills); r++;
        addKVRow(r, 'Manufacturing Date', fmtDateOnly(session.manufacturing_date)); r++;
        addKVRow(r, 'Side', session.stencil_side); r++;
        addKVRow(r, 'Current Life Cycle Count', session.current_used_life_cycle); r++;
        addKVRow(r, 'Remaining Life Count', session.balance_life_cycle); r++;

        r++; // Spacer

        // SECTION 3: Session Details
        addSectionHeader('  3.  REWORK SESSION DETAILS', INDIGO, r); r++;
        addKVRow(r, 'Squeegee Number', session.squeegee_number); r++;
        addKVRow(r, 'Solder Paste Barcode', session.solder_paste_barcode); r++;
        addKVRow(r, 'PCB Side', session.side); r++;
        addKVRow(r, 'Rework Started By', session.created_by_name); r++;
        addKVRow(r, 'Rework Started Date & Time', fmtDate(session.created_at)); r++;
        addKVRow(r, 'Rework Status', session.status); r++;

        r++; // Spacer

        // SECTION 4: Production Summary
        const yieldPercent = (session.work_order_quantity && session.work_order_quantity > 0)
            ? ((passed / session.work_order_quantity) * 100).toFixed(2) + '%'
            : (reworkTargetQty && reworkTargetQty > 0)
                ? ((passed / reworkTargetQty) * 100).toFixed(2) + '%'
                : '0.00%';

        addSectionHeader('  4.  PRODUCTION SUMMARY', PLUM, r); r++;
        addKVRow(r, 'Rework Target Quantity', reworkTargetQty); r++;
        addKVRow(r, 'Repaired (Passed) Quantity', passed); r++;
        addKVRow(r, 'Yield (%)', yieldPercent); r++;
        addKVRow(r, 'Failed Quantity', failed); r++;
        addKVRow(r, 'Pending Rework Quantity', pending); r++;
        addKVRow(r, 'Invalid Scan Quantity', invalid); r++;
        addKVRow(r, 'Duplicate Scan Quantity', session.duplicate_scan_count); r++;

        r++; // Spacer

        // SECTION 5: Scan History Table
        addSectionHeader('  5.  REPAIR HISTORY', GREEN, r); r++;

        const headers = ['Barcode', 'Scanned By', 'Date & Time', 'Status', 'Failure Remark', 'Repair Time', 'Repair Remark'];
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

        scansRes.rows.forEach((scan, idx) => {
            const dataRow = ws.getRow(r);
            dataRow.height = 16;
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

            setCell('A', scan.barcode);
            setCell('B', scan.scanned_by);
            setCell('C', fmtDate(scan.scanned_at));

            const statusCell = ws.getCell(`D${r}`);
            statusCell.value = scan.result;
            statusCell.font = {
                name: 'Calibri', size: 10, bold: true,
                color: { argb: scan.result === 'PASS' ? 'FF166534' : scan.result === 'FAIL' ? 'FF991B1B' : 'FF92400E' }
            };
            statusCell.fill = {
                type: 'pattern', pattern: 'solid',
                fgColor: { argb: scan.result === 'PASS' ? 'FFDCFCE7' : scan.result === 'FAIL' ? 'FFFEE2E2' : 'FFFEF3C7' }
            };
            statusCell.border = thinBorder;
            statusCell.alignment = { vertical: 'middle', horizontal: 'center' };

            setCell('E', scan.remark);
            setCell('F', scan.repair_time ? fmtDate(scan.repair_time) : '-');
            setCell('G', scan.repair_remark);
            r++;
        });

        if (scansRes.rows.length === 0) {
            const emptyRow = ws.getRow(r);
            emptyRow.height = 20;
            const cell = ws.getCell(`A${r}`);
            cell.value = 'No repair records found for this session.';
            cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.mergeCells(`A${r}:G${r}`);
            r++;
        }

        r++;
        const footerCell = ws.getCell(`A${r}`);
        footerCell.value = `Report generated by SFCS SMT System  |  ${operator.name}  |  ${fmtDate(new Date())}`;
        footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
        ws.mergeCells(`A${r}:G${r}`);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Rework_Report_${session.work_order_id}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error('Error exporting session to Excel:', err);
        return res.status(500).json({ message: 'Internal server error while exporting Excel.' });
    }
};

/**
 * GET /api/smt/rework/sessions/:id/export/pdf-data
 */
export const exportReworkSessionPdfData = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        const sessionRes = await pool.query(
            `SELECT 
                ps.*,
                wo.product_name, wo.product_description, wo.po_id,
                wo.quantity AS work_order_quantity, wo.panel_quantity,
                wo.sides AS work_order_sides, wo.line_id, wo.remark AS work_order_remarks,
                lc.stencil_name, lc.qty_life_cycle, lc.balance_life_cycle, lc.current_used_life_cycle,
                lc.sides AS stencil_side,
                sm.job_number, sm.revision, sm.thickness_mills, sm.manufacturing_date
             FROM smt_rework_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
             JOIN stencil_master sm ON lc.stencil_record_id = sm.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        const session = sessionRes.rows[0];

        // Target Quantity: total failed boards in Post AOI on this side
        const targetRes = await pool.query(
            `WITH latest_post_aoi AS (
                SELECT DISTINCT ON (i.serial_id) 
                    i.serial_id, i.status, i.scanned_at
                FROM smt_inspections i
                JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                WHERE i.work_order_id = $1 AND ps.side = $2 AND i.process_step = 'Post AOI'
                ORDER BY i.serial_id, i.scanned_at DESC, i.id DESC
            )
            SELECT COUNT(*) AS count FROM latest_post_aoi WHERE status = 'FAIL'`,
            [session.work_order_id, session.side]
        );
        const reworkTargetQty = parseInt(targetRes.rows[0].count, 10) || 0;

        const passedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count FROM smt_inspections WHERE rework_session_id = $1 AND status = 'PASS'`, [id]
        );
        const failedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count FROM smt_inspections WHERE rework_session_id = $1 AND status = 'FAIL'`, [id]
        );
        const passed = parseInt(passedRes.rows[0].count);
        const failed = parseInt(failedRes.rows[0].count);
        const pending = Math.max(0, reworkTargetQty - passed - failed);

        const invalidRes = await pool.query(
            `SELECT COUNT(id) AS count FROM smt_inspections WHERE rework_session_id = $1 AND status = 'INVALID'`, [id]
        );
        const invalid = parseInt(invalidRes.rows[0].count);

        const scansRes = await pool.query(
            `SELECT scanned_barcode AS barcode, status AS result, rework_reason AS remark, scanned_by, scanned_at, repair_time, repair_remark
             FROM smt_inspections WHERE rework_session_id = $1 ORDER BY scanned_at ASC`,
            [id]
        );

        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description) VALUES ($1, $2, $3, $4, $5)`,
            ['EXPORT', 'REWORK_SESSION', id, operator.name, `Exported Rework session full report to PDF.`]
        );

        return res.status(200).json({
            generatedAt: new Date().toISOString(),
            generatedBy: operator.name,
            workOrder: {
                number: session.work_order_id,
                poNumber: session.po_id,
                productName: session.product_name,
                productDescription: session.product_description,
                quantity: session.work_order_quantity,
                panelQuantity: session.panel_quantity,
                sides: session.work_order_sides,
                lineId: session.line_id,
                remarks: session.work_order_remarks
            },
            stencil: {
                name: session.stencil_name,
                jobNumber: session.job_number,
                revision: session.revision,
                thickness: session.thickness_mills,
                manufacturingDate: session.manufacturing_date,
                side: session.stencil_side,
                currentLifeCycleCount: session.current_used_life_cycle,
                remainingLifeCount: session.balance_life_cycle
            },
            session: {
                squeegeeNumber: session.squeegee_number,
                solderPasteBarcode: session.solder_paste_barcode,
                pcbSide: session.side,
                startedBy: session.created_by_name,
                startedAt: session.created_at,
                status: session.status
            },
            production: {
                quantity: reworkTargetQty, // target quantity is failed boards
                passed,
                failed,
                pending,
                invalid,
                duplicate: session.duplicate_scan_count
            },
            scans: scansRes.rows
        });
    } catch (err: any) {
        logger.error('Error fetching PDF report data:', err);
        return res.status(500).json({ message: 'Internal server error while fetching PDF report data.' });
    }
};

/**
 * GET /api/smt/rework/work-orders/:woId/check-bottom
 */
export const checkBottomCompleted = async (req: Request, res: Response) => {
    const { woId } = req.params;
    try {
        const woRes = await pool.query('SELECT sides FROM smt_work_orders WHERE id = $1', [woId]);
        if (woRes.rows.length === 0) {
            return res.status(404).json({ message: 'Work Order not found.' });
        }
        const resolvedSide = await resolveWorkOrderSide(woId, woRes.rows[0].sides);
        return res.status(200).json({ completed: resolvedSide === 'Top' });
    } catch (err: any) {
        logger.error('Error checking bottom side completion:', err);
        return res.status(500).json({ message: 'Internal server error while checking bottom side completion.' });
    }
};

/**
 * GET /api/smt/rework/sessions/:id/post-aoi-failed
 * Fetch barcodes that failed Post AOI stage and need rework
 */
export const getPostAoiFailedBarcodes = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const sessionRes = await pool.query(
            `SELECT work_order_id, side FROM smt_rework_sessions WHERE id = $1 AND is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Rework session not found.' });
        }
        const session = sessionRes.rows[0];

        // Fetch barcodes whose latest status in Post AOI is 'FAIL'
        // and do not have a subsequent Rework PASS.
        const query = `
            WITH latest_post_aoi AS (
                SELECT DISTINCT ON (i.serial_id) 
                    i.serial_id,
                    COALESCE(sn.serial_number, i.scanned_barcode) AS barcode,
                    i.status,
                    i.scanned_by,
                    i.scanned_at
                FROM smt_inspections i
                LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
                WHERE i.work_order_id = $1
                  AND ps.side = $2
                  AND i.process_step = 'Post AOI'
                ORDER BY i.serial_id, i.scanned_at DESC, i.id DESC
            ),
            reworked AS (
                SELECT DISTINCT ON (ri.serial_id)
                    ri.serial_id,
                    ri.scanned_at AS rework_at
                FROM smt_inspections ri
                JOIN smt_rework_sessions rs ON ri.rework_session_id = rs.id
                WHERE ri.work_order_id = $1
                  AND rs.side = $2
                  AND ri.process_step = 'Rework'
                  AND ri.status = 'PASS'
                ORDER BY ri.serial_id, ri.scanned_at DESC
            )
            SELECT lpa.barcode, lpa.status, lpa.scanned_by, lpa.scanned_at
            FROM latest_post_aoi lpa
            LEFT JOIN reworked r ON lpa.serial_id = r.serial_id
            WHERE lpa.status = 'FAIL' AND (r.rework_at IS NULL OR r.rework_at < lpa.scanned_at)
            ORDER BY lpa.scanned_at DESC
        `;
        const result = await pool.query(query, [session.work_order_id, session.side]);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching post-aoi failed barcodes:', err);
        return res.status(500).json({ message: 'Internal server error while fetching post-aoi failed list.' });
    }
};

/**
 * GET /api/smt/rework/auto-populate-details/:woId
 * Fetch auto-populated details for Rework
 */
export const getAutoPopulateDetails = async (req: Request, res: Response) => {
    const { woId } = req.params;
    const sideOverride = req.query.side as string;
    try {
        const details = await getAutoPopulateDetailsHelper(woId, sideOverride, 'smt_rework_sessions');

        // Check if there are any eligible FAIL barcodes from Post AOI that have not been repaired yet
        const failCheck = await pool.query(
            `SELECT i.serial_id, i.scanned_barcode, i.scanned_at FROM smt_inspections i
             JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
             WHERE i.work_order_id = $1
               AND LOWER(ps.side) = $2
               AND i.process_step = 'Post AOI'
               AND i.status = 'FAIL'
             ORDER BY i.scanned_at DESC`,
            [woId, details.side.toLowerCase()]
        );

        let hasEligibleFail = false;
        for (const row of failCheck.rows) {
            const reworkCheck = await pool.query(
                `SELECT ri.id FROM smt_inspections ri
                 JOIN smt_rework_sessions rs ON ri.rework_session_id = rs.id
                 WHERE ri.work_order_id = $1
                   AND LOWER(rs.side) = $2
                   AND (
                     (ri.serial_id IS NOT NULL AND ri.serial_id = $3)
                     OR (ri.scanned_barcode = $4)
                   )
                   AND ri.process_step = 'Rework'
                   AND ri.status = 'PASS'
                   AND ri.scanned_at > $5
                 LIMIT 1`,
                [woId, details.side.toLowerCase(), row.serial_id, row.scanned_barcode, row.scanned_at]
            );
            if (reworkCheck.rows.length === 0) {
                hasEligibleFail = true;
                break;
            }
        }

        if (!hasEligibleFail) {
            return res.status(400).json({
                message: `There are no active failed barcodes from the SMT Post AOI stage requiring repair for Work Order ${woId} on side ${details.side}.`
            });
        }

        return res.status(200).json(details);
    } catch (err: any) {
        if (err.status) {
            return res.status(err.status).json({ message: err.message });
        }
        logger.error('Error in getAutoPopulateDetails for Rework:', err);
        return res.status(500).json({ message: 'Internal server error while fetching auto-populate details.' });
    }
};
