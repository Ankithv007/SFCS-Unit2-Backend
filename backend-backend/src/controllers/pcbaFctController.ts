import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';
import { processMESScan } from '../utils/mesLogic';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by } = req.body;
        if (!work_order_id) return sendError(res, "work_order_id is required");
        if (!created_by) return sendError(res, "created_by is required");

        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) return sendError(res, "Work Order not found", 404);
        const batch_number = woResult.rows[0].wo_number;

        const result = await pool.query(
            `INSERT INTO pcba_fct_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        return sendSuccess(res, "Batch created successfully", result.rows[0]);
    } catch (err: any) {
        if (err.code === '23505') return sendError(res, "Batch for this Work Order already exists");
        return sendError(res, err.message, 500);
    }
};

export const getBatches = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const offset = (page - 1) * limit;
    const statusFilter = req.query.status as string;
    const search = req.query.search as string;

    try {
        let baseQuery = `
            SELECT * FROM (
                SELECT 
                b.id, b.batch_number, b.work_order_id, b.created_at, b.created_by, b.is_deleted,
                w.wo_number, 
                w.customer_name,
                w.model,
                w.quantity as "workOrderQty",
                (SELECT COUNT(DISTINCT ps.barcode) FROM flashing_scans ps JOIN flashing_batches pb ON ps.batch_id = pb.id WHERE pb.work_order_id = w.id AND ps.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED')) as "previousStagePassed",
                stats.scanned,
                ((SELECT COUNT(DISTINCT ps.barcode) FROM flashing_scans ps JOIN flashing_batches pb ON ps.batch_id = pb.id WHERE pb.work_order_id = w.id AND ps.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED')) - stats.scanned) as pending,
                stats.passed,
                stats.rework,
                stats.debug,
                b.status
            FROM pcba_fct_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN LATERAL (
                WITH latest_scans AS (
                    SELECT DISTINCT ON (barcode) status
                    FROM pcba_fct_scans
                    WHERE batch_id = b.id
                    ORDER BY barcode, scanned_at DESC
                )
                SELECT 
                    COUNT(*)::int as scanned,
                    COUNT(*) FILTER (WHERE status = 'ACCEPTED')::int as passed,
                    COUNT(*) FILTER (WHERE status = 'REWORK')::int as rework,
                    COUNT(*) FILTER (WHERE status = 'DEBUG')::int as debug
                FROM latest_scans
            ) stats ON TRUE
            WHERE b.is_deleted = FALSE
            ) as t
        `;
        
        let whereClause = '';
        const conditions = [];
        const queryParams: any[] = [];

        if (statusFilter) {
            if (statusFilter === 'completed') {
                conditions.push("t.status = 'completed'");
            } else {
                conditions.push("t.status != 'completed'");
            }
        }

        if (search) {
            queryParams.push(`%${search}%`);
            conditions.push(`(t.wo_number ILIKE $${queryParams.length} OR t.batch_number ILIKE $${queryParams.length} OR t.model ILIKE $${queryParams.length})`);
        }

        if (conditions.length > 0) {
            whereClause = ' WHERE ' + conditions.join(' AND ');
        }

        const countResult = await pool.query(`SELECT COUNT(*) FROM (${baseQuery}) as t ${whereClause}`, queryParams);
        const total = parseInt(countResult.rows[0].count);

        const paginatedQuery = `SELECT * FROM (${baseQuery}) as t ${whereClause} ORDER BY t.created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}`;
        const result = await pool.query(paginatedQuery, [...queryParams, limit, offset]);
        
        return res.status(200).json({
            data: result.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err: any) {
        console.error("Error in getBatches for pcbaFctController.ts:", err);
        return sendError(res, err.message, 500);
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body;
    try {
        await pool.query(
            "UPDATE pcba_fct_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2",
            [deleted_by || 'system', id]
        );
        return sendSuccess(res, "Batch soft deleted");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};

export const createPcbaFctScan = async (req: Request, res: Response) => {
    const { work_order_id, batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const normalizedBarcode = (barcode || '').trim().toUpperCase();

        // --- USN-Orphan Recovery ---
        // If this barcode already has an ACCEPTED pcba_fct_scans record but NO USN mapping,
        // the operator previously closed the USN modal. Re-prompt them for the USN.
        if ((status || '').toUpperCase() === 'ACCEPTED' || !(status)) {
            const orphanCheck = await client.query(
                `SELECT pfs.id
                 FROM pcba_fct_scans pfs
                 JOIN pcba_fct_batches pb ON pfs.batch_id = pb.id
                 WHERE pfs.barcode = $1
                   AND pb.work_order_id = $2
                   AND pfs.status = 'ACCEPTED'
                   AND NOT EXISTS (
                       SELECT 1 FROM unit_serial_mapping usm WHERE usm.barcode = pfs.barcode
                   )
                 ORDER BY pfs.scanned_at DESC LIMIT 1`,
                [normalizedBarcode, work_order_id]
            );

            if ((orphanCheck.rowCount ?? 0) > 0) {
                await client.query('COMMIT');
                return res.status(200).json({
                    success: true,
                    message: "Unit Serial Number not yet linked. Please scan the Unit Serial Number sticker.",
                    data: {
                        scan: orphanCheck.rows[0],
                        counters: null,
                        requiresUnitSerial: true,
                        requiresUsnOnly: true
                    }
                });
            }
        }

        // --- Normal Scan Flow ---
        const scanResult = await processMESScan({
            client,
            batch_id,
            barcode: normalizedBarcode,
            scanned_by,
            status,
            remarks,
            resolution_remarks,
            failed_at,
            failed_remarks,
            stage_id: 5,
            prev_stage_id: 4,
            batch_table: 'pcba_fct_batches',
            scans_table: 'pcba_fct_scans',
            work_order_id
        });

        const finalStatus = (status || 'ACCEPTED').toUpperCase();
        const requiresUnitSerial = finalStatus === 'ACCEPTED';

        // Fetch updated counters
        const statsResult = await client.query(`
            SELECT 
                w.quantity as "workOrderQty",
                (SELECT COUNT(DISTINCT ps.barcode) FROM pth_scans ps JOIN pth_batches pb ON ps.batch_id = pb.id WHERE pb.work_order_id = w.id AND ps.status IN ('accepted', 'ACCEPTED', 'passed', 'PASSED')) as "previousStagePassed",
                stats.scanned,
                (w.quantity - stats.scanned) as pending,
                stats.passed,
                stats.rework,
                stats.debug,
                b.status
            FROM pcba_fct_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN LATERAL (
                WITH latest_scans AS (
                    SELECT DISTINCT ON (s.barcode) s.status
                    FROM pcba_fct_scans s
                    JOIN pcba_fct_batches pb ON s.batch_id = pb.id
                    WHERE pb.work_order_id = w.id
                    ORDER BY s.barcode, s.scanned_at DESC
                )
                SELECT 
                    COUNT(*)::int as scanned,
                    COUNT(*) FILTER (WHERE status IN ('accepted', 'passed', 'ACCEPTED', 'PASSED'))::int as passed,
                    COUNT(*) FILTER (WHERE status IN ('rework', 'REWORK'))::int as rework,
                    COUNT(*) FILTER (WHERE status IN ('debug', 'DEBUG'))::int as debug
                FROM latest_scans
            ) stats ON TRUE
            WHERE b.id = $1
            GROUP BY b.id, w.quantity, w.id, stats.scanned, stats.passed, stats.rework, stats.debug, b.status
        `, [batch_id]);

        const counters = statsResult.rows[0];

        await client.query('COMMIT');
        return res.status(200).json({
            success: true,
            message: "Scan completed successfully",
            data: {
                scan: scanResult,
                counters: counters,
                requiresUnitSerial,
                requiresUsnOnly: false
            }
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        return sendError(res, err.message);
    } finally {
        client.release();
    }
};

/**
 * POST /api/backend/pcba-fct/link-serial
 * Second mandatory step after PCBA-FCT PASS.
 * Links the PCB barcode to the Unit Serial Number sticker scanned by operator.
 */
export const linkUnitSerial = async (req: Request, res: Response) => {
    const { barcode, unit_serial_number, linked_by, batch_id, work_order_id } = req.body;

    if (!barcode || !unit_serial_number || !linked_by) {
        return sendError(res, "barcode, unit_serial_number, and linked_by are required");
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const normalizedBarcode = barcode.trim().toUpperCase();
        const normalizedUSN = unit_serial_number.trim().toUpperCase();

        // Validate PCB barcode passed PCBA-FCT
        const passedCheck = await client.query(
            `SELECT pfs.id FROM pcba_fct_scans pfs
             JOIN pcba_fct_batches pb ON pfs.batch_id = pb.id
             WHERE pfs.barcode = $1 AND pfs.status = 'ACCEPTED'
             ORDER BY pfs.scanned_at DESC LIMIT 1`,
            [normalizedBarcode]
        );
        if ((passedCheck.rowCount ?? 0) === 0) {
            throw new Error("Barcode has not passed PCBA-FCT. Cannot link Unit Serial Number.");
        }

        // Check USN not already used by another barcode
        const usnCheck = await client.query(
            `SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1`,
            [normalizedUSN]
        );
        if ((usnCheck.rowCount ?? 0) > 0) {
            const existingBarcode = usnCheck.rows[0].barcode;
            if (existingBarcode !== normalizedBarcode) {
                throw new Error(`Unit Serial Number "${normalizedUSN}" is already linked to barcode "${existingBarcode}".`);
            }
            // Same barcode → already linked (idempotent)
            await client.query('COMMIT');
            return sendSuccess(res, "Unit Serial Number already linked", { barcode: normalizedBarcode, unit_serial_number: normalizedUSN });
        }

        // Check this barcode not already linked to a different USN
        const barcodeCheck = await client.query(
            `SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1`,
            [normalizedBarcode]
        );
        if ((barcodeCheck.rowCount ?? 0) > 0) {
            throw new Error(`Barcode "${normalizedBarcode}" is already linked to Unit Serial Number "${barcodeCheck.rows[0].unit_serial_number}".`);
        }

        // Insert mapping
        await client.query(
            `INSERT INTO unit_serial_mapping (barcode, unit_serial_number, linked_by, work_order_id)
             VALUES ($1, $2, $3, $4)`,
            [normalizedBarcode, normalizedUSN, linked_by, work_order_id || null]
        );

        // Update the pcba_fct_scans record with the USN
        await client.query(
            `UPDATE pcba_fct_scans SET unit_serial_number = $1
             WHERE barcode = $2 AND status = 'ACCEPTED'`,
            [normalizedUSN, normalizedBarcode]
        );

        await client.query('COMMIT');
        return sendSuccess(res, "Unit Serial Number linked successfully", {
            barcode: normalizedBarcode,
            unit_serial_number: normalizedUSN,
            linked_by,
            linked_at: new Date()
        });
    } catch (err: any) {
        await client.query('ROLLBACK');
        return sendError(res, err.message, 500);
    } finally {
        client.release();
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    const { batchId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    try {
        const countResult = await pool.query('SELECT COUNT(*) FROM pcba_fct_scans WHERE batch_id = $1', [batchId]);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT pfs.*, usm.unit_serial_number as usn_from_map
             FROM pcba_fct_scans pfs
             LEFT JOIN unit_serial_mapping usm ON usm.barcode = pfs.barcode
             WHERE pfs.batch_id = $1
             ORDER BY pfs.scanned_at DESC LIMIT $2 OFFSET $3`,
            [batchId, limit, offset]
        );
        
        return res.status(200).json({
            data: result.rows,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err: any) {
        console.error("Error fetching scans:", err);
        return res.status(500).json({ error: err.message || "Failed to fetch scans" });
    }
};

export const updateScanStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;
    try {
        await pool.query(
            `UPDATE pcba_fct_scans SET status = $1, remarks = $2 WHERE id = $3`,
            [status, remarks, id]
        );
        return sendSuccess(res, "Status updated successfully");
    } catch (err: any) {
        return sendError(res, err.message, 500);
    }
};
