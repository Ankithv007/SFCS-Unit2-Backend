import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import * as ExcelJS from 'exceljs';
import { getAutoPopulateDetailsHelper, resolveWorkOrderSide, getEligibleWorkOrdersHelper } from '../utils/smtHelper';

const logger = createLogger('FgController');

// Helper to get session operator details
const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    const resolvedName = user?.employee_code || user?.email || user?.name || 'Unknown User';
    return {
        id: user?.id || user?.userId || null,
        name: resolvedName,
        username: resolvedName,
        role: user?.role || 'OPERATOR'
    };
};

/**
 * POST /api/smt/smt-fg/sessions
 * Start a new SMT FG Session.
 */
export const createFgSession = async (req: Request, res: Response) => {
    const { work_order_id, stencil_lifecycle_id, squeegee_front_number, squeegee_rear_number, solder_paste_barcode, side } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id || !stencil_lifecycle_id || !squeegee_front_number || !squeegee_rear_number || !solder_paste_barcode || !side) {
        return res.status(400).json({ message: 'All session fields are mandatory.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check if there is already an active session for this Work Order
        const activeCheck = await client.query(
            `SELECT id FROM smt_fg_sessions 
             WHERE work_order_id = $1 
               AND status IN ('Pending', 'In Progress', 'Paused') 
               AND is_deleted = false`,
            [work_order_id]
        );

        if (activeCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: 'An active SMT FG Session already exists for this Work Order. Please resume the existing session.'
            });
        }

        // Check stage-specific completed session validation
        const completedCheck = await client.query(
            `SELECT id FROM smt_fg_sessions 
             WHERE work_order_id = $1 
               AND LOWER(side) = $2
               AND status = 'Completed'
               AND is_deleted = false`,
            [work_order_id, side.toLowerCase()]
        );
        if (completedCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `SMT FG has already been Completed for Work Order ${work_order_id} on side ${side}.`
            });
        }

        // Verify there are eligible PASS barcodes from Post AOI
        const postAoiCheck = await client.query(
            `SELECT 1 FROM smt_inspections i
             JOIN smt_post_aoi_sessions pas ON i.post_aoi_session_id = pas.id
             WHERE i.work_order_id = $1 
               AND LOWER(pas.side) = $2
               AND i.process_step = 'Post AOI'
               AND i.status = 'PASS'
               AND pas.is_deleted = false
             LIMIT 1`,
            [work_order_id, side.toLowerCase()]
        );
        if (postAoiCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `There are no eligible PASS barcodes from the SMT Post AOI stage for Work Order ${work_order_id} on side ${side}.`
            });
        }

        // Centralized Side Resolution Logic Verification
        const woRes = await client.query(
            `SELECT sides FROM smt_work_orders WHERE id = $1`,
            [work_order_id]
        );
        if (woRes.rows.length > 0) {
            const woSides = (woRes.rows[0].sides || '').trim().toLowerCase();
            const isDoubleSided = woSides === 'top / bottom' || woSides.includes('/');
            if (isDoubleSided && side.toLowerCase() === 'bottom') {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: `SMT Finished Goods is not processed for the Bottom side of double-sided Work Orders. It is only processed on the Top side after the Bottom side is fully completed.`
                });
            }

            const resolvedSide = await resolveWorkOrderSide(work_order_id, woRes.rows[0].sides);
            if (side.toLowerCase() !== resolvedSide.toLowerCase()) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: `Selected side ${side} does not match resolved active side ${resolvedSide}.`
                });
            }
        }

        const insertQuery = `
            INSERT INTO smt_fg_sessions (
                work_order_id, stencil_lifecycle_id, squeegee_front_number, squeegee_rear_number, solder_paste_barcode, side, status,
                created_by, created_by_name, updated_by, updated_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, 'In Progress', $7, $8, $7, $8)
            RETURNING *
        `;
        const result = await client.query(insertQuery, [
            work_order_id, stencil_lifecycle_id, squeegee_front_number, squeegee_rear_number, solder_paste_barcode, side, operator.name, operator.name
        ]);
        const session = result.rows[0];

        // Update smt_production_status of Work Order to 'In Progress' if it is 'Pending'
        await client.query(
            `UPDATE smt_work_orders 
             SET smt_production_status = 'In Progress' 
             WHERE id = $1 AND smt_production_status = 'Pending'`,
            [work_order_id]
        );

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [
                'SESSION_CREATED',
                'SMT_FG_SESSION',
                session.id,
                operator.name,
                `Started SMT FG session for Work Order ${work_order_id} on side ${side}.`
            ]
        );

        await client.query('COMMIT');
        return res.status(201).json(session);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error starting SMT FG session:', err);
        return res.status(500).json({ message: 'Internal server error while starting SMT FG session.' });
    } finally {
        client.release();
    }
};

