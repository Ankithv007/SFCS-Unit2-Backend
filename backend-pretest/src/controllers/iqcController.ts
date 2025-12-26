import { Request, Response } from 'express';
import pool from '../config/db';

// Create a new batch
export const createBatch = async (req: Request, res: Response) => {
    const { batch_number, created_by } = req.body;

    try {
        // Check if batch already exists
        const checkBatch = await pool.query('SELECT * FROM iqc_batches WHERE batch_number = $1', [batch_number]);
        if (checkBatch.rows.length > 0) {
            return res.status(409).json({ error: 'Batch number already exists' });
        }

        // Create new batch
        const newBatch = await pool.query(
            'INSERT INTO iqc_batches (batch_number, created_by) VALUES ($1, $2) RETURNING *',
            [batch_number, created_by]
        );

        res.status(201).json(newBatch.rows[0]);
    } catch (error) {
        console.error('Error creating batch:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Scan a component into a batch
export const scanComponent = async (req: Request, res: Response) => {
    const { batch_id, barcode, scanned_by, remarks } = req.body;

    try {
        // 1. Check if barcode already exists globally (Unique Constraint Check)
        const checkBarcode = await pool.query(
            `SELECT c.*, b.batch_number 
             FROM iqc_components c 
             JOIN iqc_batches b ON c.batch_id = b.id 
             WHERE c.barcode = $1`,
            [barcode]
        );

        if (checkBarcode.rows.length > 0) {
            const existingBatch = checkBarcode.rows[0].batch_number;
            return res.status(409).json({
                error: `Barcode already used in Batch ${existingBatch}`,
                details: checkBarcode.rows[0]
            });
        }

        // 2. Insert the new component scan
        const newScan = await pool.query(
            `INSERT INTO iqc_components (batch_id, barcode, scanned_by, remarks) 
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [batch_id, barcode, scanned_by, remarks]
        );

        res.status(201).json(newScan.rows[0]);
    } catch (error) {
        console.error('Error scanning component:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get components for a specific batch
export const getBatchComponents = async (req: Request, res: Response) => {
    const { batch_id } = req.params;

    try {
        const components = await pool.query(
            'SELECT * FROM iqc_components WHERE batch_id = $1 ORDER BY scanned_at DESC',
            [batch_id]
        );
        res.json(components.rows);
    } catch (error) {
        console.error('Error fetching batch components:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
