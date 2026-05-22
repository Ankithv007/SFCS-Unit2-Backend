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
                    const firstStageRes = await pool.query('SELECT stage_name, stage_code FROM production_stages WHERE stage_order = 1 AND is_active = true');
                    const firstStageName = firstStageRes.rows.length > 0 
                        ? `${firstStageRes.rows[0].stage_name} (${firstStageRes.rows[0].stage_code})`
                        : 'Pre-Soldering (PTH)';
                    throw new ValidationError({
                        errorCode: 'INVALID_STAGE',
                        message: 'Previous required stage is missing.',
                        requiredStage: firstStageName,
                        currentStage: targetStage.stage_name,
                        suggestedAction: `Please scan this barcode in ${firstStageName} stage first before proceeding.`,
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
                    currentStage: targetStage.stage_name,
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
                        currentStage: targetStage.stage_name,
                        suggestedAction: `Complete Rework and ${targetStage.stage_name} validation before proceeding.`,
                        severity: 'error'
                    });
                }
                if (unit.current_status === 'DEBUG') {
                    throw new ValidationError({
                        errorCode: 'UNDER_DEBUG',
                        message: 'Barcode currently under Debug process.',
                        currentStage: targetStage.stage_name,
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
                const currentStageRes = await pool.query(`SELECT stage_name, stage_code FROM production_stages WHERE id = $1`, [unit.current_stage_id]);
                const currentStageName = currentStageRes.rows.length > 0 
                    ? `${currentStageRes.rows[0].stage_name} (${currentStageRes.rows[0].stage_code})`
                    : 'Unknown';
                
                // Fetch allowed next stage names dynamically
                const nextStagesQuery = `
                    SELECT ps.stage_name, ps.stage_code 
                    FROM workflow_transitions wt
                    JOIN production_stages ps ON wt.to_stage_id = ps.id
                    WHERE wt.from_stage_id = $1 AND wt.on_scan_result = $2 AND wt.is_active = true
                `;
                const nextStagesRes = await pool.query(nextStagesQuery, [unit.current_stage_id, unit.current_status]);
                const expectedStageNames = nextStagesRes.rows.map(row => `${row.stage_name} (${row.stage_code})`).join(' or ');
                const requiredStageName = expectedStageNames || 'the correct next stage';

                throw new ValidationError({
                    errorCode: 'INVALID_TRANSITION',
                    message: 'Previous required stage is missing or invalid sequence.',
                    requiredStage: requiredStageName,
                    currentStage: targetStage.stage_name,
                    actualStage: currentStageName,
                    suggestedAction: `Barcode must complete the correct previous stage sequence. It is currently at ${currentStageName}.`,
                    severity: 'error'
                });
            }

            // Dynamic check for USN requirement: if target stage is after any stage requiring a USN, check mapping
            const usnStagesRes = await pool.query(
                `SELECT id FROM production_stages WHERE requires_usn = true AND stage_order < $1`,
                [targetStage.stage_order]
            );
            if (usnStagesRes.rows.length > 0) {
                const mappingRes = await pool.query(
                    `SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1`,
                    [unit.barcode]
                );
                if (mappingRes.rows.length === 0) {
                    throw new ValidationError({
                        errorCode: 'USN_REQUIRED',
                        message: 'Barcode has not been linked to a Unit Serial Number.',
                        suggestedAction: 'Please scan and complete PCBA-FCT with USN linking first.',
                        severity: 'error'
                    });
                }
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
