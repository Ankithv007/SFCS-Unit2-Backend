import pool from '../../config/db';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ValidationService');

export class ValidationService {
    static async validateUnitExists(barcode: string): Promise<any> {
        const result = await pool.query(`SELECT * FROM units WHERE barcode = $1`, [barcode]);
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
}
