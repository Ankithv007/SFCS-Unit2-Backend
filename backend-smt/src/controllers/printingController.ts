import { Request, Response } from 'express';
import pool from '../config/db';
import { createLogger } from '../utils/logger';
import * as ExcelJS from 'exceljs';
import { resolveWorkOrderSide, getEligibleWorkOrdersHelper, isBarcodeBottomCompleted, hasAnyBarcodeBottomCompleted, ensureStencilLifecycleId } from '../utils/smtHelper';
import { notifySmtDashboardUpdate } from '../utils/dashboardEmitter';

const logger = createLogger('PrintingController');

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
 * GET /api/smt/printing/eligible-wos
 * Fetch all work orders eligible for printing.
 */
export const getEligibleWorkOrders = async (req: Request, res: Response) => {
    try {
        const rows = await getEligibleWorkOrdersHelper('Printing');
        return res.status(200).json(rows);
    } catch (err: any) {
        logger.error('Error fetching eligible work orders:', err);
        return res.status(500).json({ message: 'Internal server error while fetching eligible work orders.' });
    }
};

/**
 * GET /api/smt/printing/stencil-details/:woId
 * Fetch active stencil details associated with a Work Order.
 */
export const getStencilDetailsForWo = async (req: Request, res: Response) => {
    const { woId } = req.params;
    const side = req.query.side as string; // 'Top' or 'Bottom'
    try {
        // Check smt_stencil_lifecycle for active records tied to this work_order_id
        let queryLc = `
            SELECT 
                lc.id AS stencil_lifecycle_id,
                lc.stencil_record_id,
                COALESCE(lc.stencil_name, srl.stencil_name, srl.job_number, 'Stencil') AS stencil_name,
                srl.revision AS stencil_version,
                srl.status AS stencil_status,
                srl.job_number,
                srl.thickness_mills,
                lc.qty_life_cycle,
                lc.balance_life_cycle AS remaining_life,
                lc.current_used_life_cycle AS current_life_count,
                lc.sides AS stencil_side,
                srl.remarks AS stencil_remarks,
                srl.manufacturing_date AS stencil_manufacturing_date,
                NULL AS last_cleaning_date,
                NULL AS last_inspection_date
            FROM smt_stencil_lifecycle lc
            LEFT JOIN stencil_rack_locations srl ON lc.stencil_record_id = srl.id
            WHERE lc.work_order_id = $1
              AND lc.is_deleted = false
        `;
        const paramsLc: any[] = [woId];
        if (side) {
            queryLc += ` AND (LOWER(lc.sides) = $2 OR LOWER(lc.sides) LIKE '%' || $2 || '%' OR LOWER(lc.sides) IN ('top/bottom', 'top / bottom', 'both'))`;
            paramsLc.push(side.toLowerCase().trim());
        }
        queryLc += ` ORDER BY lc.created_at DESC LIMIT 1`;

        let result = await pool.query(queryLc, paramsLc);

        if (result.rows.length === 0) {
            // Also check if any lifecycle record exists for this WO regardless of side format
            const fallbackCheck = await pool.query(
                `SELECT 
                    lc.id AS stencil_lifecycle_id,
                    lc.stencil_record_id,
                    COALESCE(lc.stencil_name, srl.stencil_name, srl.job_number, 'Stencil') AS stencil_name,
                    srl.revision AS stencil_version,
                    srl.status AS stencil_status,
                    srl.job_number,
                    srl.thickness_mills,
                    lc.qty_life_cycle,
                    lc.balance_life_cycle AS remaining_life,
                    lc.current_used_life_cycle AS current_life_count,
                    lc.sides AS stencil_side,
                    srl.remarks AS stencil_remarks,
                    srl.manufacturing_date AS stencil_manufacturing_date,
                    NULL AS last_cleaning_date,
                    NULL AS last_inspection_date
                FROM smt_stencil_lifecycle lc
                LEFT JOIN stencil_rack_locations srl ON lc.stencil_record_id = srl.id
                WHERE lc.work_order_id = $1
                  AND lc.is_deleted = false
                ORDER BY lc.created_at DESC LIMIT 1`,
                [woId]
            );
            if (fallbackCheck.rows.length > 0) {
                result = fallbackCheck;
            }
        }

        if (result.rows.length === 0) {
            return res.status(404).json({
                message: 'No active stencil lifecycle record found for this Work Order. Please assign a stencil in Stencil Life Cycle Management first.',
                code: 'STENCIL_NOT_ASSIGNED'
            });
        }
        const row = result.rows[0];
        row.stencil_lifecycle_id = await ensureStencilLifecycleId(pool, row.stencil_lifecycle_id, woId, side || row.stencil_side || 'Top');
        return res.status(200).json(row);
    } catch (err: any) {
        logger.error('Error fetching stencil details:', err);
        return res.status(500).json({ message: 'Internal server error while fetching stencil details.' });
    }
};