const fetchFgSessionStatsHelper = async (client: any, sessionId: string, workOrderQty: number) => {
    const passedRes = await client.query(
        `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
         FROM smt_inspections 
         WHERE fg_session_id = $1 AND status = 'PASS'`,
        [sessionId]
    );
    const passed = parseInt(passedRes.rows[0].count, 10) || 0;

    const failed = 0;
    const processed = passed + failed;
    const pending = Math.max(0, workOrderQty - passed);

    const invalidRes = await client.query(
        `SELECT COUNT(id) AS count 
         FROM smt_inspections 
         WHERE fg_session_id = $1 AND status = 'INVALID'`,
        [sessionId]
    );
    const invalid = parseInt(invalidRes.rows[0].count, 10) || 0;

    const dupRes = await client.query(
        `SELECT duplicate_scan_count FROM smt_fg_sessions WHERE id = $1`,
        [sessionId]
    );
    const duplicate = dupRes.rows[0]?.duplicate_scan_count || 0;

    return {
        passed,
        failed,
        pending,
        invalid,
        duplicate
    };
};

/**
 * GET /api/smt/smt-fg/sessions
 * Fetch SMT FG sessions.
 */
export const getFgSessions = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;

    try {
        let countQuery = `
            SELECT COUNT(ps.id) 
            FROM smt_fg_sessions ps
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
            FROM smt_fg_sessions ps
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
        logger.error('Error fetching SMT FG sessions:', err);
        return res.status(500).json({ message: 'Internal server error while fetching SMT FG sessions.' });
    }
};

/**
 * GET /api/smt/smt-fg/sessions/:id
 * Get single SMT FG session details by ID.
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
            FROM smt_fg_sessions ps
            JOIN smt_work_orders wo ON ps.work_order_id = wo.id
            JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
            JOIN stencil_master sm ON lc.stencil_record_id = sm.id
            WHERE ps.id = $1 AND ps.is_deleted = false
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'SMT FG session not found.' });
        }
        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error fetching SMT FG session by ID:', err);
        return res.status(500).json({ message: 'Internal server error while fetching SMT FG session.' });
    }
};

/**
 * PUT /api/smt/smt-fg/sessions/:id/status
 * Update session status (e.g., Completed, Paused).
 * Enforces:
 * 1. Only mark SMT FG session as Completed if EVERY generated serial has successfully passed SMT FG.
 * 2. Updates smt_production_status of Work Order to 'Completed' if it is the final side.
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
            `SELECT * FROM smt_fg_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'SMT FG session not found.' });
        }
        const oldSession = checkRes.rows[0];

        // Fetch Work Order sides
        const woRes = await client.query(
            `SELECT sides FROM smt_work_orders WHERE id = $1`,
            [oldSession.work_order_id]
        );
        const sides = woRes.rows[0]?.sides || '';
        const isDoubleSided = sides.trim().toLowerCase() === 'top / bottom' || sides.includes('/');

        if (status === 'Completed') {
            // Retrieve all generated serials
            const serialsRes = await client.query(
                `SELECT id, serial_number FROM smt_serial_numbers WHERE work_order_id = $1`,
                [oldSession.work_order_id]
            );
            const serialIds = serialsRes.rows.map(r => r.id);
            if (serialIds.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ message: 'No serial numbers have been generated for this Work Order.' });
            }

            // Fetch the latest SMT FG inspection status for each serial on this side
            const latestFgRes = await client.query(
                `SELECT DISTINCT ON (i.serial_id) 
                     i.serial_id, i.status
                 FROM smt_inspections i
                 JOIN smt_fg_sessions s ON i.fg_session_id = s.id
                 WHERE i.work_order_id = $1 
                   AND i.process_step = 'SMT FG'
                   AND LOWER(s.side) = $2
                   AND s.is_deleted = false
                 ORDER BY i.serial_id, i.scanned_at DESC, i.id DESC`,
                [oldSession.work_order_id, oldSession.side.toLowerCase()]
            );

            const latestStatuses = new Map<number, string>();
            latestFgRes.rows.forEach(r => {
                latestStatuses.set(r.serial_id, r.status);
            });

            let allPassed = true;
            for (const serialId of serialIds) {
                const sStatus = latestStatuses.get(serialId);
                if (sStatus !== 'PASS') {
                    allPassed = false;
                    break;
                }
            }

            if (!allPassed) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    message: 'Cannot complete SMT FG session: not all serial numbers for this side have successfully passed Finished Goods release. Please ensure all barcodes are scanned and pass before completing.'
                });
            }
        }

        // Update status
        const updateQuery = `
            UPDATE smt_fg_sessions 
            SET status = $1, updated_by = $2, updated_by_name = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4 RETURNING *
        `;
        const updateRes = await client.query(updateQuery, [status, operator.name, operator.name, id]);
        const session = updateRes.rows[0];

        // SMT Production Status Logic
        if (status === 'Completed') {
            const isFinal = !isDoubleSided || session.side.toLowerCase() === 'top';
            if (isFinal) {
                await client.query(
                    `UPDATE smt_work_orders SET smt_production_status = 'Completed' WHERE id = $1`,
                    [session.work_order_id]
                );
            }
        } else if (oldSession.status === 'Completed') {
            // Reverted from Completed
            await client.query(
                `UPDATE smt_work_orders SET smt_production_status = 'In Progress' WHERE id = $1`,
                [session.work_order_id]
            );
        }

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'SESSION_STATUS_CHANGED',
                'SMT_FG_SESSION',
                id,
                operator.name,
                `Changed SMT FG session status from ${oldSession.status} to ${status}.`,
                JSON.stringify({ status: oldSession.status }),
                JSON.stringify({ status })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json(session);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error updating SMT FG session status:', err);
        return res.status(500).json({ message: 'Internal server error while updating session status.' });
    } finally {
        client.release();
    }
};

