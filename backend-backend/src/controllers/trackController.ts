import { Request, Response } from 'express';
import pool from '../config/db';

export const trackBarcode = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Barcode or Unit Serial Number is required.' });
    }

    const inputValue = id.trim().toUpperCase();

    try {
        // --- Dual Search: accept PCB barcode OR Unit Serial Number ---
        let barcode = inputValue;
        let unitSerialNumber: string | null = null;

        // Check if input is a Unit Serial Number
        const usnResult = await pool.query(
            `SELECT barcode, unit_serial_number FROM unit_serial_mapping WHERE unit_serial_number = $1`,
            [inputValue]
        );
        if ((usnResult.rowCount ?? 0) > 0) {
            barcode = usnResult.rows[0].barcode;
            unitSerialNumber = usnResult.rows[0].unit_serial_number;
        } else {
            // Input might be a PCB barcode — also try to find its linked USN
            const barcodeUsnResult = await pool.query(
                `SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1`,
                [inputValue]
            );
            if ((barcodeUsnResult.rowCount ?? 0) > 0) {
                unitSerialNumber = barcodeUsnResult.rows[0].unit_serial_number;
            }
        }

        // 1. Main tracking info (current state)
        const trackingResult = await pool.query(`
            SELECT 
                bt.barcode,
                bt.current_status,
                bt.failure_created_at,
                bt.repair_completed_at,
                bt.revalidated_passed_at,
                bt.last_updated_at,
                mb.batch_number,
                wo.wo_number,
                wo.customer_name,
                wo.model,
                wo.quantity,
                ps.stage_name AS current_stage
            FROM barcode_tracking bt
            LEFT JOIN master_batches mb ON bt.batch_id = mb.id
            LEFT JOIN work_orders wo ON mb.work_order_id = wo.id
            LEFT JOIN production_stages ps ON bt.current_stage_id = ps.id
            WHERE bt.barcode = $1
        `, [barcode]);

        if ((trackingResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `"${inputValue}" was not found in the system. Please check the barcode or Unit Serial Number.` });
        }

        const tracking = trackingResult.rows[0];

        // 2. Full scan history from ALL production stage tables
        const historyResult = await pool.query(`
            SELECT 'PTH'          AS station, 1  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, NULL::text AS unit_serial_number FROM pth_scans          WHERE barcode = $1
            UNION ALL
            SELECT 'VI'           AS station, 2  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, NULL::text AS unit_serial_number FROM vi_scans           WHERE barcode = $1
            UNION ALL
            SELECT 'QA'           AS station, 3  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, NULL::text AS unit_serial_number FROM qa_scans           WHERE barcode = $1
            UNION ALL
            SELECT 'Flashing'     AS station, 4  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, NULL::text AS unit_serial_number FROM flashing_scans     WHERE barcode = $1
            UNION ALL
            SELECT 'PCBA-FCT'     AS station, 5  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, unit_serial_number FROM pcba_fct_scans     WHERE barcode = $1
            UNION ALL
            SELECT 'Assembly'     AS station, 6  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, unit_serial_number FROM assembly_scans     WHERE barcode = $1
            UNION ALL
            SELECT 'Unit Testing' AS station, 7  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, unit_serial_number FROM unit_testing_scans WHERE barcode = $1
            UNION ALL
            SELECT 'QI'           AS station, 8  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, unit_serial_number FROM qi_scans           WHERE barcode = $1
            UNION ALL
            SELECT 'Packing'      AS station, 9  AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, NULL::text AS repair_remark, NULL::timestamptz AS repair_time, unit_serial_number FROM packing_scans      WHERE barcode = $1
            UNION ALL
            SELECT 'Rework'       AS station, 10 AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, repair_remark, repair_time, unit_serial_number FROM rework_scans WHERE barcode = $1
            UNION ALL
            SELECT 'Debug'        AS station, 11 AS stage_order, status, scanned_by, scanned_at, remarks, resolution_remarks, failed_at, failed_remarks, repair_remark, repair_time, unit_serial_number FROM debug_scans  WHERE barcode = $1
            ORDER BY scanned_at ASC
        `, [barcode]);

        const history = historyResult.rows.map((row: any) => ({
            station: row.station,
            stage_order: row.stage_order,
            status: (row.status || '').toUpperCase(),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            remarks: row.remarks || null,
            resolution_remarks: row.resolution_remarks || null,
            failed_at: row.failed_at || null,
            failed_remarks: row.failed_remarks || null,
            repair_remark: row.repair_remark || null,
            repair_time: row.repair_time || null,
            unit_serial_number: row.unit_serial_number || null,
        }));

        // 3. Compute summary stats
        const totalFailures = history.filter(h => h.status === 'REWORK' || h.status === 'DEBUG').length;
        const totalReworks = history.filter(h => h.station === 'Rework').length;
        const totalDebugs = history.filter(h => h.station === 'Debug').length;

        // 4. Compute "final status" label
        const status = (tracking.current_status || '').toUpperCase();
        let finalStatusLabel = 'IN PRODUCTION';
        if (status === 'ACCEPTED' && tracking.current_stage === 'Packing') {
            finalStatusLabel = 'COMPLETED';
        } else if (status === 'ACCEPTED') {
            finalStatusLabel = 'IN PRODUCTION';
        } else if (status === 'REWORK') {
            finalStatusLabel = 'IN REWORK';
        } else if (status === 'DEBUG') {
            finalStatusLabel = 'IN DEBUG';
        } else if (status === 'READY_FOR_RESCAN') {
            finalStatusLabel = 'REPAIR DONE – AWAITING RESCAN';
        }

        return res.status(200).json({
            barcode: tracking.barcode,
            unit_serial_number: unitSerialNumber,
            searched_by: inputValue !== barcode ? 'unit_serial_number' : 'barcode',
            batch_number: tracking.batch_number || '-',
            wo_number: tracking.wo_number || '-',
            customer_name: tracking.customer_name || '-',
            model: tracking.model || '-',
            quantity: tracking.quantity || '-',
            current_stage: tracking.current_stage || 'Unknown',
            current_status: status,
            final_status_label: finalStatusLabel,
            last_updated_at: tracking.last_updated_at,
            failure_created_at: tracking.failure_created_at,
            repair_completed_at: tracking.repair_completed_at,
            revalidated_passed_at: tracking.revalidated_passed_at,
            total_failures: totalFailures,
            total_reworks: totalReworks,
            total_debugs: totalDebugs,
            scan_history: history,
        });

    } catch (err: any) {
        console.error('❌ Error in trackBarcode:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};