/**
 * POST /api/smt/printing/sessions
 * Start a new Printing Session.
 */
export const createPrintingSession = async (req: Request, res: Response) => {
    const { work_order_id, stencil_lifecycle_id, squeegee_front_number, squeegee_rear_number, solder_paste_barcode, side } = req.body;
    const operator = getSessionUser(req);

    if (!work_order_id || !stencil_lifecycle_id || !squeegee_front_number || !squeegee_rear_number || !solder_paste_barcode || !side) {
        return res.status(400).json({ message: 'All session fields are mandatory.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const validStencilLifecycleId = await ensureStencilLifecycleId(
            client,
            stencil_lifecycle_id,
            work_order_id,
            side,
            operator.name
        );

        // Check if there is already an active session for this Work Order and side
        const activeCheck = await client.query(
            `SELECT * FROM smt_printing_sessions 
             WHERE work_order_id = $1 
               AND LOWER(side) = $2
               AND status IN ('Pending', 'In Progress', 'Paused') 
               AND is_deleted = false
             ORDER BY created_at DESC
             LIMIT 1`,
            [work_order_id, side.toLowerCase()]
        );

        if (activeCheck.rows.length > 0) {
            const existingSession = activeCheck.rows[0];
            if (existingSession.status !== 'In Progress') {
                await client.query(
                    `UPDATE smt_printing_sessions SET status = 'In Progress', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [existingSession.id]
                );
                existingSession.status = 'In Progress';
            }
            await client.query('COMMIT');
            return res.status(200).json(existingSession);
        }

        // Check if a completed session already exists for this Work Order and side in this stage
        const completedCheck = await client.query(
            `SELECT id FROM smt_printing_sessions 
             WHERE work_order_id = $1 
               AND LOWER(side) = $2
               AND status = 'Completed'
               AND is_deleted = false`,
            [work_order_id, side.toLowerCase()]
        );
        if (completedCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Printing has already been Completed for Work Order ${work_order_id} on side ${side}.`
            });
        }

        // Check Work Order side and printing sequence
        const woRes = await client.query(
            `SELECT sides, has_smt FROM smt_work_orders WHERE id = $1`,
            [work_order_id]
        );
        if (woRes.rows.length === 0 || woRes.rows[0].has_smt === false) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Work Order ${work_order_id} is not configured for SMT processing.`
            });
        }
        if (woRes.rows.length > 0) {
            const rawSides = (woRes.rows[0].sides || '').trim().toLowerCase();
            const isDoubleSided = rawSides === 'top / bottom' || rawSides.includes('/');
            if (isDoubleSided) {
                if (side.toLowerCase() === 'top') {
                    const hasBottomDone = await hasAnyBarcodeBottomCompleted(work_order_id, client);
                    if (!hasBottomDone) {
                        await client.query('ROLLBACK');
                        return res.status(400).json({
                            message: 'Bottom side printing must be completed before Top side printing can start.'
                        });
                    }
                }
            } else {
                if (side.toLowerCase() !== rawSides) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        message: `Selected side ${side} does not match the Work Order side ${woRes.rows[0].sides}.`
                    });
                }
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
            INSERT INTO smt_printing_sessions (
                work_order_id, stencil_lifecycle_id, squeegee_number, squeegee_front_number, squeegee_rear_number, solder_paste_barcode, side, status,
                created_by, created_by_name, updated_by, updated_by_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'In Progress', $8, $9, $8, $9)
            RETURNING *
        `;
        const insertRes = await client.query(insertQuery, [
            work_order_id, validStencilLifecycleId, squeegee_front_number, squeegee_front_number, squeegee_rear_number, solder_paste_barcode, side, operator.username, operator.name
        ]);
        const session = insertRes.rows[0];

        // Audit Logging
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'SESSION_CREATED',
                'PRINTING_SESSION',
                session.id.toString(),
                operator.name,
                `Printing session created and started for Work Order ${work_order_id}`,
                JSON.stringify(session)
            ]
        );

        await client.query('COMMIT');
        return res.status(201).json(session);
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error creating printing session:', err);
        return res.status(500).json({ message: 'Internal server error while starting printing session.' });
    } finally {
        client.release();
    }
};

const fetchPrintingSessionStatsHelper = async (client: any, sessionId: string, workOrderQty: number, sessionRow?: any) => {
    const statsRes = await client.query(
        `SELECT
            COUNT(DISTINCT UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text)))) FILTER (WHERE UPPER(TRIM(i.status)) IN ('PASS', 'PASSED', 'ACCEPTED')) AS passed,
            COUNT(DISTINCT UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text)))) FILTER (WHERE UPPER(TRIM(i.status)) IN ('FAIL', 'FAILED')) AS failed
        FROM smt_inspections i
        LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
        WHERE i.printing_session_id = $1`,
        [sessionId]
    );
    const passed  = parseInt(statsRes.rows[0]?.passed,  10) || 0;
    const failed  = parseInt(statsRes.rows[0]?.failed,  10) || 0;
    const pending = Math.max(0, workOrderQty - passed);

    return { passed, failed, pending, invalid: 0, duplicate: 0 };
};


