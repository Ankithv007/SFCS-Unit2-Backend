import { Request, Response } from 'express';
import { pool } from '../utils/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('InwardScanController');

const getSessionUser = (req: Request) => {
    const user = (req as any).user;
    // Prefer human-readable name first, then employee_code, then email
    const resolvedName = user?.name || user?.employee_code || user?.email || 'Unknown User';
    return {
        id: user?.id || user?.userId || null,
        name: resolvedName,
        username: resolvedName,
        role: user?.role || 'OPERATOR'
    };
};

/**
 * GET /api/rrh/inward/sessions/:id/stats
 * Returns session statistics: lotQuantity, passed, invalid, pending, duplicate, yield, and scans list.
 */
export const getSessionStats = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        // 1. Get the session and its work_order_id
        const sessionRes = await pool.query(
            `SELECT s.*, w.lot_quantity, w.id as wo_db_id, w.active_import_id
             FROM rrh_inward_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'INWARD session not found.' });
        }

        const session = sessionRes.rows[0];
        const lotQuantity = parseInt(session.lot_quantity, 10) || 0;

        // 2. Get all scans for this session
        const scansRes = await pool.query(
            `SELECT 
                s.id as scan_id, 
                s.serial_number as barcode, 
                COALESCE(s.original_serial_number, s.serial_number) as original_serial_number,
                s.corrected_serial_number,
                COALESCE(s.corrected_serial_number, s.serial_number) as physical_serial_number,
                s.physical_tpn,
                s.band_serial_no,
                s.matched_inventory_id,
                s.status as result, 
                s.status,
                s.remark, 
                s.scanned_by, 
                s.scanned_at, 
                s.repair_time, 
                s.repair_remark,
                s.repaired_by,
                i.sl_no,
                i.remarks_2 as master_remark
             FROM rrh_inward_scans s
             LEFT JOIN rrh_inventory i ON s.matched_inventory_id = i.id
             WHERE s.rrh_inward_session_id = $1 AND s.is_deleted = false
             ORDER BY s.scanned_at DESC, s.id DESC`,
            [id]
        );

        const scans = scansRes.rows;

        // 3. Calculate statistics
        const passed = scans.filter((s: any) => s.result === 'PASS').length;
        const editedPass = scans.filter((s: any) => s.result === 'EDITED PASS').length;
        const failed = scans.filter((s: any) => s.result === 'FAIL').length;
        const invalid = scans.filter((s: any) => s.result === 'INVALID').length;
        const duplicate = session.duplicate_scan_count || 0;
        const pending = Math.max(0, lotQuantity - passed - editedPass);
        const yieldRate = lotQuantity > 0 ? (((passed + editedPass) / lotQuantity) * 100).toFixed(2) : '0.00';

        // 4. Check if session should be completed (only successful passes count towards lotQuantity)
        const isCompleted = lotQuantity > 0 && (passed + editedPass) >= lotQuantity;

        if (isCompleted && session.status === 'In Progress') {
            await pool.query(
                `UPDATE rrh_inward_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
            session.status = 'Completed';
        }

        return res.status(200).json({
            workOrderQuantity: lotQuantity,
            lotQuantity,
            passed,
            editedPass,
            failed,
            invalid,
            pending,
            duplicate,
            yield: yieldRate,
            yieldPercent: `${yieldRate}%`,
            scans,
            isCompleted,
            status: session.status
        });
    } catch (err: any) {
        logger.error('Error fetching session stats: ' + err);
        return res.status(500).json({ message: 'Internal server error while fetching session stats.' });
    }
};

/**
 * POST /api/rrh/inward/sessions/:id/scan
 * Validates and records a Physical Serial Number scan against the work order's master data (band_serial_no).
 * EXACT MATCH = PASS. NON-MATCH = INVALID. DUPLICATE = DUPLICATE (no pass, no consumption).
 */
