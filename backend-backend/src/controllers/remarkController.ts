import { Request, Response } from 'express';
import pool from '../config/db';

export const createBatch = async (req: Request, res: Response) => {
    try {
        const { work_order_id, created_by } = req.body;

        if (!work_order_id) {
            return res.status(400).json({ error: "work_order_id is required" });
        }
        if (!created_by) {
            return res.status(400).json({ error: "created_by is required" });
        }

        const woResult = await pool.query('SELECT wo_number FROM work_orders WHERE id = $1', [work_order_id]);
        if (woResult.rowCount === 0) {
            return res.status(404).json({ error: "Work Order not found" });
        }
        const batch_number = woResult.rows[0].wo_number;

        const result = await pool.query(
            `INSERT INTO remark_batches (work_order_id, batch_number, created_by) 
             VALUES ($1, $2, $3) RETURNING *`,
            [work_order_id, batch_number, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("❌ Error creating Remark batch:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Batch for this Work Order already exists" });
        }
        res.status(500).json({ error: "Failed to create batch: " + err.message });
    }
};

export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                w.id as work_order_id,
                w.wo_number,
                w.customer_name,
                (SELECT COUNT(*) FROM pcba_fct_scans pfs JOIN pcba_fct_batches pfb ON pfs.batch_id = pfb.id WHERE pfb.work_order_id = w.id AND pfs.status IN ('accepted', 'ACCEPTED')) as wo_qty,
                COUNT(DISTINCT s.id) as scanned_qty,
                COUNT(DISTINCT CASE WHEN s.status IN ('accepted', 'ACCEPTED') THEN s.id END) as passed,
                (
                    SELECT COUNT(DISTINCT barcode) FROM (
                        SELECT barcode FROM pth_scans WHERE status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed') AND work_order_id = w.id
                        UNION
                        SELECT barcode FROM vi_scans vs JOIN vi_batches vb ON vs.batch_id = vb.id WHERE vs.status IN ('remark', 'REMARK') AND (vs.resolution_remarks IS NULL OR vs.resolution_remarks <> 'Fixed') AND vb.work_order_id = w.id
                        UNION
                        SELECT barcode FROM qa_scans qs JOIN qa_batches qb ON qs.batch_id = qb.id WHERE qs.status IN ('remark', 'REMARK') AND (qs.resolution_remarks IS NULL OR qs.resolution_remarks <> 'Fixed') AND qb.work_order_id = w.id
                        UNION
                        SELECT barcode FROM flashing_scans fs JOIN flashing_batches fb ON fs.batch_id = fb.id WHERE fs.status IN ('remark', 'REMARK') AND (fs.resolution_remarks IS NULL OR fs.resolution_remarks <> 'Fixed') AND fb.work_order_id = w.id
                        UNION
                        SELECT barcode FROM pcba_fct_scans pfs JOIN pcba_fct_batches pfb ON pfs.batch_id = pfb.id WHERE pfs.status IN ('remark', 'REMARK') AND (pfs.resolution_remarks IS NULL OR pfs.resolution_remarks <> 'Fixed') AND pfb.work_order_id = w.id
                        UNION
                        SELECT barcode FROM assembly_scans assans JOIN assembly_batches ab ON assans.batch_id = ab.id WHERE assans.status IN ('remark', 'REMARK') AND (assans.resolution_remarks IS NULL OR assans.resolution_remarks <> 'Fixed') AND ab.work_order_id = w.id
                        UNION
                        SELECT barcode FROM unit_testing_scans uts JOIN unit_testing_batches utb ON uts.batch_id = utb.id WHERE uts.status IN ('remark', 'REMARK') AND (uts.resolution_remarks IS NULL OR uts.resolution_remarks <> 'Fixed') AND utb.work_order_id = w.id
                        UNION
                        SELECT barcode FROM qi_scans qis JOIN qi_batches qib ON qis.batch_id = qib.id WHERE qis.status IN ('remark', 'REMARK') AND (qis.resolution_remarks IS NULL OR qis.resolution_remarks <> 'Fixed') AND qib.work_order_id = w.id
                    ) as pending
                ) as remark,
                (SELECT COUNT(*) FROM debug_scans ds JOIN debug_batches db ON ds.batch_id = db.id WHERE db.work_order_id = w.id AND ds.status IN ('debug', 'DEBUG') AND (ds.resolution_remarks IS NULL OR ds.resolution_remarks <> 'Fixed')) as debug
            FROM work_orders w
            LEFT JOIN remark_batches b ON b.work_order_id = w.id
            LEFT JOIN remark_scans s ON s.batch_id = b.id
            GROUP BY w.id, w.wo_number, w.customer_name
            HAVING (
                SELECT COUNT(*) FROM (
                    SELECT barcode FROM pth_scans WHERE status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed') AND work_order_id = w.id
                    UNION
                    SELECT barcode FROM vi_scans vs JOIN vi_batches vb ON vs.batch_id = vb.id WHERE vs.status IN ('remark', 'REMARK') AND (vs.resolution_remarks IS NULL OR vs.resolution_remarks <> 'Fixed') AND vb.work_order_id = w.id
                    UNION
                    SELECT barcode FROM qa_scans qs JOIN qa_batches qb ON qs.batch_id = qb.id WHERE qs.status IN ('remark', 'REMARK') AND (qs.resolution_remarks IS NULL OR qs.resolution_remarks <> 'Fixed') AND qb.work_order_id = w.id
                    UNION
                    SELECT barcode FROM flashing_scans fs JOIN flashing_batches fb ON fs.batch_id = fb.id WHERE fs.status IN ('remark', 'REMARK') AND (fs.resolution_remarks IS NULL OR fs.resolution_remarks <> 'Fixed') AND fb.work_order_id = w.id
                    UNION
                    SELECT barcode FROM pcba_fct_scans pfs JOIN pcba_fct_batches pfb ON pfs.batch_id = pfb.id WHERE pfs.status IN ('remark', 'REMARK') AND (pfs.resolution_remarks IS NULL OR pfs.resolution_remarks <> 'Fixed') AND pfb.work_order_id = w.id
                    UNION
                    SELECT barcode FROM assembly_scans assans JOIN assembly_batches ab ON assans.batch_id = ab.id WHERE assans.status IN ('remark', 'REMARK') AND (assans.resolution_remarks IS NULL OR assans.resolution_remarks <> 'Fixed') AND ab.work_order_id = w.id
                    UNION
                    SELECT barcode FROM unit_testing_scans uts JOIN unit_testing_batches utb ON uts.batch_id = utb.id WHERE uts.status IN ('remark', 'REMARK') AND (uts.resolution_remarks IS NULL OR uts.resolution_remarks <> 'Fixed') AND utb.work_order_id = w.id
                    UNION
                    SELECT barcode FROM qi_scans qis JOIN qi_batches qib ON qis.batch_id = qib.id WHERE qis.status IN ('remark', 'REMARK') AND (qis.resolution_remarks IS NULL OR qis.resolution_remarks <> 'Fixed') AND qib.work_order_id = w.id
                ) as p
            ) > 0 OR COUNT(s.id) > 0
            ORDER BY w.created_at DESC
        `);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching Remark batches:", err);
        res.status(500).json({ error: "Failed to fetch batches" });
    }
};

export const deleteBatch = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query("DELETE FROM remark_batches WHERE id = $1", [id]);
        res.status(200).json({ message: "Batch deleted" });
    } catch (err) {
        console.error("Error deleting Remark batch:", err);
        res.status(500).json({ error: "Failed to delete batch" });
    }
};

export const createRemarkScan = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by, status, remarks, failed_at, failed_remarks } = req.body;
    try {
        // Validation: Find where the barcode was marked as 'remark'
        const checkQuery = `
            SELECT 'PTH' as station FROM pth_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'VI' as station FROM vi_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'QA' as station FROM qa_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'Flashing' as station FROM flashing_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'PCBA-FCT' as station FROM pcba_fct_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'Assembly' as station FROM assembly_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'Unit Testing' as station FROM unit_testing_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'QI' as station FROM qi_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            LIMIT 1
        `;
        const checkResult = await pool.query(checkQuery, [barcode]);

        if (checkResult.rowCount === 0) {
            return res.status(400).json({ error: "Barcode not found in any station's Remark list" });
        }

        const stage = checkResult.rows[0].station;

        const final_failed_at = failed_at || ((status && (status.toLowerCase() === 'remark' || status.toLowerCase() === 'debug')) ? new Date() : null);
        const final_failed_remarks = failed_remarks || ((status && (status.toLowerCase() === 'remark' || status.toLowerCase() === 'debug')) ? remarks : null);

        const result = await pool.query(
            `INSERT INTO remark_scans (batch_id, barcode, scanned_by, status, remarks, stage, failed_at, failed_remarks) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [batch_id, barcode, scanned_by, status || 'accepted', remarks, stage, final_failed_at, final_failed_remarks]
        );

        // If marked as 'accepted' (Pass/Fixed), update the original station's record
        if (status && (status.toLowerCase() === 'accepted')) {
            const updateQueries = [
                `UPDATE pth_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                `UPDATE vi_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                `UPDATE qa_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                `UPDATE flashing_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                `UPDATE pcba_fct_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                `UPDATE assembly_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                `UPDATE unit_testing_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                `UPDATE qi_scans SET resolution_remarks = 'Fixed', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`
            ];
            for (const q of updateQueries) {
                await pool.query(q, [barcode]);
            }
        }

        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating Remark scan:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Barcode already scanned in this batch" });
        }
        res.status(500).json({ error: "Failed to scan item" });
    }
};

export const getScansByBatchId = async (req: Request, res: Response) => {
    const { batchId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM remark_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batchId]
        );
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching Remark batch scans:", err);
        res.status(500).json({ error: "Failed to fetch scans" });
    }
};

export const updateScanStatus = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, remarks } = req.body;
    try {
        await pool.query(
            `UPDATE remark_scans 
             SET status = $1, remarks = $2 
             WHERE id = $3`,
            [status, remarks, id]
        );
        res.status(200).json({ message: "Updated" });
    } catch (err) {
        console.error("Error updating Remark scan status:", err);
        res.status(500).json({ error: "Failed to update status" });
    }
};

export const closePendingItem = async (req: Request, res: Response) => {
    const { barcode } = req.params;
    try {
        const updateQueries = [
            `UPDATE pth_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
            `UPDATE vi_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
            `UPDATE qa_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
            `UPDATE flashing_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
            `UPDATE pcba_fct_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
            `UPDATE assembly_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
            `UPDATE unit_testing_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
            `UPDATE qi_scans SET status = 'Closed', resolution_remarks = 'Closed Manually', resolved_at = NOW() WHERE barcode = $1 AND status IN ('remark', 'REMARK')`
        ];
        for (const q of updateQueries) {
            await pool.query(q, [barcode]);
        }
        res.status(200).json({ message: "Item closed successfully" });
    } catch (err) {
        console.error("Error closing pending item:", err);
        res.status(500).json({ error: "Failed to close item" });
    }
};

