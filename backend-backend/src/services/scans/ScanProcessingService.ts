import pool from '../../config/db';
import { createLogger } from '../../utils/logger';
import { WorkflowEngineService } from '../workflow/WorkflowEngineService';
import { BatchManagementService } from '../batches/BatchManagementService';
import { TraceabilityService } from '../traceability/TraceabilityService';
import { AuditService } from '../audit/AuditService';
import { ValidationError } from '../../utils/ValidationError';

const logger = createLogger('ScanProcessingService');

export class ScanProcessingService {
    /**
     * Unified entry point for processing any scan in any stage using pure centralized tables.
     */
    static async processStageScan(
        stageCode: string,
        payload: {
            work_order_id: number | null;
            batch_id?: number | null;
            batch_number?: string;
            barcode: string;
            unit_serial_number?: string | null;
            status: string;
            scanned_by: string;
            remarks?: string;
            resolution_remarks?: string;
            failed_stage_id?: number;
        }
    ): Promise<{ success: boolean; message?: string; data?: any }> {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            // Resolve USN to PCB Barcode if needed
            let scannedValue = payload.barcode.trim().toUpperCase();
            let resolvedBarcode = scannedValue;
            
            // Check if it exists in units table
            const unitExistsRes = await client.query('SELECT 1 FROM units WHERE barcode = $1', [scannedValue]);
            if (unitExistsRes.rows.length === 0) {
                // If not found in units as a barcode, check if it's a mapped Unit Serial Number
                const mappingRes = await client.query(
                    'SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1',
                    [scannedValue]
                );
                if (mappingRes.rows.length > 0) {
                    resolvedBarcode = mappingRes.rows[0].barcode;
                    logger.info(`Resolved scanned USN [${scannedValue}] to PCB Barcode [${resolvedBarcode}]`);
                }
            }
            
            payload.barcode = resolvedBarcode;
            logger.info(`Processing pure central scan for stage [${stageCode}] - Barcode [${payload.barcode}]`);
            
            // Resolve batch number if only batch_id is provided
            let batchNumber = payload.batch_number;
            if (!batchNumber && payload.batch_id) {
                const batchRes = await client.query('SELECT batch_number FROM batches WHERE id = $1', [payload.batch_id]);
                if (batchRes.rows.length > 0) {
                    batchNumber = batchRes.rows[0].batch_number;
                } else {
                    batchNumber = `BATCH-${payload.batch_id}`; // Fallback
                }
            }
            if (!batchNumber) throw new Error("batch_number or batch_id is required");
            
            // 1. Get Target Stage Info
            const stage = await WorkflowEngineService.getStageByCode(stageCode);
            if (!stage) {
                throw new Error(`Stage ${stageCode} not found or inactive.`);
            }

            // 2. Batch Management (Resolve the scanning batch FIRST)
            const batchId = await BatchManagementService.getOrCreateBatch(
                batchNumber, payload.work_order_id, stage.id, payload.scanned_by
            );
            if (!batchId) {
                throw new Error(`Failed to create/resolve master batch for ${batchNumber}`);
            }

            // 3. Fetch the Unit to validate transitions
            const unitRes = await client.query(`
                SELECT u.*, b.batch_number as unit_batch_number, w.wo_number as unit_wo_number 
                FROM units u
                LEFT JOIN batches b ON u.batch_id = b.id
                LEFT JOIN work_orders w ON b.work_order_id = w.id
                WHERE u.barcode = $1`, [payload.barcode]);
            const unit = unitRes.rows.length > 0 ? unitRes.rows[0] : null;

            // 4. Validate Batch Match
            if (unit && unit.batch_id && unit.batch_id !== batchId && payload.status !== 'RESOLVED') {
                throw new ValidationError({
                    errorCode: 'WRONG_BATCH',
                    message: 'Barcode belongs to a different batch.',
                    workOrder: unit.unit_wo_number || 'Unknown WO',
                    batch: unit.unit_batch_number || 'Unknown Batch',
                    actualBatch: batchNumber,
                    currentStage: stageCode,
                    suggestedAction: 'Please scan barcode in its assigned Work Order / Batch.',
                    severity: 'error'
                });
            }

            // 4.5 Validate Failed Stage scope (if running split Rework/Debug sessions)
            if ((stageCode === 'REWORK' || stageCode === 'DEBUG') && payload.failed_stage_id) {
                if (!unit || unit.failed_stage_id !== payload.failed_stage_id) {
                    throw new ValidationError({
                        errorCode: 'WRONG_QUEUE',
                        message: 'Barcode does not belong to this repair queue.',
                        workOrder: unit?.unit_wo_number || 'Unknown WO',
                        batch: unit?.unit_batch_number || 'Unknown Batch',
                        actualBatch: batchNumber,
                        currentStage: stageCode,
                        suggestedAction: 'Please switch to the correct Source Stage queue to repair this unit.',
                        severity: 'error'
                    });
                }
            }

            // 5. Strict Workflow Validation
            await WorkflowEngineService.validateTransition(unit, stage);

            // Special handling for Rework/Debug return flow:
            // If the scanning stage is a Rework/Debug stage, and the result is ACCEPTED/RESOLVED,
            // we let TraceabilityService transition it back. 
            // Wait, TraceabilityService blindly sets current_stage_id to the scanning stage.
            // If we are at REWORK, and we PASS, we want current_stage_id to become the FAILED_STAGE_ID!
            // So we must intercept the status update logic.
            
            // 6. Update Metrics
            await BatchManagementService.incrementBatchMetrics(batchId, stage.id, payload.status);

            // 6. Traceability (Update Units Ledger)
            // If this is REWORK or DEBUG and it's resolved, we MUST return it to its origin stage as PENDING.
            let nextStageId = stage.id;
            let nextStatus = payload.status;

            if ((stageCode === 'REWORK' || stageCode === 'DEBUG') && (payload.status === 'ACCEPTED' || payload.status === 'RESOLVED')) {
                if (unit && unit.failed_stage_id) {
                    nextStageId = unit.failed_stage_id;
                    nextStatus = 'PENDING'; // Force PENDING at origin stage so it must pass again
                }
            }

            await TraceabilityService.updateUnitState(
                payload.barcode, batchId, nextStageId, nextStatus, payload.scanned_by, payload.remarks
            );

            // 7. Audit Trail (Insert into Scans)
            await AuditService.logScanEvent(
                payload.barcode, batchId, stage.id, payload.status, payload.scanned_by, payload.remarks, payload.resolution_remarks
            );

            // 8. External Serial Number mapping (if provided)
            if (payload.unit_serial_number) {
                await client.query(
                    `INSERT INTO unit_serial_mapping (barcode, unit_serial_number, linked_by) 
                     VALUES ($1, $2, $3) ON CONFLICT (barcode) DO NOTHING`,
                    [payload.barcode, payload.unit_serial_number, payload.scanned_by]
                );
            }

            // Fetch the inserted scan
            const scanRes = await client.query(
                `SELECT s.*, s.scan_result as status, m.unit_serial_number 
                 FROM scans s 
                 LEFT JOIN unit_serial_mapping m ON s.barcode = m.barcode
                 WHERE s.barcode = $1 AND s.batch_id = $2 AND s.stage_id = $3 
                 ORDER BY s.scanned_at DESC LIMIT 1`,
                [payload.barcode, batchId, stage.id]
            );
            const scanRecord = scanRes.rows.length > 0 ? scanRes.rows[0] : null;

            // Get previous stage ID to calculate total input for this stage
            let prevStageIdQuery = 'SELECT id FROM production_stages WHERE stage_order = $1 - 1';
            let prevStageIdRes = await client.query(prevStageIdQuery, [stage.stage_order]);
            const prevStageId = prevStageIdRes.rows.length > 0 ? prevStageIdRes.rows[0].id : null;

            let previousStagePassedQuery = `
                COALESCE(
                    (
                        SELECT COUNT(DISTINCT u.barcode) 
                        FROM units u 
                        JOIN batches pb ON u.batch_id = pb.id 
                        WHERE pb.work_order_id = w.id 
                          AND ($3::int IS NULL OR u.current_stage_id >= $3::int)
                    ), w.quantity
                )
            `;

            if (stageCode === 'REWORK') {
                previousStagePassedQuery = `
                    COALESCE(
                        (
                            SELECT SUM(p2.rework_qty) 
                            FROM batch_stage_progress p2 
                            JOIN batches b2 ON p2.batch_id = b2.id 
                            WHERE b2.work_order_id = w.id
                              AND ($3::int IS NULL OR true)
                        ), 0
                    )
                `;
            } else if (stageCode === 'DEBUG') {
                previousStagePassedQuery = `
                    COALESCE(
                        (
                            SELECT SUM(p2.debug_qty) 
                            FROM batch_stage_progress p2 
                            JOIN batches b2 ON p2.batch_id = b2.id 
                            WHERE b2.work_order_id = w.id
                              AND ($3::int IS NULL OR true)
                        ), 0
                    )
                `;
            }

            const isReworkOrDebug = stageCode === 'REWORK' || stageCode === 'DEBUG';

            // Fetch the updated counters from the central service logic
            const countersRes = await client.query(
                `SELECT 
                    COALESCE(p.scanned_qty, 0) as scanned, 
                    COALESCE(p.accepted_qty, 0) as passed, 
                    ${previousStagePassedQuery} as "previousStagePassed",
                    ${isReworkOrDebug ? `
                        (
                            SELECT COUNT(u.barcode)
                            FROM units u
                            JOIN batches b3 ON u.batch_id = b3.id
                            WHERE b3.work_order_id = w.id AND u.current_status = '${stageCode}'
                        ) as pending,
                        (
                            SELECT STRING_AGG(DISTINCT ps.stage_name, ', ')
                            FROM units u
                            JOIN batches b3 ON u.batch_id = b3.id
                            JOIN production_stages ps ON u.failed_stage_id = ps.id
                            WHERE b3.work_order_id = w.id AND u.current_status = '${stageCode}'
                        ) as "sourceStage",
                        (
                            SELECT COUNT(u.barcode)
                            FROM units u
                            JOIN batches b3 ON u.batch_id = b3.id
                            WHERE b3.work_order_id = w.id AND u.current_status = '${stageCode}'
                        ) as rework,
                        (
                            SELECT COUNT(u.barcode)
                            FROM units u
                            JOIN batches b3 ON u.batch_id = b3.id
                            WHERE b3.work_order_id = w.id AND u.current_status = '${stageCode}'
                        ) as debug
                    ` : `
                        (
                            SELECT COUNT(u.barcode)
                            FROM units u
                            JOIN batches b3 ON u.batch_id = b3.id
                            WHERE b3.work_order_id = w.id AND u.current_stage_id = $2 AND u.current_status = 'PENDING'
                        ) as pending,
                        NULL as "sourceStage",
                        (
                            SELECT COUNT(u.barcode)
                            FROM units u
                            JOIN batches b3 ON u.batch_id = b3.id
                            WHERE b3.work_order_id = w.id AND u.current_stage_id = $2 AND u.current_status = 'REWORK'
                        ) as rework,
                        (
                            SELECT COUNT(u.barcode)
                            FROM units u
                            JOIN batches b3 ON u.batch_id = b3.id
                            WHERE b3.work_order_id = w.id AND u.current_stage_id = $2 AND u.current_status = 'DEBUG'
                        ) as debug
                    `}
                 FROM batch_stage_progress p
                 JOIN batches b ON p.batch_id = b.id
                 JOIN work_orders w ON b.work_order_id = w.id
                 WHERE p.batch_id = $1 AND p.stage_id = $2`,
                [batchId, stage.id, prevStageId]
            );

            const counters = countersRes.rows.length > 0 ? countersRes.rows[0] : null;
            if (counters) {
                // Ensure numerical values
                counters.scanned = parseInt(counters.scanned || 0);
                counters.passed = parseInt(counters.passed || 0);
                counters.rework = parseInt(counters.rework || 0);
                counters.debug = parseInt(counters.debug || 0);
                counters.previousStagePassed = parseInt(counters.previousStagePassed || 0);
                counters.pending = parseInt(counters.pending || 0);
            }

            let requiresUnitSerial = false;
            let requiresUsnOnly = false;
            if (stage.requires_usn && payload.status === 'ACCEPTED') {
                const mappingRes = await client.query(
                    `SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1`,
                    [payload.barcode]
                );
                if (mappingRes.rows.length === 0) {
                    requiresUnitSerial = true;
                    requiresUsnOnly = true;
                }
            }

            await client.query('COMMIT');
            return { 
                success: true, 
                message: "Scan processed successfully",
                data: {
                    scan: scanRecord,
                    counters: counters,
                    requiresUnitSerial,
                    requiresUsnOnly
                }
            };
        } catch (error: any) {
            await client.query('ROLLBACK');
            logger.error(`Error processing pure stage scan: ${error.message}`);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Centralized pre-validation of any barcode/USN scan before the operator selects an action.
     */
    static async validateScanBeforeAction(
        stageCode: string,
        payload: {
            barcode: string;
            batch_number: string;
            work_order_id?: number | null;
            failed_stage_id?: number | null;
        }
    ): Promise<{ success: boolean; message: string; data?: any }> {
        const client = await pool.connect();
        try {
            let scannedValue = payload.barcode.trim().toUpperCase();
            let resolvedBarcode = scannedValue;
            let resolvedUsn = '';

            // 1. Resolve PCB Barcode from USN, or resolve USN if PCB Barcode is scanned
            const unitExistsRes = await client.query('SELECT 1 FROM units WHERE barcode = $1', [scannedValue]);
            if (unitExistsRes.rows.length === 0) {
                // Check if mapped Unit Serial Number
                const mappingRes = await client.query(
                    'SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1',
                    [scannedValue]
                );
                if (mappingRes.rows.length > 0) {
                    resolvedBarcode = mappingRes.rows[0].barcode;
                    resolvedUsn = scannedValue;
                    logger.info(`Resolved scanned USN [${scannedValue}] to PCB Barcode [${resolvedBarcode}]`);
                }
            } else {
                // Scanned value is a barcode, let's find if it has a USN linked
                const mappingRes = await client.query(
                    'SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1',
                    [scannedValue]
                );
                if (mappingRes.rows.length > 0) {
                    resolvedUsn = mappingRes.rows[0].unit_serial_number;
                }
            }

            // 2. Conflict Check: Duplicate USN Check
            const usnCheckRes = await client.query(
                'SELECT barcode FROM unit_serial_mapping WHERE unit_serial_number = $1',
                [scannedValue]
            );
            if (usnCheckRes.rows.length > 0 && usnCheckRes.rows[0].barcode !== resolvedBarcode) {
                throw new ValidationError({
                    errorCode: 'DUPLICATE_USN',
                    message: 'Unit Serial Number already linked to another barcode.',
                    suggestedAction: 'Please scan a unique Unit Serial Number.',
                    severity: 'error'
                });
            }

            // 3. Resolve Stage Info
            const stage = await WorkflowEngineService.getStageByCode(stageCode);
            if (!stage) {
                throw new Error(`Stage ${stageCode} not found or inactive.`);
            }

            // 4. Resolve the work order ID from batches if not provided
            let workOrderId = payload.work_order_id;
            if (!workOrderId) {
                const batchRes = await client.query('SELECT work_order_id FROM batches WHERE batch_number = $1', [payload.batch_number]);
                if (batchRes.rows.length > 0) {
                    workOrderId = batchRes.rows[0].work_order_id;
                }
            }

            // 4.5 Resolve the batch ID for validation
            const batchId = await BatchManagementService.getOrCreateBatch(
                payload.batch_number, workOrderId || null, stage.id, 'System'
            );
            if (!batchId) {
                throw new Error(`Failed to create/resolve master batch for ${payload.batch_number}`);
            }

            // 5. Fetch the Unit to validate
            const unitRes = await client.query(`
                SELECT u.*, b.batch_number as unit_batch_number, w.wo_number as unit_wo_number 
                FROM units u
                LEFT JOIN batches b ON u.batch_id = b.id
                LEFT JOIN work_orders w ON b.work_order_id = w.id
                WHERE u.barcode = $1`, [resolvedBarcode]);
            const unit = unitRes.rows.length > 0 ? unitRes.rows[0] : null;

            // 6. Validate Batch Match
            if (unit && unit.batch_id && unit.batch_id !== batchId) {
                throw new ValidationError({
                    errorCode: 'WRONG_BATCH',
                    message: 'Barcode belongs to another batch/work order.',
                    workOrder: unit.unit_wo_number || 'Unknown WO',
                    batch: unit.unit_batch_number || 'Unknown Batch',
                    actualBatch: payload.batch_number,
                    currentStage: stage.stage_name,
                    suggestedAction: `This barcode belongs to batch ${unit.unit_batch_number} (${unit.unit_wo_number}), not ${payload.batch_number}.`,
                    severity: 'error'
                });
            }

            // 7. Validate Failed Stage scope (Wrong Repair Queue)
            if ((stageCode === 'REWORK' || stageCode === 'DEBUG') && payload.failed_stage_id) {
                if (!unit || unit.failed_stage_id !== payload.failed_stage_id) {
                    const failedStageRes = await client.query('SELECT stage_name, stage_code FROM production_stages WHERE id = $1', [unit?.failed_stage_id]);
                    const expectedQueueName = failedStageRes.rows.length > 0 
                        ? `${failedStageRes.rows[0].stage_name} (${failedStageRes.rows[0].stage_code})`
                        : 'another';
                    const targetFailedRes = await client.query('SELECT stage_name FROM production_stages WHERE id = $1', [payload.failed_stage_id]);
                    const currentQueueName = targetFailedRes.rows.length > 0 ? targetFailedRes.rows[0].stage_name : 'current';

                    throw new ValidationError({
                        errorCode: 'WRONG_QUEUE',
                        message: `This barcode belongs to the ${expectedQueueName} repair queue.`,
                        currentStage: currentQueueName,
                        actualStage: expectedQueueName,
                        suggestedAction: `Please repair it in the correct source-stage queue.`,
                        severity: 'error'
                    });
                }
            }

            // 8. Strict Workflow Transition Validation
            await WorkflowEngineService.validateTransition(unit, stage);

            return {
                success: true,
                message: 'Scan validation succeeded.',
                data: {
                    barcode: resolvedBarcode,
                    unit_serial_number: resolvedUsn
                }
            };
        } catch (error: any) {
            logger.error(`validateScanBeforeAction failed: ${error.message}`);
            throw error;
        } finally {
            client.release();
        }
    }
}