export const scanBarcode = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { barcode, repairRemark } = req.body;
    const operator = getSessionUser(req);

    if (!barcode || !barcode.trim()) {
        return res.status(400).json({ message: 'Physical Serial Number is required.' });
    }

    const cleanBarcode = barcode.trim();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get session details and lock session row
        const sessionRes = await client.query(
            `SELECT s.*, w.lot_quantity, w.id as wo_db_id, w.active_import_id
             FROM rrh_inward_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false
             FOR UPDATE OF s`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'INWARD session not found.' });
        }

        const session = sessionRes.rows[0];

        if (session.status !== 'In Progress') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Cannot scan: session is ${session.status}.` });
        }

        const lotQuantity = parseInt(session.lot_quantity, 10) || 0;

        // 2. Check for DUPLICATE scan in this session
        // Check 2a: Was this exact serial already passed in this session?
        const passedScanCheck = await client.query(
            `SELECT id FROM rrh_inward_scans 
             WHERE rrh_inward_session_id = $1 
               AND status = 'PASS' 
               AND is_deleted = false
               AND (
                   TRIM(serial_number) = $2 
                   OR TRIM(COALESCE(corrected_serial_number, '')) = $2
                   OR TRIM(COALESCE(band_serial_no, '')) = $2
               )
             LIMIT 1`,
            [id, cleanBarcode]
        );

        // Check 2b: Was the matching master record already consumed in this session?
        const consumptionCheck = await client.query(
            `SELECT c.id FROM rrh_inward_session_master_consumption c
             JOIN rrh_inventory ri ON c.inventory_id = ri.id
             WHERE c.session_id = $1 AND TRIM(ri.band_serial_no) = $2
             LIMIT 1`,
            [id, cleanBarcode]
        );

        if (passedScanCheck.rows.length > 0 || consumptionCheck.rows.length > 0) {
            await client.query(
                `UPDATE rrh_inward_sessions 
                 SET duplicate_scan_count = duplicate_scan_count + 1, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [id]
            );
            await client.query('COMMIT');
            return res.status(409).json({
                isDuplicate: true,
                message: `Duplicate: Serial Number "${cleanBarcode}" has already passed in this INWARD Session.`
            });
        }

        // 3. Exact Master Data Comparison against Work Order inventory
        // Must match unconsumed record for this work order
        const masterCheck = await client.query(
            `SELECT ri.id, ri.physical_tpn, ri.band_serial_no, ri.sl_no
             FROM rrh_inventory ri
             JOIN rrh_work_orders rwo ON (
                 (rwo.active_import_id IS NOT NULL AND ri.import_id = rwo.active_import_id)
                 OR (rwo.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = rwo.id))
             )
             WHERE rwo.work_order_id = $1 
               AND TRIM(ri.band_serial_no) = $2
               AND ri.id NOT IN (
                   SELECT inventory_id 
                   FROM rrh_inward_session_master_consumption 
                   WHERE session_id = $3
               )
             LIMIT 1`,
            [session.work_order_id, cleanBarcode, id]
        );

        const hasMatch = masterCheck.rows.length > 0;

        if (hasMatch) {
            // EXACT MATCH = PASS
            const matched = masterCheck.rows[0];

            // Insert PASS scan record with full master details
            const insertScanRes = await client.query(
                `INSERT INTO rrh_inward_scans (
                    rrh_inward_session_id, work_order_id, serial_number, original_serial_number,
                    physical_tpn, band_serial_no, matched_inventory_id, status, remark,
                    scanned_by, scanned_at
                 ) VALUES ($1, $2, $3, $3, $4, $5, $6, 'PASS', NULL, $7, CURRENT_TIMESTAMP)
                 RETURNING *`,
                [id, session.work_order_id, cleanBarcode, matched.physical_tpn, matched.band_serial_no, matched.id, operator.name]
            );
            const scanRecord = insertScanRes.rows[0];

            // Record master consumption for this session
            await client.query(
                `INSERT INTO rrh_inward_session_master_consumption (
                    session_id, inventory_id, scan_id, consumed_at
                 ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                 ON CONFLICT (session_id, inventory_id) DO NOTHING`,
                [id, matched.id, scanRecord.id]
            );

            // Check if this scan completes the session
            const passedCountRes = await client.query(
                `SELECT COUNT(*)::int as count FROM rrh_inward_scans 
                 WHERE rrh_inward_session_id = $1 AND status IN ('PASS', 'EDITED PASS') AND is_deleted = false`,
                [id]
            );
            const currentPassed = passedCountRes.rows[0]?.count || 0;
            if (lotQuantity > 0 && currentPassed >= lotQuantity) {
                await client.query(
                    `UPDATE rrh_inward_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                    [id]
                );
            }

            await client.query('COMMIT');

            return res.status(200).json({
                isValid: true,
                result: 'PASS',
                message: `Physical Serial Number "${cleanBarcode}" registered: PASS.`,
                physical_tpn: matched.physical_tpn,
                band_serial_no: matched.band_serial_no,
                scan: {
                    ...scanRecord,
                    id: scanRecord.id,
                    scan_id: scanRecord.id,
                    barcode: cleanBarcode,
                    physical_serial_number: cleanBarcode
                }
            });
        } else {
            // NO EXACT MATCH = INVALID
            // Per new requirement: Invalid scans must never enter Scanned Product Logs.
            await client.query('ROLLBACK');

            return res.status(200).json({
                isValid: false,
                result: 'INVALID',
                message: `Invalid Serial Number "${cleanBarcode}". Serial Number does not belong to the selected Work Order.`
            });
        }
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error scanning barcode: ' + err);
        return res.status(500).json({ message: 'Internal server error while scanning barcode.' });
    } finally {
        client.release();
    }
};

/**
 * POST /api/rrh/inward/sessions/:id/assign
 * Assigns a physical serial number to a remaining master data record.
 * Status becomes 'EDITED PASS'.
 */
export const assignUnit = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { inventoryId, physicalSerialNumber, remark } = req.body;
    const operator = getSessionUser(req);

    const cleanSerial = (physicalSerialNumber || '').trim();
    const cleanRemark = (remark || '').trim();

    if (!inventoryId) {
        return res.status(400).json({ message: 'Master Data inventory ID is required.' });
    }
    if (!cleanSerial) {
        return res.status(400).json({ message: 'Physical Serial Number is required.' });
    }
    if (!cleanRemark) {
        return res.status(400).json({ message: 'Assignment remark is mandatory.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get session details
        const sessionRes = await client.query(
            `SELECT s.*, w.lot_quantity, w.id as wo_db_id, w.active_import_id
             FROM rrh_inward_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false
             FOR UPDATE OF s`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'INWARD session not found.' });
        }

        const session = sessionRes.rows[0];
        if (session.status !== 'In Progress') {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Cannot assign: session is ${session.status}.` });
        }

        const lotQuantity = parseInt(session.lot_quantity, 10) || 0;

        // 2. Ensure master data belongs to WO and is unconsumed
        const masterCheck = await client.query(
            `SELECT ri.id, ri.physical_tpn, ri.band_serial_no, ri.sl_no
             FROM rrh_inventory ri
             JOIN rrh_work_orders rwo ON (
                 (rwo.active_import_id IS NOT NULL AND ri.import_id = rwo.active_import_id)
                 OR (rwo.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = rwo.id))
             )
             WHERE rwo.work_order_id = $1 
               AND ri.id = $2
               AND ri.id NOT IN (
                   SELECT inventory_id 
                   FROM rrh_inward_session_master_consumption 
                   WHERE session_id = $3
               )
             LIMIT 1`,
            [session.work_order_id, inventoryId, id]
        );

        if (masterCheck.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                message: `Master Data record not found or has already been consumed in this session.`
            });
        }

        const matched = masterCheck.rows[0];

        // 3. Ensure the entered physical serial number hasn't been used yet in this session
        const passedScanCheck = await client.query(
            `SELECT id FROM rrh_inward_scans 
             WHERE rrh_inward_session_id = $1 
               AND status IN ('PASS', 'EDITED PASS') 
               AND is_deleted = false
               AND (
                   TRIM(serial_number) = $2 
                   OR TRIM(COALESCE(corrected_serial_number, '')) = $2
                   OR TRIM(COALESCE(band_serial_no, '')) = $2
               )
             LIMIT 1`,
            [id, cleanSerial]
        );

        if (passedScanCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                message: `Duplicate: Serial Number "${cleanSerial}" has already been passed/assigned in this INWARD Session.`
            });
        }

        // 4. Insert scan record with status 'EDITED PASS'
        const insertScanRes = await client.query(
            `INSERT INTO rrh_inward_scans (
                rrh_inward_session_id, work_order_id, serial_number, original_serial_number,
                corrected_serial_number, physical_tpn, band_serial_no, matched_inventory_id, 
                status, repair_remark, repair_time, repaired_by, scanned_by, scanned_at
             ) VALUES ($1, $2, $3, $3, $3, $4, $5, $6, 'EDITED PASS', $7, CURRENT_TIMESTAMP, $8, $8, CURRENT_TIMESTAMP)
             RETURNING *`,
            [id, session.work_order_id, cleanSerial, matched.physical_tpn, matched.band_serial_no, matched.id, cleanRemark, operator.name]
        );
        const scanRecord = insertScanRes.rows[0];

        // 5. Record consumption
        await client.query(
            `INSERT INTO rrh_inward_session_master_consumption (
                session_id, inventory_id, scan_id, consumed_at
             ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
            [id, matched.id, scanRecord.id]
        );

        // 6. Check for completion
        const passedCountRes = await client.query(
            `SELECT COUNT(*)::int as count FROM rrh_inward_scans 
             WHERE rrh_inward_session_id = $1 AND status IN ('PASS', 'EDITED PASS') AND is_deleted = false`,
            [id]
        );
        const currentPassed = passedCountRes.rows[0]?.count || 0;
        if (lotQuantity > 0 && currentPassed >= lotQuantity) {
            await client.query(
                `UPDATE rrh_inward_sessions SET status = 'Completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [id]
            );
        }

        await client.query('COMMIT');

        return res.status(200).json({
            success: true,
            isValid: true,
            result: 'EDITED PASS',
            message: `Serial Number "${cleanSerial}" manually assigned to master record: EDITED PASS.`,
            scan: {
                ...scanRecord,
                id: scanRecord.id,
                scan_id: scanRecord.id,
                barcode: cleanSerial,
                physical_serial_number: cleanSerial
            }
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        logger.error('Error assigning unit: ' + err);
        return res.status(500).json({ message: 'Internal server error while assigning unit.' });
    } finally {
        client.release();
    }
};