/**
 * GET /api/smt/printing/sessions
 * Fetch printing sessions.
 */
export const getPrintingSessions = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;

    try {
        let countQuery = search
            ? `SELECT COUNT(ps.id) 
               FROM smt_printing_sessions ps
               JOIN smt_work_orders wo ON ps.work_order_id = wo.id
               JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
               WHERE ps.is_deleted = false`
            : `SELECT COUNT(ps.id) 
               FROM smt_printing_sessions ps
               WHERE ps.is_deleted = false`;
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
                srl.revision AS stencil_version,
                lc.balance_life_cycle AS remaining_life,
                lc.current_used_life_cycle AS current_life_count
            FROM smt_printing_sessions ps
            JOIN smt_work_orders wo ON ps.work_order_id = wo.id
            JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
            JOIN stencil_rack_locations srl ON lc.stencil_record_id = srl.id
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
        logger.error('Error fetching printing sessions:', err);
        return res.status(500).json({ message: 'Internal server error while fetching printing sessions.' });
    }
};

/**
 * GET /api/smt/printing/sessions/:id
 * Get single printing session details by ID.
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
                srl.revision AS stencil_version,
                lc.balance_life_cycle AS remaining_life,
                lc.current_used_life_cycle AS current_life_count
            FROM smt_printing_sessions ps
            JOIN smt_work_orders wo ON ps.work_order_id = wo.id
            JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
            JOIN stencil_rack_locations srl ON lc.stencil_record_id = srl.id
            WHERE ps.id = $1 AND ps.is_deleted = false
        `;
        const result = await pool.query(query, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error fetching printing session by ID:', err);
        return res.status(500).json({ message: 'Internal server error while fetching printing session.' });
    }
};

/**
 * DELETE /api/smt/printing/sessions/:id
 * Soft delete a printing session. (Super Admin only)
 */
export const deletePrintingSession = async (req: Request, res: Response) => {
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

        // Check if session exists
        const sessionRes = await client.query(
            `SELECT * FROM smt_printing_sessions WHERE id = $1 AND is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];

        // Soft delete the session
        await client.query(
            `UPDATE smt_printing_sessions 
             SET is_deleted = true,
                 deleted_by = $1,
                 deleted_by_name = $2,
                 deleted_at = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [operator.username, operator.name, id]
        );

        // Log session deleted
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                'DELETE',
                'PRINTING_SESSION',
                id,
                operator.name,
                `Printing session for Work Order ${session.work_order_id} soft-deleted.`,
                JSON.stringify(session),
                JSON.stringify({
                    userId: operator.id || operator.username,
                    userName: operator.name,
                    userRole: operator.role,
                    moduleName: 'SMT Printing',
                    recordId: id,
                    timestamp: new Date().toISOString(),
                    action: 'DELETE'
                })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ message: 'Printing session deleted successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error deleting printing session:', err);
        return res.status(500).json({ message: 'Internal server error while deleting printing session.' });
    } finally {
        client.release();
    }
};

/**
 * PATCH /api/smt/printing/sessions/:id/status
 * Pause, Cancel, or Abort a session.
 */