export const getPendingRemarkItems = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 'PTH' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM pth_scans s
            JOIN pth_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'VI' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM vi_scans s
            JOIN vi_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'QA' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM qa_scans s
            JOIN qa_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'Flashing' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM flashing_scans s
            JOIN flashing_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'PCBA-FCT' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM pcba_fct_scans s
            JOIN pcba_fct_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'Assembly' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM assembly_scans s
            JOIN assembly_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'Unit Testing' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM unit_testing_scans s
            JOIN unit_testing_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            UNION ALL
            SELECT 'QI' as station, s.barcode, b.batch_number, s.scanned_by, s.scanned_at, s.remarks
            FROM qi_scans s
            JOIN qi_batches b ON s.batch_id = b.id
            WHERE s.status IN ('remark', 'REMARK') AND (s.resolution_remarks IS NULL OR s.resolution_remarks <> 'Fixed')
            ORDER BY scanned_at DESC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching pending remark items:", err);
        res.status(500).json({ error: "Failed to fetch pending items" });
    }
};

export const getLatestResolution = async (req: Request, res: Response) => {
    const { barcode } = req.params;
    try {
        const result = await pool.query(
            "SELECT status, remarks, resolution_remarks FROM remark_scans WHERE barcode = $1 ORDER BY scanned_at DESC LIMIT 1",
            [barcode]
        );
        res.status(200).json(result.rows[0] || null);
    } catch (err) {
        console.error("Error fetching latest resolution:", err);
        res.status(500).json({ error: "Failed to fetch resolution" });
    }
};