/**
 * DELETE /api/smt/smt-fg/sessions/:id
 */
export const deleteSession = async (req: Request, res: Response) => {
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
            `SELECT * FROM smt_fg_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (checkRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Session not found.' });
        }
        const session = checkRes.rows[0];

        // Soft delete session
        await client.query(
            `UPDATE smt_fg_sessions 
             SET is_deleted = true, deleted_by = $1, deleted_by_name = $2, deleted_at = CURRENT_TIMESTAMP 
             WHERE id = $3`,
            [operator.name, operator.name, id]
        );

        // Revert production status if it was completed
        if (session.status === 'Completed') {
            await client.query(
                `UPDATE smt_work_orders SET smt_production_status = 'In Progress' WHERE id = $1`,
                [session.work_order_id]
            );
        }

        // Audit Log
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'DELETE',
                'SMT_FG_SESSION',
                id,
                operator.name,
                `Deleted SMT FG session for Work Order ${session.work_order_id} on side ${session.side}.`,
                JSON.stringify({
                    userId: operator.id || operator.username,
                    userName: operator.name,
                    userRole: operator.role,
                    moduleName: 'SMT FG',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ message: 'Session deleted successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error deleting SMT FG session:', err);
        return res.status(500).json({ message: 'Internal server error while deleting session.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/smt/smt-fg/sessions/:id/scan
 * Validate and record barcode scan in SMT FG session.
 * Enforce:
 * 1. Barcode must have passed Post AOI stage on this side.
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
            `SELECT * FROM smt_fg_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'SMT FG session not found.' });
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
                    serial_id, process_step, scanned_by, status, rework_reason, work_order_id, fg_session_id, scanned_barcode
                ) VALUES (NULL, 'SMT FG', $1, 'INVALID', 'Invalid Serial Number - does not belong to selected Work Order', $2, $3, $4)
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
                    'SMT_FG_SESSION',
                    id,
                    operator.name,
                    `Invalid barcode scanned in SMT FG: ${cleanBarcode}`,
                    JSON.stringify(insRes.rows[0])
                ]
            );

            // Get Work Order Quantity
            const woResQty = await client.query(`SELECT quantity FROM smt_work_orders WHERE id = $1`, [session.work_order_id]);
            const workOrderQty = woResQty.rows[0]?.quantity || 0;
            const stats = await fetchFgSessionStatsHelper(client, id, workOrderQty);
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

        // 1. Validate barcode's latest status in Post AOI is PASS on this side
        const latestPostAoiRes = await client.query(
            `SELECT i.status FROM smt_inspections i
             JOIN smt_post_aoi_sessions ps ON i.post_aoi_session_id = ps.id
             WHERE i.work_order_id = $1
               AND ps.side = $2
               AND i.serial_id = $3
               AND i.process_step = 'Post AOI'
             ORDER BY i.scanned_at DESC, i.id DESC
             LIMIT 1`,
            [session.work_order_id, session.side, serial.id]
        );

        if (latestPostAoiRes.rows.length === 0 || latestPostAoiRes.rows[0].status !== 'PASS') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Barcode has not passed Post AOI stage on side ${session.side}. It must pass Post AOI before SMT FG release.`
            });
        }

        // 2. Check duplicate scan in the current session (if it is already PASS)
        const duplicateCheck = await client.query(
            `SELECT id FROM smt_inspections 
             WHERE fg_session_id = $1 
               AND serial_id = $2 
               AND status = 'PASS'`,
            [id, serial.id]
        );

        if (duplicateCheck.rows.length > 0) {
            // Increment duplicate count
            await client.query(
                `UPDATE smt_fg_sessions SET duplicate_scan_count = duplicate_scan_count + 1 WHERE id = $1`,
                [id]
            );

            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    'DUPLICATE_SCAN',
                    'SMT_FG_SESSION',
                    id,
                    operator.name,
                    `Duplicate scan attempt blocked in SMT FG for barcode: ${cleanBarcode}`
                ]
            );

            // Get Work Order Quantity
            const woResQty = await client.query(`SELECT quantity FROM smt_work_orders WHERE id = $1`, [session.work_order_id]);
            const workOrderQty = woResQty.rows[0]?.quantity || 0;
            const stats = await fetchFgSessionStatsHelper(client, id, workOrderQty);
            await client.query('COMMIT');
            return res.status(409).json({
                success: false,
                isValid: true,
                isCompleted: false,
                sessionStatus: 'In Progress',
                message: 'This barcode has already been scanned in this SMT FG Session.',
                statistics: stats
            });
        }

        // 3. Insert PASS inspection for SMT FG
        const insertInspection = `
            INSERT INTO smt_inspections (
                serial_id, process_step, scanned_by, status, work_order_id, fg_session_id, scanned_barcode
            ) VALUES ($1, 'SMT FG', $2, 'PASS', $3, $4, $5)
            RETURNING *
        `;
        const insRes = await client.query(insertInspection, [
            serial.id, operator.name, session.work_order_id, id, cleanBarcode
        ]);

        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'PASS_INSPECTION',
                'SMT_FG_SESSION',
                id,
                operator.name,
                `Recorded SMT FG PASS inspection for barcode: ${cleanBarcode}`,
                JSON.stringify(insRes.rows[0])
            ]
        );

        // Get Work Order Quantity
        const woResQty = await client.query(`SELECT quantity FROM smt_work_orders WHERE id = $1`, [session.work_order_id]);
        const workOrderQty = woResQty.rows[0]?.quantity || 0;

        // Recalculate unique Passed scans in this SMT FG session
        const passRes = await client.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
             FROM smt_inspections 
             WHERE fg_session_id = $1 AND status = 'PASS'`,
            [id]
        );
        const passCount = parseInt(passRes.rows[0].count, 10);

        let completed = false;
        if (passCount >= workOrderQty) {
            completed = true;
            await client.query(
                `UPDATE smt_fg_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );

            // Fetch Work Order sides
            const woResSides = await client.query(
                `SELECT sides FROM smt_work_orders WHERE id = $1`,
                [session.work_order_id]
            );
            const sides = woResSides.rows[0]?.sides || '';
            const isDoubleSided = sides.trim().toLowerCase() === 'top / bottom' || sides.includes('/');
            const isFinal = !isDoubleSided || session.side.toLowerCase() === 'top';

            if (isFinal) {
                await client.query(
                    `UPDATE smt_work_orders SET smt_production_status = 'Completed' WHERE id = $1`,
                    [session.work_order_id]
                );
            }

            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    'SESSION_COMPLETED',
                    'SMT_FG_SESSION',
                    id,
                    'System',
                    `SMT FG Session automatically completed. Passed Count (${passCount}) reached Work Order quantity (${workOrderQty}).`
                ]
            );
        }

        const stats = await fetchFgSessionStatsHelper(client, id, workOrderQty);
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
        logger.error('Error scanning barcode in SMT FG:', err);
        return res.status(500).json({ message: 'Internal server error while scanning barcode.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/smt/smt-fg/sessions/:id/stats
 */
export const getSessionStatistics = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const sessionRes = await pool.query(
            `SELECT ps.*, wo.quantity AS work_order_quantity 
             FROM smt_fg_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'SMT FG session not found.' });
        }
        const session = sessionRes.rows[0];
        const workOrderQty = session.work_order_quantity;

        // Passed: unique serials with status PASS in this session
        const passedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
             FROM smt_inspections 
             WHERE fg_session_id = $1 AND status = 'PASS'`,
            [id]
        );
        const passed = parseInt(passedRes.rows[0].count);

        // FG has no failure mode but tracks invalid scan attempts
        const failed = 0;
        const processed = passed + failed;
        const pending = Math.max(0, workOrderQty - passed);

        const invalidRes = await pool.query(
            `SELECT COUNT(id) AS count 
             FROM smt_inspections 
             WHERE fg_session_id = $1 AND status = 'INVALID'`,
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
                ins.scanned_at
            FROM smt_inspections ins
            WHERE ins.fg_session_id = $1
            ORDER BY ins.scanned_at DESC
        `;
        const scansListRes = await pool.query(scansListQuery, [id]);

        return res.status(200).json({
            workOrderQuantity: workOrderQty,
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
        logger.error('Error fetching SMT FG session statistics:', err);
        return res.status(500).json({ message: 'Internal server error while fetching statistics.' });
    }
};