/**
 * GET /api/rrh/inward/sessions/:id/remaining-master-data
 * Returns the unconsumed master data records for the active INWARD session.
 * Deducts successfully passed/consumed records without deleting original master records.
 * Supports search and pagination.
 */
export const getRemainingMasterData = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
        const limitParam = req.query.limit as string;
        let limit = 15;
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

        // 1. Get session and its work_order_id
        const sessionRes = await pool.query(
            `SELECT s.work_order_id, w.id as wo_db_id, w.active_import_id
             FROM rrh_inward_sessions s
             LEFT JOIN rrh_work_orders w ON w.work_order_id = s.work_order_id
             WHERE s.id = $1 AND s.is_deleted = false`,
            [id]
        );

        if (sessionRes.rows.length === 0) {
            return res.status(404).json({ message: 'INWARD session not found.' });
        }

        const session = sessionRes.rows[0];

        // 2. Base query: inventory items belonging to this WO that have NOT been consumed by this session
        const baseWhere = `
            JOIN rrh_work_orders rwo ON (
                (rwo.active_import_id IS NOT NULL AND ri.import_id = rwo.active_import_id)
                OR (rwo.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = rwo.id))
            )
            WHERE rwo.work_order_id = $1
              AND ri.id NOT IN (
                  SELECT inventory_id 
                  FROM rrh_inward_session_master_consumption 
                  WHERE session_id = $2
              )
        `;

        const queryParams: any[] = [session.work_order_id, id];
        let searchClause = '';

        if (search) {
            queryParams.push(`%${search}%`);
            searchClause = ` AND (
                ri.band_serial_no ILIKE $${queryParams.length} 
                OR ri.physical_tpn ILIKE $${queryParams.length} 
                OR ri.sl_no ILIKE $${queryParams.length}
                OR ri.tejas_dc_no ILIKE $${queryParams.length}
                OR ri.tejas_obd_no ILIKE $${queryParams.length}
            )`;
        }

        // 3. Count total remaining
        const countRes = await pool.query(
            `SELECT COUNT(ri.id)::int as total 
             FROM rrh_inventory ri 
             ${baseWhere} ${searchClause}`,
            queryParams
        );
        const total = countRes.rows[0]?.total || 0;

        // 4. Fetch paginated remaining rows with stable global_row_number
        //    global_row_number = position of each row in the FULL WO inventory (all records, ordered by id ASC)
        //    This ensures S.No. 21 is always 21 — never renumbered as items are consumed.
        const baseJoin = `
            JOIN rrh_work_orders rwo ON (
                (rwo.active_import_id IS NOT NULL AND ri.import_id = rwo.active_import_id)
                OR (rwo.active_import_id IS NULL AND ri.import_id IN (SELECT id FROM rrh_excel_imports WHERE work_order_id = rwo.id))
            )
        `;
        const allWoParams: any[] = [session.work_order_id];
        const remainingParams: any[] = [session.work_order_id, id];
        if (search) {
            remainingParams.push(`%${search}%`);
        }
        const searchFilter = search
            ? `AND (ri.band_serial_no ILIKE $${remainingParams.length} OR ri.physical_tpn ILIKE $${remainingParams.length} OR ri.sl_no ILIKE $${remainingParams.length} OR ri.tejas_dc_no ILIKE $${remainingParams.length} OR ri.tejas_obd_no ILIKE $${remainingParams.length})`
            : '';

        const dataQuery = `
            WITH all_wo_inventory AS (
                SELECT ri.id,
                       ROW_NUMBER() OVER (ORDER BY ri.id ASC) AS global_row_number
                FROM rrh_inventory ri
                ${baseJoin}
                WHERE rwo.work_order_id = $1
            )
            SELECT
                ri.id,
                ri.sl_no,
                ri.physical_tpn,
                ri.band_serial_no,
                ri.tejas_dc_no,
                ri.tejas_obd_no,
                ri.pr_no,
                ri.invoice_rma_no,
                ri.lot,
                ri.remarks_2 AS remarks,
                ri.failure_description,
                awi.global_row_number
            FROM rrh_inventory ri
            ${baseJoin}
            JOIN all_wo_inventory awi ON awi.id = ri.id
            WHERE rwo.work_order_id = $1
              AND ri.id NOT IN (
                  SELECT inventory_id
                  FROM rrh_inward_session_master_consumption
                  WHERE session_id = $2
              )
              ${searchFilter}
            ORDER BY ri.id ASC
            LIMIT $${remainingParams.length + 1} OFFSET $${remainingParams.length + 2}
        `;

        const dataRes = await pool.query(dataQuery, [...remainingParams, limit, offset]);

        return res.status(200).json({
            success: true,
            data: dataRes.rows,
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
        logger.error('Error fetching remaining master data: ' + err);
        return res.status(500).json({ message: 'Internal server error while fetching remaining master data.' });
    }
};

