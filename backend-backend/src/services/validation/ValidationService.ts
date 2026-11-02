import pool from '../../config/db';
import { createLogger } from '../../utils/logger';
import { ScanProcessingService } from '../scans/ScanProcessingService';

const logger = createLogger('ValidationService');

export class ValidationService {
    static async validateUnitExists(barcode: string): Promise<any> {
        let resolvedBarcode = barcode.trim().toUpperCase();
        let result = await pool.query(`SELECT * FROM units WHERE barcode = $1`, [resolvedBarcode]);
        if (result.rows.length === 0) {
            const mappingRes = await pool.query(
                `SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1`,
                [resolvedBarcode]
            );
            if (mappingRes.rows.length > 0) {
                resolvedBarcode = mappingRes.rows[0].barcode;
                result = await pool.query(`SELECT * FROM units WHERE barcode = $1`, [resolvedBarcode]);
            }
        }
        return result.rows.length > 0 ? result.rows[0] : null;
    }

    static async validatePredecessorStage(barcode: string, expectedCurrentStageId: number): Promise<boolean> {
        const unit = await this.validateUnitExists(barcode);
        if (!unit) return false;
        
        if (unit.current_stage_id !== expectedCurrentStageId) {
            return false;
        }
        
        return true;
    }

    static async validateScanBeforeAction(
        stageCode: string,
        payload: {
            barcode: string;
            batch_number: string;
            work_order_id?: number | null;
            failed_stage_id?: number | null;
        }
    ): Promise<{ success: boolean; message: string; data?: any }> {
        return ScanProcessingService.validateScanBeforeAction(stageCode, payload);
    }
}