/**
 * GET /api/smt/smt-fg/sessions/:id/export/excel
 */
export const exportFgSessionExcel = async (req: Request, res: Response) => {
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
             FROM smt_fg_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
             JOIN stencil_master sm ON lc.stencil_record_id = sm.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'SMT FG session not found.' });
        }
        const session = sessionRes.rows[0];

        // Production counts
        const passedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count FROM smt_inspections WHERE fg_session_id = $1 AND status = 'PASS'`, [id]
        );
        const passed = parseInt(passedRes.rows[0].count);
        const failed = 0;
        const pending = Math.max(0, (session.work_order_quantity || 0) - passed);

        const invalidRes = await pool.query(
            `SELECT COUNT(id) AS count FROM smt_inspections WHERE fg_session_id = $1 AND status = 'INVALID'`, [id]
        );
        const invalid = parseInt(invalidRes.rows[0].count);

        // Scans list
        const scansRes = await pool.query(
            `SELECT scanned_barcode AS barcode, status AS result, rework_reason AS remark, scanned_by, scanned_at
             FROM smt_inspections WHERE fg_session_id = $1 ORDER BY scanned_at ASC`,
            [id]
        );

        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description) VALUES ($1, $2, $3, $4, $5)`,
            ['EXPORT', 'SMT_FG_SESSION', id, operator.name, `Exported SMT FG session report to Excel.`]
        );

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SFCS SMT System';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('SMT FG Report', {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
        });

        const NAVY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
        const BLUE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
        const TEAL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        const INDIGO: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4338CA' } };
        const PLUM: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
        const GREEN: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
        const LIGHT_GRAY: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        const WHITE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

        const WHITE_FONT = { name: 'Calibri', size: 11, color: { argb: 'FFFFFFFF' }, bold: true };
        const DARK_FONT = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
        const BOLD_DARK = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' }, bold: true };

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
            const lCell = ws.getCell(`A${rowNum}`);
            lCell.value = label;
            lCell.font = BOLD_DARK;
            lCell.fill = LIGHT_GRAY;
            lCell.border = thinBorder;
            lCell.alignment = { vertical: 'middle', indent: 1 };
            ws.mergeCells(`A${rowNum}:B${rowNum}`);

            const vCell = ws.getCell(`C${rowNum}`);
            vCell.value = value ?? '-';
            vCell.font = DARK_FONT;
            vCell.fill = WHITE_FILL;
            vCell.border = thinBorder;
            vCell.alignment = { vertical: 'middle', indent: 1 };
            ws.mergeCells(`C${rowNum}:G${rowNum}`);
        };

        const fmtDate = (d: any) => d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) : '-';
        const fmtDateOnly = (d: any) => d ? new Date(d).toLocaleDateString('en-IN') : '-';

        let r = 1;

        // TITLE BANNER
        ws.getRow(r).height = 38;
        const titleCell = ws.getCell(`A${r}`);
        titleCell.value = '🏭  SMT FINISHED GOODS (FG) REPORT';
        titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = NAVY;
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:G${r}`);
        r++;

        ws.getRow(r).height = 18;
        const subCell = ws.getCell(`A${r}`);
        subCell.value = `Stage: Finished Goods (FG)  |  Generated: ${fmtDate(new Date())}  |  Generated By: ${operator.name}`;
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
        addSectionHeader('  3.  SMT FG SESSION DETAILS', INDIGO, r); r++;
        addKVRow(r, 'Squeegee Front Number', session.squeegee_front_number); r++;
        addKVRow(r, 'Squeegee Rear Number', session.squeegee_rear_number); r++;
        addKVRow(r, 'Solder Paste Barcode', session.solder_paste_barcode); r++;
        addKVRow(r, 'PCB Side', session.side); r++;
        addKVRow(r, 'SMT FG Released By', session.created_by_name); r++;
        addKVRow(r, 'SMT FG Started Date & Time', fmtDate(session.created_at)); r++;
        addKVRow(r, 'SMT FG Status', session.status); r++;

        r++; // Spacer

        // SECTION 4: Production Summary
        addSectionHeader('  4.  PRODUCTION SUMMARY', PLUM, r); r++;
        addKVRow(r, 'Work Order Quantity', session.work_order_quantity); r++;
        addKVRow(r, 'Passed Quantity', passed); r++;
        addKVRow(r, 'Failed Quantity', failed); r++;
        addKVRow(r, 'Pending Quantity', pending); r++;
        addKVRow(r, 'Invalid Scan Quantity', invalid); r++;
        addKVRow(r, 'Duplicate Scan Quantity', session.duplicate_scan_count); r++;

        r++; // Spacer

        // SECTION 5: Scan History Table
        addSectionHeader('  5.  SCAN HISTORY', GREEN, r); r++;

        const headers = ['Barcode', 'Released By', 'Date & Time', 'Status', 'Remarks'];
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

        scansRes.rows.forEach(row => {
            const curRow = ws.getRow(r);
            curRow.height = 18;
            const vals = [
                row.barcode,
                row.scanned_by,
                fmtDate(row.scanned_at),
                row.result,
                row.remark ?? ''
            ];
            vals.forEach((val, colIdx) => {
                const col = String.fromCharCode(65 + colIdx);
                const cell = ws.getCell(`${col}${r}`);
                cell.value = val;
                cell.font = DARK_FONT;
                cell.border = thinBorder;
                cell.alignment = { vertical: 'middle', horizontal: colIdx === 2 ? 'center' : 'left', indent: colIdx === 2 ? 0 : 1 };
            });
            r++;
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=SMT_FG_Report_${session.work_order_id}_${session.side}.xlsx`);

        await workbook.xlsx.write(res);
        return res.end();
    } catch (err: any) {
        logger.error('Error exporting SMT FG session to Excel:', err);
        return res.status(500).json({ message: 'Internal server error while exporting SMT FG session report.' });
    }
};