/**
 * POST /api/rrh/inward/sessions/:id/scan/:scanId/fail
 * Mark a scan as FAIL with a remark. (Maintained for backward compatibility)
 */
export const failScan = async (req: Request, res: Response) => {
    const { id, scanId } = req.params;
    const { remark } = req.body;
    const operator = getSessionUser(req);

    if (!remark || !remark.trim()) {
        return res.status(400).json({ message: 'Failure remark is required.' });
    }

    try {
        const result = await pool.query(
            `UPDATE rrh_inward_scans 
             SET status = 'FAIL', remark = $1, scanned_by = $2, scanned_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND rrh_inward_session_id = $4 AND is_deleted = false
             RETURNING *`,
            [remark.trim(), operator.name, scanId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Scan record not found.' });
        }

        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error failing scan: ' + err);
        return res.status(500).json({ message: 'Internal server error while updating scan status.' });
    }
};

/**
 * PUT /api/rrh/inward/sessions/:id/scan/:scanId
 * Edit a scanned barcode value. (Maintained for backward compatibility)
 */
export const editScan = async (req: Request, res: Response) => {
    const { id, scanId } = req.params;
    const { newBarcode } = req.body;

    if (!newBarcode || !newBarcode.trim()) {
        return res.status(400).json({ message: 'New barcode value is required.' });
    }

    try {
        const result = await pool.query(
            `UPDATE rrh_inward_scans 
             SET serial_number = $1, scanned_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND rrh_inward_session_id = $3 AND is_deleted = false
             RETURNING *`,
            [newBarcode.trim(), scanId, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Scan record not found.' });
        }

        return res.status(200).json(result.rows[0]);
    } catch (err: any) {
        logger.error('Error editing scan: ' + err);
        return res.status(500).json({ message: 'Internal server error while editing scan.' });
    }
};

/**
 * DELETE /api/rrh/inward/sessions/:id
 * Soft delete an inward session (Super Admin only).
 */
export const deleteSession = async (req: Request, res: Response) => {
    const { id } = req.params;
    const operator = getSessionUser(req);

    try {
        const result = await pool.query(
            `UPDATE rrh_inward_sessions 
             SET is_deleted = true, deleted_by = $1, deleted_by_name = $2, deleted_at = CURRENT_TIMESTAMP
             WHERE id = $3 AND is_deleted = false
             RETURNING *`,
            [operator.name, operator.name, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'INWARD session not found.' });
        }

        return res.status(200).json({ message: 'INWARD session deleted successfully.' });
    } catch (err: any) {
        logger.error('Error deleting session: ' + err);
        return res.status(500).json({ message: 'Internal server error while deleting session.' });
    }
};
