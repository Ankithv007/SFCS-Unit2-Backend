import { Request, Response } from 'express';
import pool from '../config/db';

// Create a new Warehouse Batch
export const createBatch = async (req: Request, res: Response) => {
    const { batch_number, created_by, expected_quantity } = req.body;

    if (!batch_number || !created_by || !expected_quantity) {
        return res.status(400).json({ error: 'Batch Number, Created By, and Expected Quantity are required' });
    }

    // Validate Batch Number Format: PREVEYYYYMMDD-XXXXX
    // Regex: Starts with PREVE, followed by 8 digits (YYYYMMDD), a hyphen, and 1-5 digits.
    const batchRegex = /^PREVE\d{8}-\d{1,5}$/;
    if (!batchRegex.test(batch_number)) {
        return res.status(400).json({ error: 'Invalid Batch Number Format. Expected: PREVEYYYYMMDD-XXXXX' });
    }

    try {
        const newBatch = await pool.query(
            'INSERT INTO warehouse_batches (batch_number, created_by, expected_quantity) VALUES ($1, $2, $3) RETURNING *',
            [batch_number, created_by, expected_quantity]
        );
        res.status(201).json(newBatch.rows[0]);
    } catch (error: any) {
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({ error: 'Batch number already exists' });
        }
        console.error('Error creating warehouse batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all Warehouse Batches with calculations
export const getBatches = async (req: Request, res: Response) => {
    try {
        const result = await pool.query(`
            SELECT 
                b.*,
                COALESCE(s.scan_count, 0)::int as received_quantity,
                GREATEST(0, COALESCE(s.scan_count, 0) - b.expected_quantity)::int as extra_quantity,
                GREATEST(0, b.expected_quantity - COALESCE(s.scan_count, 0))::int as shortage_quantity
            FROM warehouse_batches b
            LEFT JOIN (
                SELECT batch_id, COUNT(*) as scan_count 
                FROM warehouse_scans 
                GROUP BY batch_id
            ) s ON b.id = s.batch_id
            ORDER BY b.created_at DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching warehouse batches:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Scan item into Warehouse Batch
export const scanItem = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by } = req.body;

    if (!batch_id || !barcode || !scanned_by) {
        return res.status(400).json({ error: 'Batch ID, Barcode, and Scanned By are required' });
    }

    try {
        // Check if batch exists
        const batchCheck = await pool.query('SELECT * FROM warehouse_batches WHERE id = $1', [batch_id]);
        if (batchCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        // Check for duplicate scan in the same batch
        const duplicateCheck = await pool.query(
            'SELECT * FROM warehouse_scans WHERE batch_id = $1 AND barcode = $2',
            [batch_id, barcode]
        );

        if (duplicateCheck.rows.length > 0) {
            return res.status(409).json({ error: 'Duplicate scan! Item already scanned in this batch.' });
        }

        // Check for previous history in OTHER batches
        const historyCheck = await pool.query(
            `SELECT s.*, b.batch_number 
             FROM warehouse_scans s
             JOIN warehouse_batches b ON s.batch_id = b.id
             WHERE s.barcode = $1 AND s.batch_id != $2
             ORDER BY s.scanned_at DESC LIMIT 1`,
            [barcode, batch_id]
        );

        let previousBatchInfo = null;
        if (historyCheck.rows.length > 0) {
            const prev = historyCheck.rows[0];
            previousBatchInfo = `Batch ${prev.batch_number}`;
        }

        // Record scan
        const newScan = await pool.query(
            'INSERT INTO warehouse_scans (batch_id, barcode, scanned_by, previous_batch) VALUES ($1, $2, $3, $4) RETURNING *',
            [batch_id, barcode, scanned_by, previousBatchInfo]
        );

        res.status(201).json(newScan.rows[0]);
    } catch (error) {
        console.error('Error scanning warehouse item:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get scans for a specific batch
export const getBatchScans = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    try {
        const scans = await pool.query(
            'SELECT * FROM warehouse_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        res.json(scans.rows);
    } catch (error) {
        console.error('Error fetching warehouse scans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Delete Warehouse Batch and associated scans
export const deleteBatch = async (req: Request, res: Response) => {
    const { batch_id } = req.params;
    const userRole = (req as any).user?.role;
    console.log('Delete Batch Request - User Role:', userRole);

    if (userRole !== 'Admin' && userRole !== 'Super Admin' && userRole !== 'Manager') {
        return res.status(403).json({ error: `Only Admin, Super Admin, or Manager can delete this batch. Your role: ${userRole}` });
    }

    try {
        // 1. Delete Warehouse Scans
        await pool.query('DELETE FROM warehouse_scans WHERE batch_id = $1', [batch_id]);

        // 2. Delete Warehouse Batch
        const result = await pool.query('DELETE FROM warehouse_batches WHERE id = $1 RETURNING *', [batch_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }

        res.json({ message: 'Warehouse batch deleted successfully' });
    } catch (error) {
        console.error('Error deleting warehouse batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Download Batch Report as CSV (Excel-friendly)
export const downloadBatchReport = async (req: Request, res: Response) => {
    const { batch_id } = req.params;

    try {
        // 1. Get Batch Details with calculations
        const batchResult = await pool.query(`
            SELECT 
                b.*,
                COALESCE(s.scan_count, 0)::int as received_quantity,
                GREATEST(0, COALESCE(s.scan_count, 0) - b.expected_quantity)::int as extra_quantity,
                GREATEST(0, b.expected_quantity - COALESCE(s.scan_count, 0))::int as shortage_quantity
            FROM warehouse_batches b
            LEFT JOIN (
                SELECT batch_id, COUNT(*) as scan_count 
                FROM warehouse_scans 
                GROUP BY batch_id
            ) s ON b.id = s.batch_id
            WHERE b.id = $1
        `, [batch_id]);

        if (batchResult.rows.length === 0) {
            return res.status(404).json({ error: 'Batch not found' });
        }
        const batch = batchResult.rows[0];

        // 2. Get All Scans
        const scansResult = await pool.query(
            'SELECT * FROM warehouse_scans WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        const scans = scansResult.rows;

        // 3. Generate CSV Content
        // Helper to format date and time
        const formatDateTime = (dateStr: string) => {
            const d = new Date(dateStr);
            return d.toLocaleString('en-GB'); // DD/MM/YYYY, HH:mm:ss
        };

        // Section 1: Batch Summary
        const summaryHeaders = ['Batch Number', 'Created By', 'Date & Time', 'Expected Qty', 'Extra Qty', 'Shortage Qty', 'Total Count'];
        const summaryRow = [
            batch.batch_number,
            batch.created_by,
            formatDateTime(batch.created_at),
            batch.expected_quantity,
            batch.extra_quantity,
            batch.shortage_quantity,
            batch.received_quantity
        ];

        // Section 2: Scan Details
        const detailHeaders = ['Barcode', 'Scanned By', 'Date & Time', 'Previous Batch', 'Status'];
        const detailRows = scans.map(scan => [
            scan.barcode,
            scan.scanned_by,
            formatDateTime(scan.scanned_at),
            scan.previous_batch || '-',
            scan.status
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
        res.setHeader('Content-Disposition', `attachment; filename="warehouse_batch_${batch.batch_number}.csv"`);
        res.status(200).send(csvContent);

    } catch (error) {
        console.error('Error downloading batch report:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
// Search for an item to find its batch
export const searchItem = async (req: Request, res: Response) => {
    const { barcode } = req.query;

    if (!barcode) {
        return res.status(400).json({ error: 'Barcode is required' });
    }

    try {
        const result = await pool.query(`
            SELECT s.*, b.batch_number, b.created_at as batch_created_at
            FROM warehouse_scans s
            JOIN warehouse_batches b ON s.batch_id = b.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at DESC
        `, [barcode]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Item not found in any batch' });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('Error searching item:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