export const updateSessionStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remark } = req.body;
    const operator = getSessionUser(req);

    const validStatuses = ['Paused', 'Cancelled', 'Aborted', 'In Progress'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid session status.' });
    }

    if (status === 'Aborted' && (!remark || remark.trim() === '')) {
        return res.status(400).json({ message: 'Failure remark is mandatory to abort a session.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const sessionRes = await client.query(
            `SELECT * FROM smt_printing_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];

        const oldStatus = session.status;
        await client.query(
            `UPDATE smt_printing_sessions 
             SET status = $1,
                 updated_by = $2,
                 updated_by_name = $3,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $4`,
            [status, operator.username, operator.name, id]
        );

        // Audit Log
        let auditEvent = 'SESSION_PAUSED';
        if (status === 'Cancelled') auditEvent = 'SESSION_CANCELLED';
        if (status === 'Aborted') auditEvent = 'SESSION_ABORTED';
        if (status === 'In Progress') auditEvent = 'SESSION_RESUMED';

        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                auditEvent,
                'PRINTING_SESSION',
                id,
                operator.name,
                `Printing session status changed from ${oldStatus} to ${status}. Remark: ${remark || 'N/A'}`,
                JSON.stringify({ status: oldStatus }),
                JSON.stringify({ status, remark })
            ]
        );

        await client.query('COMMIT');
        return res.status(200).json({ message: `Session status updated to ${status}.` });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error updating session status:', err);
        return res.status(500).json({ message: 'Internal server error while updating session status.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/smt/printing/sessions/:id/scan
 * Record a barcode scan.
 */
export const validateAndRecordScan = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { barcode } = req.body;
    const operator = getSessionUser(req);

    if (!barcode) {
        return res.status(400).json({ message: 'Barcode is required.' });
    }

    const cleanBarcode = barcode.trim();
    let client: any = null;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1. Lock the session
        const sessionRes = await client.query(
            `SELECT * FROM smt_printing_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];

        if (session.status === 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Completed sessions are read-only and cannot be modified.' });
        }

        if (session.status !== 'In Progress') {
            // Auto-resume to In Progress on scan
            await client.query(
                `UPDATE smt_printing_sessions SET status = 'In Progress', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
        }

        // 2. Fetch work order details (quantity + sides in one query — sides used later for double-sided check)
        const woRes = await client.query(
            `SELECT quantity, sides FROM smt_work_orders WHERE id = $1`,
            [session.work_order_id]
        );
        const workOrderQty = woRes.rows[0]?.quantity || 0;
        const workOrderSides = (woRes.rows[0]?.sides || '').trim().toLowerCase();
        const cleanWoId = session.work_order_id == null ? null : String(session.work_order_id).trim().toUpperCase();

        // 3. Validate barcode matches a generated serial number for the Work Order (case-insensitive)
        const serialRes = await client.query(
            `SELECT id, serial_number, work_order_id FROM smt_serial_numbers 
             WHERE work_order_id = $1
               AND UPPER(TRIM(serial_number)) = UPPER(TRIM($2))`,
            [cleanWoId, cleanBarcode]
        );

        // Case A: INVALID Barcode
        if (serialRes.rows.length === 0) {
            const otherWoRes = await client.query(
                `SELECT work_order_id FROM smt_serial_numbers WHERE UPPER(TRIM(serial_number)) = UPPER(TRIM($1)) LIMIT 1`,
                [cleanBarcode]
            );
            const failReason = otherWoRes.rows.length > 0
                ? `Serial Number belongs to Work Order '${otherWoRes.rows[0].work_order_id}', not '${session.work_order_id}'`
                : 'Serial Number does not exist or does not belong to selected Work Order';

            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: `Invalid Serial Number: ${failReason}.`
            });
        }

        // Case B: Valid Barcode for this Work Order
        const serialRecord = serialRes.rows[0];

        // 4. Fetch existing scans for this barcode in this session to check for duplicate/repair
        const existingScanRes = await client.query(
            `SELECT id, status, scanned_barcode, serial_id FROM smt_inspections 
             WHERE printing_session_id = $1
               AND (serial_id = $2 OR UPPER(TRIM(scanned_barcode)) = UPPER(TRIM($3)))
               AND status IN ('PASS', 'FAIL')
             LIMIT 1`,
            [id, serialRecord.id, cleanBarcode]
        );

        if (existingScanRes.rows.length > 0) {
            const existingScan = existingScanRes.rows[0];
            if (existingScan.status === 'FAIL') {
                // Rework / Repair lifecycle
                const { repairRemark } = req.body;
                if (!repairRemark || repairRemark.trim() === '') {
                    await client.query('COMMIT');
                    return res.status(200).json({
                        needsRepairRemark: true,
                        message: 'Barcode has a FAIL status. Repair remark is required to complete repair.'
                    });
                }

                // Repair remark is provided! Update the record to PASS, set repair_time and repair_remark
                const updateRes = await client.query(
                    `UPDATE smt_inspections 
                     SET status = 'PASS', 
                         repair_time = CURRENT_TIMESTAMP, 
                         repair_remark = $1,
                         scanned_by = $2
                     WHERE id = $3
                     RETURNING *`,
                    [repairRemark.trim(), operator.name, existingScan.id]
                );

                // Audit log the repair
                await client.query(
                    `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        'REPAIR_INSPECTION',
                        'PRINTING_SESSION',
                        id,
                        operator.name,
                        `PCB Barcode ${cleanBarcode} repaired (FAIL -> PASS) with remark: ${repairRemark.trim()}`,
                        JSON.stringify(updateRes.rows[0])
                    ]
                );

                const stats = await fetchPrintingSessionStatsHelper(client, id, workOrderQty);
                const passCount = stats.passed;

                let completed = false;
                if (passCount >= workOrderQty) {
                    completed = true;
                    await client.query(
                        `UPDATE smt_printing_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                        [id]
                    );

                    await client.query(
                        `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [
                            'SESSION_COMPLETED',
                            'PRINTING_SESSION',
                            id,
                            'System',
                            `Printing Session automatically completed. Passed Count (${passCount}) reached Work Order quantity (${workOrderQty}).`
                        ]
                    );
                }

                await client.query('COMMIT');
                notifySmtDashboardUpdate(session.work_order_id);
                return res.status(200).json({
                    success: true,
                    isValid: true,
                    isRepair: true,
                    isCompleted: completed,
                    sessionStatus: completed ? 'Completed' : 'In Progress',
                    statistics: stats
                });
            } else {
                // If it is 'PASS', duplicate
                await client.query('ROLLBACK');
                return res.status(409).json({ 
                    success: false,
                    message: `Barcode "${cleanBarcode}" has already been scanned in this Printing Session (Duplicate Scan).`
                });
            }
        }

        // For double-sided (TOP/BOTTOM) Work Orders, Top side Printing scan requires this SPECIFIC barcode to have completed Bottom side.
        if (session.side.toLowerCase() === 'top') {
            const isDoubleSided = workOrderSides === 'top / bottom' || workOrderSides.includes('/');
            if (isDoubleSided) {
                const bottomDone = await isBarcodeBottomCompleted(session.work_order_id, serialRecord.id, cleanBarcode);
                if (!bottomDone) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        message: 'Bottom side processing must be completed before Top side processing can start for this barcode.'
                    });
                }
            }
        }

        // 5. Insert PASS inspection
        const insertInspection = `
            INSERT INTO smt_inspections (
                serial_id, process_step, scanned_by, status, work_order_id, printing_session_id, scanned_barcode
            ) VALUES ($1, 'Printing', $2, 'PASS', $3, $4, $5)
            RETURNING *
        `;
        const insRes = await client.query(insertInspection, [
            serialRecord.id, operator.name, session.work_order_id, id, serialRecord.serial_number || cleanBarcode
        ]);

        // Log audit
        await client.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                'PASS_INSPECTION',
                'PRINTING_SESSION',
                id,
                operator.name,
                `Successful print scan (PASS) for barcode: ${cleanBarcode}`,
                JSON.stringify(insRes.rows[0])
            ]
        );

        // Fetch stats first (single FILTER aggregate — includes passed count).
        const stats = await fetchPrintingSessionStatsHelper(client, id, workOrderQty);
        const passCount = stats.passed;

        let completed = false;
        if (passCount >= workOrderQty) {
            completed = true;
            await client.query(
                `UPDATE smt_printing_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );

            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    'SESSION_COMPLETED',
                    'PRINTING_SESSION',
                    id,
                    'System',
                    `Printing Session automatically completed. Passed Count (${passCount}) reached Work Order quantity (${workOrderQty}).`
                ]
            );
        }

        await client.query('COMMIT');
        notifySmtDashboardUpdate(session.work_order_id);
        return res.status(200).json({
            success: true,
            isValid: true,
            isRepair: false,
            isCompleted: completed,
            sessionStatus: completed ? 'Completed' : 'In Progress',
            statistics: stats
        });
    } catch (err: any) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        logger.error('Error scanning barcode:', err);
        return res.status(500).json({ message: 'Internal server error while processing barcode scan.' });
    } finally {
        if (client) {
            client.release();
        }
    }
};

/**
 * PUT /api/smt/printing/sessions/:id/scan/:scanId
 * Edit a scanned barcode. Re-runs validation rules.
 */
export const updateScanBarcode = async (req: Request, res: Response) => {
    const { id, scanId } = req.params;
    const { newBarcode } = req.body;
    const operator = getSessionUser(req);

    if (!newBarcode) {
        return res.status(400).json({ message: 'New barcode is required.' });
    }

    const cleanBarcode = newBarcode.trim();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Check session
        const sessionRes = await client.query(
            `SELECT * FROM smt_printing_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];

        if (session.status === 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Completed sessions are read-only and cannot be modified.' });
        }


        // Check inspection record
        const inspectionRes = await client.query(
            `SELECT * FROM smt_inspections WHERE id = $1 AND printing_session_id = $2 FOR UPDATE`,
            [scanId, id]
        );
        if (inspectionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Scanned record not found.' });
        }
        const oldRecord = inspectionRes.rows[0];

        const cleanWoId = session.work_order_id == null ? null : String(session.work_order_id).trim().toUpperCase();

        // Validate the new barcode exists in serial numbers for this WO (case-insensitive)
        const serialRes = await client.query(
            `SELECT id, serial_number FROM smt_serial_numbers 
             WHERE UPPER(TRIM(serial_number)) = UPPER(TRIM($1)) 
               AND work_order_id = $2`,
            [cleanBarcode, cleanWoId]
        );
        if (serialRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'Invalid Serial Number. This Serial Number does not belong to the selected Work Order.' 
            });
        }
        const newSerial = serialRes.rows[0];

        // Validate new barcode is not a duplicate in this session (excluding current row)
        const duplicateCheck = await client.query(
            `SELECT id FROM smt_inspections 
             WHERE printing_session_id = $1 AND id <> $2
               AND (UPPER(TRIM(scanned_barcode)) = UPPER(TRIM($3)) OR (serial_id IS NOT NULL AND serial_id = $4))`,
            [id, scanId, cleanBarcode, newSerial.id]
        );
        if (duplicateCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                message: 'This barcode has already been scanned in this Printing Session.' 
            });
        }

        // Update record
        await client.query(
            `UPDATE smt_inspections 
             SET serial_id = $1,
                 scanned_barcode = $2,
                 status = 'PASS', -- defaults back to PASS on valid edit
                 rework_reason = NULL,
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
                'PRINTING_SESSION',
                id,
                operator.name,
                `Edited scanned barcode from ${oldRecord.scanned_barcode} to ${cleanBarcode}.`,
                JSON.stringify(oldRecord),
                JSON.stringify({ serial_id: newSerial.id, scanned_barcode: cleanBarcode, status: 'PASS' })
            ]
        );

        // Recalculate unique Passed scans to see if session is completed (Passed Quantity = Work Order Quantity)
        const woRes = await client.query(`SELECT quantity FROM smt_work_orders WHERE id = $1`, [session.work_order_id]);
        const workOrderQty = woRes.rows[0]?.quantity || 0;

        const passRes = await client.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
             FROM smt_inspections 
             WHERE printing_session_id = $1 AND status = 'PASS'`,
            [id]
        );
        const passCount = parseInt(passRes.rows[0].count, 10);

        if (passCount >= workOrderQty) {
            await client.query(
                `UPDATE smt_printing_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    'SESSION_COMPLETED',
                    'PRINTING_SESSION',
                    id,
                    'System',
                    `Printing Session automatically completed after barcode edit. Passed Count (${passCount}) reached Work Order quantity (${workOrderQty}).`
                ]
            );
        }

        await client.query('COMMIT');
        notifySmtDashboardUpdate(session.work_order_id);
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
 * POST /api/smt/printing/sessions/:id/scan/:scanId/fail
 * Transition a scanned row from PASS to FAIL. Requires failure remark.
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
            `SELECT * FROM smt_printing_sessions WHERE id = $1 AND is_deleted = false FOR UPDATE`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];

        if (session.status === 'Completed') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'Completed sessions are read-only and cannot be modified.' });
        }


        // Check inspection record
        const inspectionRes = await client.query(
            `SELECT * FROM smt_inspections WHERE id = $1 AND printing_session_id = $2 FOR UPDATE`,
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
                'PRINTING_SESSION',
                id,
                operator.name,
                `PCB barcode ${oldRecord.scanned_barcode} manually failed. Reason: ${remark.trim()}`,
                JSON.stringify({ status: 'PASS' }),
                JSON.stringify({ status: 'FAIL', rework_reason: remark.trim() })
            ]
        );

        // Recalculate unique Passed scans to see if session is completed (Passed Quantity = Work Order Quantity)
        const woRes = await client.query(`SELECT quantity FROM smt_work_orders WHERE id = $1`, [session.work_order_id]);
        const workOrderQty = woRes.rows[0]?.quantity || 0;

        const passRes = await client.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count 
             FROM smt_inspections 
             WHERE printing_session_id = $1 AND status = 'PASS'`,
            [id]
        );
        const passCount = parseInt(passRes.rows[0].count, 10);

        if (passCount >= workOrderQty) {
            await client.query(
                `UPDATE smt_printing_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
            await client.query(
                `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description)
                 VALUES ($1, $2, $3, $4, $5)`,
                [
                    'SESSION_COMPLETED',
                    'PRINTING_SESSION',
                    id,
                    'System',
                    `Printing Session automatically completed after manual fail. Passed Count (${passCount}) reached Work Order quantity (${workOrderQty}).`
                ]
            );
        }

        await client.query('COMMIT');
        notifySmtDashboardUpdate(session.work_order_id);
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
 * GET /api/smt/printing/sessions/:id/stats
 * Retrieve printing session statistics.
 */
export const getSessionStatistics = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const sessionRes = await pool.query(
            `SELECT ps.*, wo.quantity AS work_order_quantity 
             FROM smt_printing_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];
        const workOrderQty = session.work_order_quantity;

        const stats = await fetchPrintingSessionStatsHelper(pool, id, workOrderQty, session);
        const { passed, failed, pending } = stats;

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
            WHERE ins.printing_session_id = $1
            ORDER BY ins.scanned_at DESC
        `;
        const scansListRes = await pool.query(scansListQuery, [id]);

        return res.status(200).json({
            workOrderQuantity: workOrderQty,
            passed,
            failed,
            pending,
            invalid: 0,
            duplicate: 0,
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
 * GET /api/smt/printing/sessions/:id/export/excel
 * Full Professional Excel Report for a Printing Session.
 */
export const exportPrintingSessionExcel = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        // Fetch session + work order data
        const sessionRes = await pool.query(
            `SELECT 
                ps.*,
                wo.product_name, wo.product_description, wo.po_id,
                wo.quantity AS work_order_quantity, wo.panel_quantity,
                wo.sides AS work_order_sides, wo.line_id, wo.remark AS work_order_remarks,
                lc.stencil_name, lc.qty_life_cycle, lc.balance_life_cycle, lc.current_used_life_cycle,
                lc.sides AS stencil_side,
                srl.job_number, srl.revision, srl.thickness_mills, srl.manufacturing_date
             FROM smt_printing_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
             JOIN stencil_rack_locations srl ON lc.stencil_record_id = srl.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];

        // Production counts
        const passedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count FROM smt_inspections WHERE printing_session_id = $1 AND status = 'PASS'`, [id]
        );
        const failedRes = await pool.query(
            `SELECT COUNT(id) AS count FROM smt_inspections WHERE printing_session_id = $1 AND status = 'FAIL'`, [id]
        );
        const passed = parseInt(passedRes.rows[0].count);
        const failed = parseInt(failedRes.rows[0].count);
        const pending = Math.max(0, (session.work_order_quantity || 0) - passed);

        // Scans list
        const scansRes = await pool.query(
            `SELECT scanned_barcode AS barcode, status AS result, rework_reason AS remark, scanned_by, scanned_at, repair_time, repair_remark
             FROM smt_inspections WHERE printing_session_id = $1 ORDER BY scanned_at ASC`,
            [id]
        );

        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description) VALUES ($1, $2, $3, $4, $5)`,
            ['EXPORT', 'PRINTING_SESSION', id, operator.name, `Exported printing session full report to Excel.`]
        );

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'SFCS SMT System';
        workbook.created = new Date();
        const ws = workbook.addWorksheet('Printing Report', {
            pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true }
        });

        // ── Colour palette ──────────────────────────────────────────────────────
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

        // Helper: merge-row section header
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

        // ── TITLE BANNER ─────────────────────────────────────────────────────────
        ws.getRow(r).height = 38;
        const titleCell = ws.getCell(`A${r}`);
        titleCell.value = '🏭  SMT PRINTING SESSION REPORT';
        titleCell.font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
        titleCell.fill = NAVY;
        titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:G${r}`);
        r++;

        // Sub-header row
        ws.getRow(r).height = 18;
        const subCell = ws.getCell(`A${r}`);
        subCell.value = `Stage: SMT Printing  |  Generated: ${fmtDate(new Date())}  |  Generated By: ${operator.name}`;
        subCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FFCBD5E1' } };
        subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
        subCell.alignment = { vertical: 'middle', horizontal: 'center' };
        ws.mergeCells(`A${r}:G${r}`);
        r++;

        // Spacer
        r++;

        // ── SECTION 1: Work Order Details ────────────────────────────────────────
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

        r++; // spacer

        // ── SECTION 2: Stencil Details ───────────────────────────────────────────
        addSectionHeader('  2.  STENCIL DETAILS', TEAL, r); r++;
        addKVRow(r, 'Stencil / Model Name', session.stencil_name); r++;
        addKVRow(r, 'Job Number', session.job_number); r++;
        addKVRow(r, 'Revision', session.revision); r++;
        addKVRow(r, 'Thickness (mils)', session.thickness_mills); r++;
        addKVRow(r, 'Manufacturing Date', fmtDateOnly(session.manufacturing_date)); r++;
        addKVRow(r, 'Side', session.stencil_side); r++;
        addKVRow(r, 'Current Life Cycle Count', session.current_used_life_cycle); r++;
        addKVRow(r, 'Remaining Life Count', session.balance_life_cycle); r++;

        r++; // spacer

        // ── SECTION 3: Printing Session Details ─────────────────────────────────
        addSectionHeader('  3.  PRINTING SESSION DETAILS', INDIGO, r); r++;
        addKVRow(r, 'Squeegee Front Number', session.squeegee_front_number); r++;
        addKVRow(r, 'Squeegee Rear Number', session.squeegee_rear_number); r++;
        addKVRow(r, 'Solder Paste Barcode', session.solder_paste_barcode); r++;
        addKVRow(r, 'PCB Side', session.side); r++;
        addKVRow(r, 'Printing Started By', session.created_by_name); r++;
        addKVRow(r, 'Printing Started Date & Time', fmtDate(session.created_at)); r++;
        addKVRow(r, 'Printing Status', session.status); r++;

        r++; // spacer

        // ── SECTION 4: Production Summary ───────────────────────────────────────
        const yieldPercent = (session.work_order_quantity && session.work_order_quantity > 0)
            ? ((passed / session.work_order_quantity) * 100).toFixed(2) + '%'
            : '0.00%';

        addSectionHeader('  4.  PRODUCTION SUMMARY', PLUM, r); r++;
        addKVRow(r, 'Work Order Quantity', session.work_order_quantity); r++;
        addKVRow(r, 'Passed Quantity', passed); r++;
        addKVRow(r, 'Yield (%)', yieldPercent); r++;
        addKVRow(r, 'Failed Quantity', failed); r++;
        addKVRow(r, 'Pending Quantity', pending); r++;

        r++; // spacer

        // ── SECTION 5: Scan History Table ───────────────────────────────────────
        addSectionHeader('  5.  SCAN HISTORY', GREEN, r); r++;

        // Table Header
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
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false };
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
            cell.value = 'No scan records found for this session.';
            cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            ws.mergeCells(`A${r}:G${r}`);
            r++;
        }

        // Footer
        r++;
        const footerCell = ws.getCell(`A${r}`);
        footerCell.value = `Report generated by SFCS SMT System  |  ${operator.name}  |  ${fmtDate(new Date())}`;
        footerCell.font = { name: 'Calibri', size: 9, italic: true, color: { argb: 'FF94A3B8' } };
        ws.mergeCells(`A${r}:G${r}`);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=Printing_Report_${session.work_order_id}.xlsx`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err: any) {
        logger.error('Error exporting session to Excel:', err);
        return res.status(500).json({ message: 'Internal server error while exporting Excel.' });
    }
};

