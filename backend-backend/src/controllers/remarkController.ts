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

        // Fetch Work Order number to use as Batch Number
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
            SELECT *, (total_remarked + scanned_qty) as wo_qty FROM (
                SELECT 
                    b.*, 
                    w.wo_number, 
                    w.customer_name,
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
                            UNION
                            SELECT barcode FROM packing_scans ps JOIN packing_batches pb ON ps.batch_id = pb.id WHERE ps.status IN ('remark', 'REMARK') AND (ps.resolution_remarks IS NULL OR ps.resolution_remarks <> 'Fixed') AND pb.work_order_id = w.id
                        ) as pending
                    ) as total_remarked
                FROM remark_batches b
                JOIN work_orders w ON b.work_order_id = w.id
                LEFT JOIN remark_scans s ON s.batch_id = b.id
                GROUP BY b.id, w.wo_number, w.customer_name, w.quantity, w.id
            ) as sub
            ORDER BY created_at DESC
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
            SELECT station FROM (
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
                UNION ALL
                SELECT 'Packing' as station FROM packing_scans WHERE barcode = $1 AND status IN ('remark', 'REMARK') AND (resolution_remarks IS NULL OR resolution_remarks <> 'Fixed')
            ) as stations LIMIT 1
        `;

        const checkResult = await pool.query(checkQuery, [barcode]);

        if (checkResult.rows.length === 0) {
            return res.status(400).json({ error: "This item is not marked as remark" });
        }

        const stage = checkResult.rows[0].station;

        const final_failed_at = failed_at || ((status && (status.toLowerCase() === 'remark' || status.toLowerCase() === 'debug')) ? new Date() : null);
        const final_failed_remarks = failed_remarks || ((status && (status.toLowerCase() === 'remark' || status.toLowerCase() === 'debug')) ? remarks : null);

        const result = await pool.query(
            `INSERT INTO remark_scans (batch_id, barcode, scanned_by, status, remarks, stage, failed_at, failed_remarks, resolution_remarks) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [batch_id, barcode, scanned_by, status || 'accepted', remarks, stage, final_failed_at, final_failed_remarks, 
             (status && status.toLowerCase() === 'accepted') ? remarks : null]
        );

        // If marked as 'accepted' (Pass/Fixed), update the original station's record
        if (status === 'accepted' || status === 'ACCEPTED') {
            const stations = [
                'pth_scans', 'vi_scans', 'qa_scans', 'flashing_scans',
                'pcba_fct_scans', 'assembly_scans', 'unit_testing_scans',
                'qi_scans', 'packing_scans'
            ];

            for (const table of stations) {
                await pool.query(
                    `UPDATE ${table} SET resolution_remarks = 'Fixed' 
                     WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                    [barcode]
                );
            }
        }

        res.status(201).json(result.rows[0]);
    } catch (err: any) {
        console.error("Error creating Remark scan:", err);
        if (err.code === '23505') {
            return res.status(400).json({ error: "Barcode already scanned" });
        }
        res.status(500).json({ error: "Failed to scan item" });
    }
};

export const getLatestResolution = async (req: Request, res: Response) => {
    const { barcode } = req.params;
    try {
        const result = await pool.query(
            `(SELECT remarks, scanned_at FROM remark_scans WHERE barcode = $1 AND status IN ('accepted', 'ACCEPTED'))
             UNION ALL
             (SELECT remarks, scanned_at FROM debug_scans WHERE barcode = $1 AND status IN ('accepted', 'ACCEPTED'))
             ORDER BY scanned_at DESC LIMIT 1`,
            [barcode]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "No resolution found" });
        }
        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error("Error fetching latest resolution:", err);
        res.status(500).json({ error: "Failed to fetch resolution" });
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
        const stations = [
            'pth_scans', 'vi_scans', 'qa_scans', 'flashing_scans',
            'pcba_fct_scans', 'assembly_scans', 'unit_testing_scans',
            'qi_scans', 'packing_scans'
        ];

        for (const table of stations) {
            await pool.query(
                `UPDATE ${table} SET resolution_remarks = 'Closed' 
                 WHERE barcode = $1 AND status IN ('remark', 'REMARK')`,
                [barcode]
            );
        }
        res.status(200).json({ message: "Item closed/dismissed" });
    } catch (err) {
        console.error("Error closing pending item:", err);
        res.status(500).json({ error: "Failed to close item" });
    }
};

export const getPendingRemarkItems = async (req: Request, res: Response) => {
    try {
        const query = `
            SELECT 'PTH' as station, w.wo_number as batch_number, p.barcode, p.scanned_by, p.scanned_at, p.remarks 
            FROM pth_scans p 
            JOIN work_orders w ON p.work_order_id = w.id 
            WHERE p.status IN ('remark', 'REMARK') AND (p.resolution_remarks IS NULL OR p.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'VI' as station, vb.batch_number, vs.barcode, vs.scanned_by, vs.scanned_at, CONCAT(vs.reason, ': ', vs.remarks) as remarks 
            FROM vi_scans vs 
            JOIN vi_batches vb ON vs.batch_id = vb.id 
            WHERE vs.status IN ('remark', 'REMARK') AND (vs.resolution_remarks IS NULL OR vs.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'QA' as station, qb.batch_number, qs.barcode, qs.scanned_by, qs.scanned_at, qs.remarks 
            FROM qa_scans qs 
            JOIN qa_batches qb ON qs.batch_id = qb.id 
            WHERE qs.status IN ('remark', 'REMARK') AND (qs.resolution_remarks IS NULL OR qs.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'Flashing' as station, fb.batch_number, fs.barcode, fs.scanned_by, fs.scanned_at, fs.remarks 
            FROM flashing_scans fs 
            JOIN flashing_batches fb ON fs.batch_id = fb.id 
            WHERE fs.status IN ('remark', 'REMARK') AND (fs.resolution_remarks IS NULL OR fs.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'PCBA-FCT' as station, pfb.batch_number, pfs.barcode, pfs.scanned_by, pfs.scanned_at, pfs.remarks 
            FROM pcba_fct_scans pfs 
            JOIN pcba_fct_batches pfb ON pfs.batch_id = pfb.id 
            WHERE pfs.status IN ('remark', 'REMARK') AND (pfs.resolution_remarks IS NULL OR pfs.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'Assembly' as station, ab.batch_number, assans.barcode, assans.scanned_by, assans.scanned_at, assans.remarks 
            FROM assembly_scans assans 
            JOIN assembly_batches ab ON assans.batch_id = ab.id 
            WHERE assans.status IN ('remark', 'REMARK') AND (assans.resolution_remarks IS NULL OR assans.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'Unit Testing' as station, utb.batch_number, uts.barcode, uts.scanned_by, uts.scanned_at, uts.remarks 
            FROM unit_testing_scans uts 
            JOIN unit_testing_batches utb ON uts.batch_id = utb.id 
            WHERE uts.status IN ('remark', 'REMARK') AND (uts.resolution_remarks IS NULL OR uts.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'QI' as station, qib.batch_number, qis.barcode, qis.scanned_by, qis.scanned_at, qis.remarks 
            FROM qi_scans qis 
            JOIN qi_batches qib ON qis.batch_id = qib.id 
            WHERE qis.status IN ('remark', 'REMARK') AND (qis.resolution_remarks IS NULL OR qis.resolution_remarks <> 'Fixed')
            
            UNION ALL
            
            SELECT 'Packing' as station, pb.batch_number, ps.barcode, ps.scanned_by, ps.scanned_at, ps.remarks 
            FROM packing_scans ps 
            JOIN packing_batches pb ON ps.batch_id = pb.id 
            WHERE ps.status IN ('remark', 'REMARK') AND (ps.resolution_remarks IS NULL OR ps.resolution_remarks <> 'Fixed')
            
            ORDER BY scanned_at DESC
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err: any) {
        console.error("Error fetching pending remark items:", err);
        res.status(500).json({ error: "Failed to fetch items: " + err.message });
    }
};
