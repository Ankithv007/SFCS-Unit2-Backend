import { Request, Response } from 'express';
import pool from '../config/db';

// Get Completed IQC Batches (Available for Impedance)
// Get Completed IQC Batches (Available for Impedance)
export const getCompletedIQCBatches = async (req: Request, res: Response) => {
    try {
        console.log('Fetching Completed IQC Batches...');
        const result = await pool.query(`
            SELECT 
                b.*, 
                (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'ACCEPTED') as passed_count,
                (SELECT COUNT(*)::int FROM warehouse_scans s JOIN warehouse_batches wb ON s.batch_id = wb.id WHERE wb.batch_number = b.batch_number) as warehouse_received_quantity
            FROM iqc_batches b
            WHERE 
                -- Logic for Impedance Availability: Passed Count >= 5
                (SELECT COUNT(*) FROM iqc_components WHERE batch_id = b.id AND status = 'ACCEPTED') >= 1
                -- AND not already in Impedance
                AND b.id NOT IN (SELECT batch_id FROM impedance_sessions)
            ORDER BY b.created_at DESC
        `);
        console.log(`Found ${result.rows.length} available IQC batches for Impedance.`);
        if (result.rows.length === 0) {
            // Debug: Check if any batches exist at all in IQC with accepted items, ignoring the impedance_sessions check
            const debugCheck = await pool.query(`
                SELECT b.batch_number, b.id, 
                (SELECT COUNT(*) FROM iqc_components WHERE batch_id = b.id AND status = 'ACCEPTED') as passed,
                (SELECT COUNT(*) FROM impedance_sessions WHERE batch_id = b.id) as in_impedance
                FROM iqc_batches b
             `);
            console.log('DEBUG - All IQC Batches status:', debugCheck.rows);
        }
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching completed IQC batches:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Create a new Impedance Batch (Session)
export const createBatch = async (req: Request, res: Response) => {
    const { iqc_batch_id, created_by } = req.body;

    if (!iqc_batch_id || !created_by) {
        return res.status(400).json({ error: 'IQC Batch ID and Created By are required' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO impedance_sessions (batch_id, tested_by) VALUES ($1, $2) RETURNING *',
            [iqc_batch_id, created_by]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating impedance batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Scan PCB for Impedance
export const scanPcb = async (req: Request, res: Response) => {
    const { session_id, barcode, status, remarks } = req.body;

    if (!session_id || !barcode) {
        return res.status(400).json({ error: 'Session ID and Barcode are required' });
    }

    try {
        // 1. Validate against IQC (Must be ACCEPTED in IQC)
        // We check if this barcode exists in ANY IQC batch and is ACCEPTED.
        // Ideally, we might want to restrict to a specific batch if the session is tied to one,
        // but for now, we'll check global IQC status as per previous logic.
        // 1. Validate against IQC (Must be ACCEPTED in IQC)
        const iqcCheck = await pool.query(
            "SELECT * FROM iqc_components WHERE barcode = $1 ORDER BY scanned_at DESC LIMIT 1",
            [barcode]
        );

        if (iqcCheck.rows.length === 0) {
            return res.status(400).json({ error: 'PCB not found in IQC. Please complete IQC first.' });
        }

        const iqcComponent = iqcCheck.rows[0];
        if (iqcComponent.status !== 'ACCEPTED') {
            return res.status(400).json({ error: `PCB status in IQC is ${iqcComponent.status}. Only ACCEPTED components can be processed.` });
        }

        // 2. Check for Duplicate in Current Session
        const duplicateCheck = await pool.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 AND barcode = $2',
            [session_id, barcode]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ error: 'Duplicate scan! PCB already scanned in this session.' });
        }

        // 3. Record Scan (Accept test results from body, default to TRUE)
        const { tested_by, test_pa1, test_pa2, test_pa4, test_pa5, test_r160 } = req.body;

        // Determine initial status based on provided test results
        const isPass = (
            (test_pa1 !== false) &&
            (test_pa2 !== false) &&
            (test_pa4 !== false) &&
            (test_pa5 !== false) &&
            (test_r160 !== false)
        );
        const initialStatus = isPass ? 'ACCEPTED' : 'FAILED';

        const newScan = await pool.query(
            `INSERT INTO impedance_scans 
            (session_id, barcode, status, remarks, test_pa1, test_pa2, test_pa4, test_pa5, test_r160, tested_by) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                session_id,
                barcode,
                initialStatus,
                remarks,
                test_pa1 !== undefined ? test_pa1 : true,
                test_pa2 !== undefined ? test_pa2 : true,
                test_pa4 !== undefined ? test_pa4 : true,
                test_pa5 !== undefined ? test_pa5 : true,
                test_r160 !== undefined ? test_r160 : true,
                tested_by
            ]
        );

        res.status(201).json(newScan.rows[0]);
    } catch (error) {
        console.error('Error scanning PCB:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Update Test Result for a Scan
export const updateScanTestResult = async (req: Request, res: Response) => {
    const { scan_id } = req.params;
    const { test_name, result } = req.body; // test_name: 'test_pa1', result: boolean

    // Allow list of valid columns to prevent SQL injection
    const validTests = ['test_pa1', 'test_pa2', 'test_pa4', 'test_pa5', 'test_r160'];
    if (!validTests.includes(test_name)) {
        return res.status(400).json({ error: 'Invalid test name' });
    }

    try {
        // 1. Update the specific test result
        // We use dynamic column name safely because we validated it against the allowlist above
        await pool.query(
            `UPDATE impedance_scans SET ${test_name} = $1 WHERE id = $2`,
            [result, scan_id]
        );

        // 2. Recalculate Overall Status
        // If ALL tests are TRUE -> ACCEPTED
        // If ANY test is FALSE -> FAILED
        const updatedScan = await pool.query(
            `UPDATE impedance_scans 
             SET status = CASE 
                WHEN test_pa1 AND test_pa2 AND test_pa4 AND test_pa5 AND test_r160 THEN 'ACCEPTED'
                ELSE 'FAILED'
             END
             WHERE id = $1 RETURNING *`,
            [scan_id]
        );

        if (updatedScan.rows.length === 0) {
            return res.status(404).json({ error: 'Scan not found' });
        }

        res.json(updatedScan.rows[0]);
    } catch (error) {
        console.error('Error updating test result:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get Recent Sessions
export const getSessions = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT s.*, 
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id) as scan_count,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'ACCEPTED') as passed_count,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'FAILED') as failed_count,
            b.batch_number,
            (SELECT COUNT(*)::int FROM iqc_components c WHERE c.batch_id = b.id AND c.status = 'ACCEPTED') as iqc_passed_count
            FROM impedance_sessions s
            LEFT JOIN iqc_batches b ON s.batch_id = b.id
            ORDER BY s.started_at DESC
            LIMIT 50
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get Scans for a Session
export const getSessionScans = async (req: Request, res: Response) => {
    const { session_id } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 ORDER BY scanned_at DESC',
            [session_id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching session scans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Delete Impedance Batch (Session)
export const deleteBatch = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    try {
        // Delete scans first (cascade usually handles this but good to be explicit or if cascade not set)
        await pool.query('DELETE FROM impedance_scans WHERE session_id = $1', [batch_id]);
        // Delete session
        const result = await pool.query('DELETE FROM impedance_sessions WHERE id = $1 RETURNING *', [batch_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        res.json({ message: 'Batch deleted successfully' });
    } catch (error) {
        console.error('Error deleting impedance batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


// Download Impedance Batch Report as CSV
export const downloadBatchReport = async (req: Request, res: Response) => {
    const { batch_id } = req.params;

    try {
        // 1. Get Batch Details with calculations
        const batchResult = await pool.query(`
            SELECT s.*, b.batch_number, b.quantity as expected_quantity,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id) as total_scanned,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'ACCEPTED') as passed_count,
            (SELECT COUNT(*)::int FROM impedance_scans sc WHERE sc.session_id = s.id AND sc.status = 'FAILED') as failed_count
            FROM impedance_sessions s
            JOIN iqc_batches b ON s.batch_id = b.id
            WHERE s.id = $1
        `, [batch_id]);

        if (batchResult.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        const batch = batchResult.rows[0];

        // 2. Get All Scans
        const scansResult = await pool.query(
            'SELECT * FROM impedance_scans WHERE session_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        const scans = scansResult.rows;

        // 3. Generate CSV Content
        const formatDateTime = (dateStr: string) => {
            const d = new Date(dateStr);
            return d.toLocaleString('en-GB'); // DD/MM/YYYY, HH:mm:ss
        };

        // Section 1: Batch Summary
        const summaryHeaders = ['Batch Number', 'Tested By', 'Date & Time', 'Expected Qty', 'Total Scanned', 'Passed', 'Failed'];
        const summaryRow = [
            batch.batch_number,
            batch.tested_by,
            formatDateTime(batch.started_at),
            batch.expected_quantity,
            batch.total_scanned,
            batch.passed_count,
            batch.failed_count
        ];

        // Section 2: Scan Details
        const detailHeaders = ['Barcode', 'Status', 'Remarks', 'Scan Time'];
        const detailRows = scans.map(scan => [
            scan.barcode,
            scan.status,
            scan.remarks || '-',
            formatDateTime(scan.scanned_at)
        ]);

        // Combine into CSV string
        const csvContent = [
            summaryHeaders.join(','),
            summaryRow.map(field => `"${field}"`).join(','),
            '', // Empty line separator
            '', // Extra empty line for clarity
            detailHeaders.join(','),
            ...detailRows.map(row => row.map(field => `"${field}"`).join(','))
        ].join('\n');

        // 4. Send Response
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="impedance_batch_${batch.batch_number}.csv"`);
        res.status(200).send(csvContent);

    } catch (error) {
        console.error('Error downloading Impedance batch report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
// Search Component by Barcode (Traceability: Warehouse -> IQC -> Impedance)
export const searchComponent = async (req: Request, res: Response) => {
    const { barcode } = req.query;

    if (!barcode) {
        return res.status(400).json({ error: 'Barcode is required' });
    }

    try {
        // 1. Search in Impedance
        const impedanceResult = await pool.query(`
            SELECT s.*, sess.batch_id as iqc_batch_id 
            FROM impedance_scans s
            JOIN impedance_sessions sess ON s.session_id = sess.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at DESC
        `, [barcode]);

        // 2. Search in IQC
        const iqcResult = await pool.query(`
            SELECT c.*, b.batch_number 
            FROM iqc_components c
            JOIN iqc_batches b ON c.batch_id = b.id
            WHERE c.barcode = $1
            ORDER BY c.scanned_at DESC
        `, [barcode]);

        // 3. Search in Warehouse
        const warehouseResult = await pool.query(`
            SELECT s.*, b.batch_number as warehouse_batch_number, 
            (SELECT COUNT(*) FROM warehouse_scans ws WHERE ws.batch_id = b.id) as received_quantity
            FROM warehouse_scans s
            JOIN warehouse_batches b ON s.batch_id = b.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at DESC
        `, [barcode]);

        if (impedanceResult.rows.length === 0 && iqcResult.rows.length === 0 && warehouseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Component not found in any stage' });
        }

        // Construct Traceability Object
        const result = {
            barcode: barcode,
            warehouse: warehouseResult.rows.length > 0 ? {
                status: 'Received',
                batch_number: warehouseResult.rows[0].warehouse_batch_number,
                received_quantity: warehouseResult.rows[0].received_quantity,
                scanned_at: warehouseResult.rows[0].scanned_at
            } : { status: 'Not Scanned' },

            iqc: iqcResult.rows.length > 0 ? {
                status: iqcResult.rows[0].status,
                batch_number: iqcResult.rows[0].batch_number,
                batch_id: iqcResult.rows[0].batch_id,
                scanned_at: iqcResult.rows[0].scanned_at
            } : { status: 'Pending' },

            impedance: impedanceResult.rows.length > 0 ? {
                status: impedanceResult.rows[0].status === 'ACCEPTED' ? 'Passed' : 'Failed',
                scanned_at: impedanceResult.rows[0].scanned_at
            } : { status: 'Pending' }
        };

        // Apply Status Rules
        // If IQC Failed -> Impedance must show Failed (even if not scanned or previously passed)
        if (result.iqc.status === 'REJECTED') {
            result.impedance.status = 'Failed (IQC Rejected)';
        }

        res.json(result);

    } catch (error) {
        console.error('Error searching component:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