/**
 * GET /api/smt/printing/sessions/:id/export/pdf-data
 * Returns structured JSON consumed by the frontend jsPDF renderer to produce the PDF report.
 */
export const exportPrintingSessionPdfData = async (req: Request, res: Response) => {
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
                srl.job_number, srl.revision, srl.thickness_mills, srl.manufacturing_date
             FROM smt_printing_sessions ps
             JOIN smt_work_orders wo ON ps.work_order_id = wo.id
             JOIN smt_stencil_lifecycle lc ON ps.stencil_lifecycle_id = lc.id
             JOIN stencil_rack_locations srl ON lc.stencil_record_id = srl.id
             WHERE ps.id = $1 AND ps.is_deleted = false`,
            [id]
        );
        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'Printing session not found.' });
        }
        const session = sessionRes.rows[0];

        const passedRes = await pool.query(
            `SELECT COUNT(DISTINCT COALESCE(serial_id::text, scanned_barcode)) AS count FROM smt_inspections WHERE printing_session_id = $1 AND status = 'PASS'`, [id]
        );
        const failedRes = await pool.query(
            `SELECT COUNT(id) AS count FROM smt_inspections WHERE printing_session_id = $1 AND status = 'FAIL'`, [id]
        );
        const passed = parseInt(passedRes.rows[0].count);
        const failed = parseInt(failedRes.rows[0].count);
        const pending = Math.max(0, (session.work_order_quantity || 0) - passed);

        const scansRes = await pool.query(
            `SELECT scanned_barcode AS barcode, status AS result, rework_reason AS remark, scanned_by, scanned_at, repair_time, repair_remark
             FROM smt_inspections WHERE printing_session_id = $1 ORDER BY scanned_at ASC`,
            [id]
        );

        await pool.query(
            `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, description) VALUES ($1, $2, $3, $4, $5)`,
            ['EXPORT', 'PRINTING_SESSION', id, operator.name, `Exported printing session full report to PDF.`]
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
                squeegeeFrontNumber: session.squeegee_front_number,
                squeegeeRearNumber: session.squeegee_rear_number,
                solderPasteBarcode: session.solder_paste_barcode,
                pcbSide: session.side,
                startedBy: session.created_by_name,
                startedAt: session.created_at,
                status: session.status
            },
            production: {
                quantity: session.work_order_quantity,
                passed,
                failed,
                pending,
                invalid: 0,
                duplicate: 0
            },
            scans: scansRes.rows
        });
    } catch (err: any) {
        logger.error('Error fetching PDF report data:', err);
        return res.status(500).json({ message: 'Internal server error while fetching PDF report data.' });
    }
};

/**
 * GET /api/smt/printing/work-orders/:woId/check-bottom
 * Check if Bottom side printing is completed for a double-sided Work Order.
 */
export const checkBottomCompleted = async (req: Request, res: Response) => {
    const { woId } = req.params;
    try {
        const woRes = await pool.query('SELECT sides, has_smt FROM smt_work_orders WHERE id = $1', [woId]);
        if (woRes.rows.length === 0 || woRes.rows[0].has_smt === false) {
            return res.status(404).json({ message: 'Work Order not found or not configured for SMT.' });
        }
        const resolvedSide = await resolveWorkOrderSide(woId, woRes.rows[0].sides);
        return res.status(200).json({ completed: resolvedSide === 'Top' });
    } catch (err: any) {
        logger.error('Error checking bottom side completion:', err);
        return res.status(500).json({ message: 'Internal server error while checking bottom side completion.' });
    }
};

