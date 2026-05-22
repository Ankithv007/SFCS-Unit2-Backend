import pool from '../../config/db';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AuditService');

export class AuditService {
    static async logScanEvent(
        barcode: string, 
        batchId: number | null, 
        stageId: number, 
        scanResult: string, 
        scannedBy: string, 
        remarks?: string, 
        resolutionRemarks?: string
    ): Promise<void> {
        try {
            const query = `
                INSERT INTO scans 
                (barcode, batch_id, stage_id, scan_result, scanned_by, remarks, resolution_remarks)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            await pool.query(query, [
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
            SELECT s.*, s.scan_result as status, m.unit_serial_number 
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
}
