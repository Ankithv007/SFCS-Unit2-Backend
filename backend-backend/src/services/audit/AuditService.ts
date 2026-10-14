import pool from '../../config/db';
import { createLogger } from '../../utils/logger';
import { isValidIdentity } from '../../utils/scanUser';

const logger = createLogger('AuditService');

export class AuditService {
    static async logScanEvent(
        barcode: string, 
        batchId: number | null, 
        stageId: number, 
        scanResult: string, 
        scannedBy: string, 
        remarks?: string, 
        resolutionRemarks?: string,
        dbClient?: any
    ): Promise<void> {
        if (!scannedBy || !isValidIdentity(scannedBy)) {
            logger.error(`Audit violation: Attempted to log scan event for barcode [${barcode}] with missing or invalid scannedBy identity: [${scannedBy}]`);
            throw new Error(`Audit violation: Cannot record scan with missing or invalid employee identity: "${scannedBy}"`);
        }

        const db = dbClient || pool;
        try {
            const query = `
                INSERT INTO scans 
                (barcode, batch_id, stage_id, scan_result, scanned_by, remarks, resolution_remarks)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            await db.query(query, [
                barcode, batchId, stageId, scanResult, scannedBy, remarks || null, resolutionRemarks || null
            ]);
        } catch (error: any) {
            logger.error(`Error in logScanEvent: ${error.message}`);
            throw error;
        }
    }

    static async createAuditLog(
        eventType: string,
        entityType: string,
        entityId: string,
        actor: string,
        description: string,
        oldValue?: any,
        newValue?: any
    ): Promise<void> {
        try {
            const query = `
                INSERT INTO audit_log 
                (event_type, entity_type, entity_id, actor, description, old_value, new_value)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            await pool.query(query, [
                eventType, entityType, entityId, actor, description,
                oldValue ? JSON.stringify(oldValue) : null,
                newValue ? JSON.stringify(newValue) : null
            ]);
        } catch (error: any) {
            logger.error(`Error in createAuditLog: ${error.message}`);
        }
    }

    static async getScansByBatchAndStage(batchId: string, stageCode: string) {
        const result = await pool.query(`
            SELECT s.*, s.scan_result as status, m.unit_serial_number,
                   (SELECT s2.scanned_at 
                    FROM scans s2 
                    WHERE s2.barcode = s.barcode AND s2.stage_id IN (10, 11) 
                      AND (SELECT sf.stage_id 
                           FROM scans sf 
                           WHERE sf.barcode = s2.barcode 
                             AND sf.scan_result IN ('REWORK', 'DEBUG') 
                             AND sf.scanned_at < s2.scanned_at 
                           ORDER BY sf.scanned_at DESC LIMIT 1) = s.stage_id
                    ORDER BY s2.scanned_at DESC LIMIT 1) as remark_debug_time,
                   (SELECT s2.scanned_at 
                    FROM scans s2 
                    WHERE s2.barcode = s.barcode AND s2.stage_id IN (10, 11) 
                      AND (SELECT sf.stage_id 
                           FROM scans sf 
                           WHERE sf.barcode = s2.barcode 
                             AND sf.scan_result IN ('REWORK', 'DEBUG') 
                             AND sf.scanned_at < s2.scanned_at 
                           ORDER BY sf.scanned_at DESC LIMIT 1) = s.stage_id
                    ORDER BY s2.scanned_at DESC LIMIT 1) as repair_time,
                   (SELECT s2.remarks 
                    FROM scans s2 
                    WHERE s2.barcode = s.barcode AND s2.stage_id IN (10, 11) 
                      AND (SELECT sf.stage_id 
                           FROM scans sf 
                           WHERE sf.barcode = s2.barcode 
                             AND sf.scan_result IN ('REWORK', 'DEBUG') 
                             AND sf.scanned_at < s2.scanned_at 
                           ORDER BY sf.scanned_at DESC LIMIT 1) = s.stage_id
                    ORDER BY s2.scanned_at DESC LIMIT 1) as remark_debug_remarks,
                   (SELECT s2.remarks 
                    FROM scans s2 
                    WHERE s2.barcode = s.barcode AND s2.stage_id IN (10, 11) 
                      AND (SELECT sf.stage_id 
                           FROM scans sf 
                           WHERE sf.barcode = s2.barcode 
                             AND sf.scan_result IN ('REWORK', 'DEBUG') 
                             AND sf.scanned_at < s2.scanned_at 
                           ORDER BY sf.scanned_at DESC LIMIT 1) = s.stage_id
                    ORDER BY s2.scanned_at DESC LIMIT 1) as repair_remark
            FROM scans s
            JOIN production_stages ps ON s.stage_id = ps.id
            LEFT JOIN unit_serial_mapping m ON s.barcode = m.barcode
            WHERE s.batch_id = $1 AND ps.stage_code = $2
            ORDER BY s.scanned_at DESC
        `, [batchId, stageCode]);
        return result.rows;
    }

    static async updateScanStatus(scanId: string, status: string, remarks: string) {
        await pool.query(`UPDATE scans SET scan_result = $1, remarks = $2 WHERE id = $3`, [status, remarks, scanId]);
    }

    static async deleteScanById(scanId: string, actor?: string) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const scanRes = await client.query('SELECT barcode, batch_id, stage_id FROM scans WHERE id = $1', [scanId]);
            if (scanRes.rows.length === 0) {
                await client.query('ROLLBACK');
                throw new Error('Scan not found');
            }

            const { barcode, batch_id, stage_id } = scanRes.rows[0];

            // determine stage code/name
            const stageRes = await client.query('SELECT stage_code, stage_name FROM production_stages WHERE id = $1', [stage_id]);
            const stageCode = stageRes.rows.length > 0 ? stageRes.rows[0].stage_code : null;
            const stageName = stageRes.rows.length > 0 ? stageRes.rows[0].stage_name : null;

            // delete the scan
            await client.query('DELETE FROM scans WHERE id = $1', [scanId]);

            // Note: barcode_stage_history table exists in some modules but may not be present
            // in this service's database schema. Avoid attempting to delete from that
            // table here to prevent errors when the table is absent.

            // add audit log entry
            try {
                const desc = `Scan ${scanId} for barcode ${barcode} deleted by ${actor || 'system'}`;
                await AuditService.createAuditLog('DELETE', 'scan', scanId.toString(), actor || 'system', desc, null, null);
            } catch (e) {
                // ignore audit log failures
            }

            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}
