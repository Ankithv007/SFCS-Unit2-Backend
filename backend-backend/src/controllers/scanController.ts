import { Response } from 'express';
import pool from '../config/db';
import { AuthRequest } from '../middleware/authMiddleware';

import { determineScannedBy } from '../utils/scanUser';

export const updateScan = async (req: AuthRequest, res: Response) => {
    const scanId = req.params.id;
    let { barcode, unit_serial_no } = req.body;

    if (!barcode || !barcode.trim()) {
        return res.status(400).json({ error: 'Barcode cannot be empty.' });
    }

    barcode = barcode.trim().toUpperCase();
    const hasUsn = (typeof unit_serial_no === 'string' && unit_serial_no.trim().length > 0);
    if (hasUsn) {
        unit_serial_no = unit_serial_no.trim();
    } else {
        unit_serial_no = null;
    }

    const actor = determineScannedBy(req.user);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Get existing scan record
        const scanRes = await client.query('SELECT barcode, batch_id FROM scans WHERE id = $1', [scanId]);
        if (scanRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Scan record not found.' });
        }

        const oldBarcode = scanRes.rows[0].barcode;
        const batchId = scanRes.rows[0].batch_id;

        // 2. Handle barcode update
        if (barcode !== oldBarcode) {
            // Check if the new barcode already exists in the units table
            const unitExistsRes = await client.query('SELECT 1 FROM units WHERE barcode = $1', [barcode]);
            
            if (unitExistsRes.rows.length === 0) {
                // Get the old unit details to copy them
                const oldUnitRes = await client.query(
                    'SELECT batch_id, current_stage_id, current_status, failed_stage_id, failed_at, failure_remark, repair_count, repair_remark, last_scanned_by FROM units WHERE barcode = $1',
                    [oldBarcode]
                );
                
                if (oldUnitRes.rows.length > 0) {
                    const u = oldUnitRes.rows[0];
                    await client.query(
                        `INSERT INTO units (barcode, batch_id, current_stage_id, current_status, failed_stage_id, failed_at, failure_remark, repair_count, repair_remark, last_scanned_by)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                        [barcode, u.batch_id, u.current_stage_id, u.current_status, u.failed_stage_id, u.failed_at, u.failure_remark, u.repair_count, u.repair_remark, u.last_scanned_by]
                    );
                } else {
                    // Fallback default unit creation if old unit is missing
                    await client.query(
                        `INSERT INTO units (barcode, batch_id, current_stage_id, current_status)
                         VALUES ($1, $2, (SELECT id FROM production_stages ORDER BY stage_order ASC LIMIT 1), 'PENDING')`,
                        [barcode, batchId]
                    );
                }
            }

            // Update all scans and sessions referring to this oldBarcode to the new barcode
            await client.query('UPDATE scans SET barcode = $1 WHERE barcode = $2', [barcode, oldBarcode]);
            await client.query('UPDATE rework_sessions SET barcode = $1 WHERE barcode = $2', [barcode, oldBarcode]);
            await client.query('UPDATE debug_sessions SET barcode = $1 WHERE barcode = $2', [barcode, oldBarcode]);

            // Delete the old unit if no scans reference it anymore
            const remainingScansRes = await client.query('SELECT COUNT(*) FROM scans WHERE barcode = $1', [oldBarcode]);
            const remainingCount = parseInt(remainingScansRes.rows[0].count, 10);
            if (remainingCount === 0) {
                await client.query('DELETE FROM units WHERE barcode = $1', [oldBarcode]);
            }
        }

        // 3. Handle unit serial mapping update/insert
        if (hasUsn) {
            // First check if this unit_serial_no is mapped to ANOTHER barcode (excluding the target barcode and old barcode)
            const usnCheckRes = await client.query(
                'SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1 AND barcode != $2 AND barcode != $3',
                [unit_serial_no, barcode, oldBarcode]
            );
            if (usnCheckRes.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Unit Serial Number already linked to another barcode.' });
            }

            // Check if there was an existing mapping for oldBarcode
            const oldMapRes = await client.query(
                'SELECT 1 FROM unit_serial_mapping WHERE barcode = $1',
                [oldBarcode]
            );

            if (oldMapRes.rows.length > 0) {
                // Update the existing mapping
                await client.query(
                    `UPDATE unit_serial_mapping 
                     SET barcode = $1, unit_serial_number = $2, linked_by = $3
                     WHERE barcode = $4`,
                    [barcode, unit_serial_no, actor, oldBarcode]
                );
            } else {
                // Insert/upsert a new mapping
                await client.query(
                    `INSERT INTO unit_serial_mapping (barcode, unit_serial_number, linked_by)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (barcode)
                     DO UPDATE SET unit_serial_number = EXCLUDED.unit_serial_number, linked_by = EXCLUDED.linked_by`,
                    [barcode, unit_serial_no, actor]
                );
            }
        } else {
            // If unit_serial_no is empty/null, but barcode changed, we must move any existing mapping from oldBarcode to barcode
            if (barcode !== oldBarcode) {
                await client.query(
                    'UPDATE unit_serial_mapping SET barcode = $1 WHERE barcode = $2',
                    [barcode, oldBarcode]
                );
            }
        }

        await client.query('COMMIT');
        return res.status(200).json({ success: true, message: 'Scan record updated successfully.' });
    } catch (err: any) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: err.message || 'Failed to update scan record.' });
    } finally {
        client.release();
    }
};
