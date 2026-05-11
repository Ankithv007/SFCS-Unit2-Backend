import { Request, Response } from 'express';
import pool from '../config/db';

export const trackBarcode = async (req: Request, res: Response) => {
    const { barcode } = req.params;
    try {
        const query = `
            SELECT 'PTH' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM pth_scans WHERE barcode = $1
            UNION ALL
            SELECT 'VI' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM vi_scans WHERE barcode = $1
            UNION ALL
            SELECT 'QA' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM qa_scans WHERE barcode = $1
            UNION ALL
            SELECT 'Flashing' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM flashing_scans WHERE barcode = $1
            UNION ALL
            SELECT 'PCBA-FCT' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM pcba_fct_scans WHERE barcode = $1
            UNION ALL
            SELECT 'Assembly' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM assembly_scans WHERE barcode = $1
            UNION ALL
            SELECT 'Unit Testing' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM unit_testing_scans WHERE barcode = $1
            UNION ALL
            SELECT 'QI' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM qi_scans WHERE barcode = $1
            UNION ALL
            SELECT 'Packing' as station, scanned_at, scanned_by, status, remarks, resolution_remarks FROM packing_scans WHERE barcode = $1
            ORDER BY scanned_at ASC
        `;
        const result = await pool.query(query, [barcode]);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error tracking barcode:", err);
        res.status(500).json({ error: "Failed to track barcode" });
    }
};
