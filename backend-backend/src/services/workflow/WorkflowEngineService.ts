import pool from '../../config/db';
import { createLogger } from '../../utils/logger';
import { ValidationError } from '../../utils/ValidationError';

const logger = createLogger('WorkflowEngineService');

export class WorkflowEngineService {
    /**
     * Strictly validate if a unit is allowed to scan at a target stage.
     * Returns true if valid, or throws an exact error message if invalid.
     */
    static async validateTransition(unit: any | null, targetStage: any): Promise<boolean> {
        try {
            // New unit scanning for the first time
            if (!unit) {
                if (targetStage.stage_order !== 1) {
                    throw new ValidationError({
                        errorCode: 'INVALID_STAGE',
                        message: 'Previous required stage is missing.',
                        requiredStage: 'PTH',
                        currentStage: targetStage.stage_name,
                        suggestedAction: 'Scan this barcode in PTH stage',
                        severity: 'error'
                    });
                }
                return true;
            }

            // Unit already completed this target stage
            if (unit.current_stage_id === targetStage.id && unit.current_status === 'ACCEPTED') {
                throw new ValidationError({
                    errorCode: 'ALREADY_COMPLETED',
                    message: 'Barcode already completed this stage.',
                    actualStage: targetStage.stage_name,
                    severity: 'warning'
                });
            }

            // Unit is trying to scan in the same stage but it failed previously
            if (unit.current_stage_id === targetStage.id && unit.current_status !== 'ACCEPTED') {
                // If it is in REWORK or DEBUG state, it cannot scan normally
                if (unit.current_status === 'REWORK') {
                    throw new ValidationError({
                        errorCode: 'UNDER_REWORK',
                        message: 'Barcode currently under Rework process.',
                        suggestedAction: `Complete Rework and ${targetStage.stage_name} validation before proceeding.`,
                        severity: 'error'
                    });
                }
                if (unit.current_status === 'DEBUG') {
                    throw new ValidationError({
                        errorCode: 'UNDER_DEBUG',
                        message: 'Barcode currently under Debug process.',
                        suggestedAction: `Complete Debug and ${targetStage.stage_name} validation before proceeding.`,
                        severity: 'error'
                    });
                }
                // If it is PENDING or READY_FOR_RESCAN, allow it to retry
                if (unit.current_status === 'PENDING' || unit.current_status === 'READY_FOR_RESCAN' || unit.current_status === 'FAILED') {
                    return true;
                }
            }

            // Unit is trying to scan in a new stage. We MUST find a valid transition route.
            const query = `
                SELECT to_stage_id 
                FROM workflow_transitions 
                WHERE from_stage_id = $1 AND on_scan_result = $2 AND is_active = true
            `;
            const result = await pool.query(query, [unit.current_stage_id, unit.current_status]);
            
            const validTransitions = result.rows.map(row => row.to_stage_id);
            
            if (!validTransitions.includes(targetStage.id)) {
                // Fetch the name of the stage it's currently at for a better error message
                const currentStageRes = await pool.query(`SELECT stage_name FROM production_stages WHERE id = $1`, [unit.current_stage_id]);
                const currentStageName = currentStageRes.rows.length > 0 ? currentStageRes.rows[0].stage_name : 'Unknown';
                
                throw new ValidationError({
                    errorCode: 'INVALID_TRANSITION',
                    message: 'Previous required stage is missing or invalid sequence.',
                    requiredStage: 'the correct next',
                    currentStage: targetStage.stage_name,
                    actualStage: currentStageName,
                    suggestedAction: `Barcode must complete the correct previous stage sequence. It is currently at ${currentStageName}.`,
                    severity: 'error'
                });
            }

            return true;
        } catch (error: any) {
            logger.error(`Validation Error: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get the next valid stage ID based on current stage and condition.
     */
    static async getNextStage(currentStageId: number, condition: string = 'ACCEPTED'): Promise<number | null> {
        try {
            const query = `
                SELECT to_stage_id 
                FROM workflow_transitions 
                WHERE from_stage_id = $1 AND on_scan_result = $2 AND is_active = true
            `;
            const result = await pool.query(query, [currentStageId, condition]);
            
            if (result.rows.length > 0) {
                return result.rows[0].to_stage_id;
            }
            return null;
        } catch (error: any) {
            logger.error(`Error in getNextStage: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get stage ID by its code.
     */
    static async getStageByCode(stageCode: string): Promise<any> {
        try {
            const query = `SELECT * FROM production_stages WHERE stage_code = $1 AND is_active = true`;
            const result = await pool.query(query, [stageCode]);
            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error: any) {
            logger.error(`Error in getStageByCode: ${error.message}`);
            throw error;
        }
    }
}
