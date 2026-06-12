import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

export const updateScan = async (req: AuthRequest, res: Response) => {
    const scanId = req.params.id;
    let { barcode, unit_serial_no } = req.body;

    if (!barcode || !barcode.trim()) {
        return res.status(400).json({ error: 'Barcode cannot be empty.' });
    }
    if (!unit_serial_no || !unit_serial_no.trim()) {
        return res.status(400).json({ error: 'Unit Serial Number cannot be empty.' });
    }

    barcode = barcode.trim().toUpperCase();
    unit_serial_no = unit_serial_no.trim();

    const actor = req.user ? (req.user.name || req.user.email || 'system') : 'system';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get existing scan record
        const scanRes = await client.query('SELECT barcode FROM scans WHERE id = $1', [scanId]);
        if (scanRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Scan record not found.' });
        }

        const oldBarcode = scanRes.rows[0].barcode;

        // 2. Handle barcode update
        if (barcode !== oldBarcode) {
            // Check if the new barcode already exists in the units table
            const unitExistsRes = await client.query('SELECT 1 FROM units WHERE barcode = $1', [barcode]);
            
            if (unitExistsRes.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: 'The corrected barcode does not exist in units. Please verify or scan it first.' 
                });
            }

            // Update this specific scan's barcode reference
            await client.query('UPDATE scans SET barcode = $1 WHERE id = $2', [barcode, scanId]);
        }

        // 3. Handle unit serial mapping update/insert
        // First check if this unit_serial_no is mapped to ANOTHER barcode
        const usnCheckRes = await client.query(
            'SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1 AND barcode != $2',
            [unit_serial_no, barcode]
        );
        if (usnCheckRes.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Unit Serial Number already linked to another barcode.' });
        }

        // Upsert the unit serial mapping for the target barcode
        await client.query(
            `INSERT INTO unit_serial_mapping (barcode, unit_serial_number, linked_by)
             VALUES ($1, $2, $3)
             ON CONFLICT (barcode)
             DO UPDATE SET unit_serial_number = EXCLUDED.unit_serial_number, linked_by = EXCLUDED.linked_by`,
            [barcode, unit_serial_no, actor]
        );

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Scan record updated successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: err.message || 'Failed to update scan record.' });
    } finally {
        client.release();
    }
};
