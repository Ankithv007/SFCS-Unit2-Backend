import { Request, Response } from 'express';
import pool from '../config/db';

export const trackBarcode = async (req: Request, res: Response) => {
    const { barcode } = req.params;
    try {
        const { id } = req.params; // This will be the barcode or batch_number
        const { type } = req.query; // 'serial' or 'batch'

        if (!id) {
            return res.status(400).json({ error: "Search term is required" });
        }

        if (type === 'serial') {
            // Track single serial number across all stations
            const query = `
                SELECT 'PTH' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM pth_scans WHERE barcode = $1
                UNION ALL
                SELECT 'VI' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM vi_scans WHERE barcode = $1
                UNION ALL
                SELECT 'QA' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM qa_scans WHERE barcode = $1
                UNION ALL
                SELECT 'QI' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM qi_scans WHERE barcode = $1
                UNION ALL
                SELECT 'Unit Testing' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM unit_testing_scans WHERE barcode = $1
                UNION ALL
                SELECT 'Assembly' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM assembly_scans WHERE barcode = $1
                UNION ALL
                SELECT 'PCBA-FCT' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM pcba_fct_scans WHERE barcode = $1
                UNION ALL
                SELECT 'Flashing' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM flashing_scans WHERE barcode = $1
                UNION ALL
                SELECT 'Packing' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM packing_scans WHERE barcode = $1
                UNION ALL
                SELECT 'Remark' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM remark_scans WHERE barcode = $1
                UNION ALL
                SELECT 'Debug' as station, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks FROM debug_scans WHERE barcode = $1
                ORDER BY scanned_at ASC
            `;
            const result = await pool.query(query, [id]);
            
            // Format the result
            const history = result.rows.map(row => ({
                station: row.station,
                status: row.status,
                scanned_by: row.scanned_by,
                scanned_at: row.scanned_at,
                remarks: row.remarks || null,
                resolution_remarks: row.resolution_remarks || null,
                failed_at: row.failed_at || null,
                failed_remarks: row.failed_remarks || null
            }));

            res.status(200).json({ type: 'serial', id, history });
        } else {
            return res.status(400).json({ error: "Batch tracking is not implemented yet. Please search by serial." });
        }
    } catch (err: any) {
        console.error("❌ Error tracking item:", err);
        res.status(500).json({ error: "Failed to track item: " + err.message });
    }
};
