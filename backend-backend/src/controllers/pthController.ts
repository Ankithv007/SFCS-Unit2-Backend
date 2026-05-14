import { Request, Response } from 'express';
import pool from '../config/db';
import { sendSuccess, sendError } from '../utils/response';

export const createBatch = async (req: Request, res: Response) => {
    try {
        console.log("Incoming Create Batch Request:", req.body);
        const { work_order_id, created_by } = req.body;

        if (!work_order_id) {
            return res.status(400).json({ error: "work_order_id is required" });
        }
        if (!created_by) {
            return res.status(400).json({ error: "created_by is required" });
        }

        // Fetch Work Order number to use as Batch Number
        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) {
            return res.status(404).json({ error: "Work Order not found" });
        }
        const batch_number = woResult.rows[0].wo_number;

        // Create PTH batch
        const result = await pool.query(
            `INSERT INTO pth_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );

        // Ensure master_batches record exists for traceability
        await pool.query(
            `INSERT INTO master_batches (work_order_id, batch_number, created_by, status) 
             VALUES ($1, $2, $3, 'active') ON CONFLICT (batch_number) DO NOTHING`,
            [work_order_id, batch_number, created_by]
        );

        // Auto-create downstream stage batches so boards flow through immediately
        // When a board passes PTH, it should instantly be scannable at VI, QA, etc.
        const downstreamTables = [
            'vi_batches', 'qa_batches', 'flashing_batches', 'pcba_fct_batches',
            'assembly_batches', 'unit_testing_batches', 'qi_batches', 'packing_batches'
        ];
        for (const table of downstreamTables) {
            try {
                await pool.query(
                    `INSERT INTO ${table} (work_order_id, batch_number, created_by) 
                     VALUES ($1, $2, $3) ON CONFLICT (batch_number) DO NOTHING`,
                    [work_order_id, batch_number, created_by]
                );
            } catch (downstreamErr: any) {
                console.warn(`Warning: Could not auto-create batch in ${table}:`, downstreamErr.message);
            }
        }

        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("❌ Error creating PTH batch:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Batch for this Work Order already exists" });
        }
        res.status(500).json({ error: "Failed to create batch: " + err.message });
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
                stats.scanned,
                (w.quantity - stats.scanned) as pending,
                stats.passed,
                stats.rework,
                stats.debug,
                b.status
            FROM pth_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN LATERAL (
                WITH latest_scans AS (
                    SELECT DISTINCT ON (barcode) status
                    FROM pth_scans
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
        console.error("Error in getBatches for pthController.ts:", err);
        return res.status(500).json({ error: "Failed to fetch batches: " + err.message });
    }
};

export const completeBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query(
            "UPDATE pth_batches SET status = 'completed' WHERE id = $1",
            [id]
        );
        res.status(200).json({ message: "Batch completed" });
    } catch (err) {
        console.error("Error completing PTH batch:", err);
        res.status(500).json({ error: "Failed to complete batch" });
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { deleted_by } = req.body;
    try {
        await pool.query(
            "UPDATE pth_batches SET is_deleted = TRUE, deleted_at = CURRENT_TIMESTAMP, deleted_by = $1 WHERE id = $2",
            [deleted_by || 'system', id]
        );
        res.status(200).json({ message: "Batch soft deleted" });
    } catch (err) {
        console.error("Error deleting PTH batch:", err);
        res.status(500).json({ error: "Failed to delete batch" });
    }
};

import { processMESScan } from '../utils/mesLogic';

export const createPthScan = async (req: Request, res: Response) => {
    const { work_order_id, batch_id, barcode, scanned_by, status, remarks, resolution_remarks, failed_at, failed_remarks } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        console.log(`[PTH_SCAN_START] Barcode: ${barcode} | Batch ID: ${batch_id} | WO ID: ${work_order_id}`);

        const scanResult = await processMESScan({
            client,
            batch_id,
            barcode,
            scanned_by,
            status,
            remarks,
            resolution_remarks,
            failed_at,
            failed_remarks,
            stage_id: 1,
            prev_stage_id: null,
            batch_table: 'pth_batches',
            scans_table: 'pth_scans',
            work_order_id
        });

        // Fetch updated counters for real-time UI
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
            FROM pth_batches b
            JOIN work_orders w ON b.work_order_id = w.id
            LEFT JOIN LATERAL (
                WITH latest_scans AS (
                    SELECT DISTINCT ON (s.barcode) s.status
                    FROM pth_scans s
                    JOIN pth_batches pb ON s.batch_id = pb.id
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
                counters: counters
            }
        });

    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error("Error in createPthScan:", err);
        return sendError(res, err.message || "Failed to process scan");
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
        const countResult = await pool.query('SELECT COUNT(*) FROM pth_scans WHERE batch_id = $1', [batchId]);
        const total = parseInt(countResult.rows[0].count);

        const result = await pool.query(
            `SELECT 
                h.barcode,
                h.scanned_by,
                h.scanned_at,
                h.status,
                h.remarks,
                COALESCE(
                    h.failed_at,
                    (SELECT rs.scanned_at FROM rework_scans rs WHERE rs.barcode = h.barcode ORDER BY rs.scanned_at DESC LIMIT 1),
                    (SELECT ds.scanned_at FROM debug_scans ds WHERE ds.barcode = h.barcode ORDER BY ds.scanned_at DESC LIMIT 1)
                ) as remark_debug_time,
                COALESCE(
                    h.failed_remarks,
                    (SELECT rs.remarks FROM rework_scans rs WHERE rs.barcode = h.barcode ORDER BY rs.scanned_at DESC LIMIT 1),
                    (SELECT ds.remarks FROM debug_scans ds WHERE ds.barcode = h.barcode ORDER BY ds.scanned_at DESC LIMIT 1),
                    h.resolution_remarks
                ) as remark_debug_remarks
             FROM pth_scans h
             WHERE h.batch_id = $1
             ORDER BY h.scanned_at DESC
             LIMIT $2 OFFSET $3`,
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
            `UPDATE pth_scans 
             SET status = $1, remarks = $2 
             WHERE id = $3`,
            [status, remarks, id]
        );
        res.status(200).json({ message: "Updated" });
    } catch (err) {
        console.error("Error updating PTH scan status:", err);
        res.status(500).json({ error: "Failed to update status" });
    }
};

export const getPthDetailsByWoId = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const result = await pool.query(`SELECT * FROM work_orders WHERE id = $1`, [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: "Work Order not found" });
        res.status(200).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch details" });
    }
};