/**
 * GET /api/smt/smt-fg/sessions/:id/post-aoi-passed
 * Fetch barcodes that passed Post AOI stage for this session's work order & side
 */
export const getPostAoiPassedBarcodes = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const sessionRes = await pool.query(
            `SELECT work_order_id, side FROM smt_fg_sessions WHERE id = $1 AND is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'SMT FG session not found.' });
        }
        const session = sessionRes.rows[0];

        const query = `
            WITH latest_post_aoi AS (
                SELECT DISTINCT ON (COALESCE(i.serial_id, 0), COALESCE(i.scanned_barcode, '')) 
                    i.id,
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
                ORDER BY COALESCE(i.serial_id, 0), COALESCE(i.scanned_barcode, ''), i.scanned_at DESC, i.id DESC
            )
            SELECT barcode, status, scanned_by, scanned_at 
            FROM latest_post_aoi 
            WHERE status = 'PASS'
            ORDER BY scanned_at DESC
        `;
        const result = await pool.query(query, [session.work_order_id, session.side]);
        return res.status(200).json(result.rows);
    } catch (err: any) {
        logger.error('Error fetching post-aoi passed barcodes:', err);
        return res.status(500).json({ message: 'Internal server error while fetching post-aoi passed list.' });
    }
};

/**
 * GET /api/smt/smt-fg/auto-populate-details/:woId
 * Fetch auto-populated details for SMT FG
 */
export const getAutoPopulateDetails = async (req: Request, res: Response) => {
    const { woId } = req.params;
    const sideOverride = req.query.side as string;

    try {
        const details = await getAutoPopulateDetailsHelper(woId, sideOverride, 'smt_fg_sessions');
        return res.status(200).json(details);
    } catch (err: any) {
        logger.error('Error fetching SMT FG details:', err);
        return res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
    }
};

/**
 * GET /api/smt/smt-fg/work-orders/:woId/check-bottom
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
 * GET /api/smt/smt-fg/eligible-wos
 */
export const getEligibleWorkOrders = async (req: Request, res: Response) => {
    try {
        const rows = await getEligibleWorkOrdersHelper('SMT FG');
        return res.status(200).json(rows);
    } catch (err: any) {
        logger.error('Error fetching eligible work orders:', err);
        return res.status(500).json({ message: 'Internal server error while fetching eligible work orders.' });
    }
};

/**
 * GET /api/smt/smt-fg/stencil-details/:woId
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
        const result = await pool.query(query, params);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Stencil details not found for this Work Order.' });
        }
        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error fetching stencil details:', err);
        return res.status(500).json({ message: 'Internal server error while fetching stencil details.' });
    }
};
