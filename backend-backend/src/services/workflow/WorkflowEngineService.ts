import pool, { smtPool } from '../../config/db';
import { createLogger } from '../../utils/logger';
import { ValidationError } from '../../utils/ValidationError';

const logger = createLogger('WorkflowEngineService');

export interface ProductionStage {
    id: number;
    stage_code: string;
    stage_name: string;
    stage_order: number;
    workflow_type: string;
    requires_usn: boolean;
    is_active: boolean;
}

export const STANDARD_STAGE_MAPPINGS: Record<string, string> = {
    'PTH': 'PTH',
    'PRESOLDERING': 'PTH',
    'VI': 'VI',
    'VISUALINSPECTION': 'VI',
    'QA': 'QA',
    'QUALITYASSURANCE': 'QA',
    'FLASHING': 'FLASHING',
    'PCBAFCT': 'PCBA_FCT',
    'PCBA_FCT': 'PCBA_FCT',
    'ASSEMBLY': 'ASSEMBLY',
    'UNITTESTING': 'UNIT_TESTING',
    'UNIT_TESTING': 'UNIT_TESTING',
    'QI': 'QI',
    'QUALITYINSPECTION': 'QI',
    'PACKING': 'PACKING',
};

interface CachedStages {
    stages: ProductionStage[];
    cachedAt: number;
}
let stagesCache: CachedStages | null = null;
const STAGES_CACHE_TTL_MS = 60000; // 60 seconds

export function invalidateProductionStagesCache(): void {
    stagesCache = null;
}

export class WorkflowEngineService {
    static invalidateCache(): void {
        invalidateProductionStagesCache();
    }

    /**
     * Retrieves all active production stages, cached in-memory for 60 seconds.
     */
    static async getAllProductionStages(dbClient?: any): Promise<ProductionStage[]> {
        const now = Date.now();
        if (!dbClient && stagesCache && (now - stagesCache.cachedAt < STAGES_CACHE_TTL_MS)) {
            return stagesCache.stages;
        }
        const db = dbClient || pool;
        const res = await db.query(`
            SELECT id, stage_code, stage_name, stage_order, workflow_type, requires_usn, is_active
            FROM production_stages
            WHERE is_active = true
            ORDER BY stage_order ASC
        `);
        const stages: ProductionStage[] = res.rows;
        if (!dbClient) {
            stagesCache = { stages, cachedAt: now };
        }
        return stages;
    }

    /**
     * Canonical stage identifier normalizer.
     * Trims whitespace, uppercases, and removes hyphens, underscores, and spaces.
     */
    static normalizeStageIdentifier(identifier: string): string {
        if (!identifier || typeof identifier !== 'string') return '';
        return identifier.trim().toUpperCase().replace(/[\s\-_]/g, '');
    }

    /**
     * Matches any stage string (code, name, or alias) against an array of production stages.
     */
    static matchStageToProductionStage(stageIdentifier: string, prodStages: ProductionStage[]): ProductionStage | null {
        if (!stageIdentifier) return null;
        const clean = this.normalizeStageIdentifier(stageIdentifier);
        if (!clean) return null;

        // 1. Check known canonical aliases
        const canonicalCode = STANDARD_STAGE_MAPPINGS[clean];
        if (canonicalCode) {
            const found = prodStages.find(ps => ps.stage_code === canonicalCode);
            if (found) return found;
        }

        // 2. Direct match against stage_code or stage_name
        for (const ps of prodStages) {
            const psCodeClean = this.normalizeStageIdentifier(ps.stage_code);
            const psNameClean = this.normalizeStageIdentifier(ps.stage_name);
            if (clean === psCodeClean || clean === psNameClean) {
                return ps;
            }
        }

        return null;
    }

    /**
     * Resolves the authoritative active route for a Work Order or Batch.
     * Orders the selected stages strictly by standard production_stages.stage_order ASC.
     *
     * Fallback rules:
     * - selected_stages is NULL / undefined -> Legacy Work Order -> all standard stages active in order.
     * - selected_stages is empty array [] -> Invalid Work Order configuration -> throws ValidationError.
     */
    static async resolveActiveRoute(
        workOrderOrBatch: {
            workOrderId?: number | null;
            batchId?: number | null;
            woNumber?: string | null;
            selectedStages?: any;
            stagesList?: any;
            dbClient?: any;
        },
        dbClient?: any
    ): Promise<ProductionStage[]> {
        const db = dbClient || workOrderOrBatch.dbClient || pool;

        // 1. Fetch all active standard production stages in authoritative order (cached)
        const allStages = await this.getAllProductionStages(db);
        const allStandardStages: ProductionStage[] = allStages.filter(s => s.workflow_type === 'STANDARD');

        // 2. Determine raw selected_stages from parameter or database
        let rawSelected = workOrderOrBatch.selectedStages !== undefined ? workOrderOrBatch.selectedStages : workOrderOrBatch.stagesList;
        let isExplicitlyProvided = rawSelected !== undefined;

        let woRow: any = null;
        if (workOrderOrBatch.workOrderId) {
            const res = await db.query(
                'SELECT id, wo_number, selected_stages, has_backend FROM work_orders WHERE id = $1',
                [workOrderOrBatch.workOrderId]
            );
            if (res.rows.length > 0) woRow = res.rows[0];
        } else if (workOrderOrBatch.batchId) {
            const res = await db.query(
                `SELECT w.id, w.wo_number, w.selected_stages, w.has_backend 
                 FROM batches b 
                 JOIN work_orders w ON b.work_order_id = w.id 
                 WHERE b.id = $1`,
                [workOrderOrBatch.batchId]
            );
            if (res.rows.length > 0) woRow = res.rows[0];
        } else if (workOrderOrBatch.woNumber) {
            const res = await db.query(
                'SELECT id, wo_number, selected_stages, has_backend FROM work_orders WHERE wo_number = $1',
                [workOrderOrBatch.woNumber]
            );
            if (res.rows.length > 0) woRow = res.rows[0];
        }

        const woNum = woRow?.wo_number || workOrderOrBatch.woNumber;
        if (!isExplicitlyProvided) {
            // Fallback: If not found or selected_stages is null, check smt_work_orders if woNumber is known
            if (woRow && woRow.selected_stages !== null && woRow.selected_stages !== undefined) {
                rawSelected = woRow.selected_stages;
            } else if (woNum) {
                try {
                    const smtRes = await smtPool.query(
                        'SELECT id, selected_stages, has_backend FROM smt_work_orders WHERE id = $1',
                        [woNum]
                    );
                    if (smtRes.rows.length > 0) {
                        if (smtRes.rows[0].selected_stages !== null) {
                            rawSelected = smtRes.rows[0].selected_stages;
                        }
                        if (woRow) woRow.has_backend = smtRes.rows[0].has_backend;
                    }
                } catch (e) {
                    logger.warn(`Failed to query smt_work_orders for WO [${woNum}]: ${(e as any).message}`);
                }
            }
        }

        if (woRow && woRow.has_backend === false) {
            throw new ValidationError({
                errorCode: 'BACKEND_DISABLED',
                message: `Work Order ${woRow.wo_number || ''} is not configured for Backend processing.`,
                severity: 'error'
            });
        }

        // 3. Handle Legacy Work Orders: NULL or undefined means default to all standard stages
        if (rawSelected === null || rawSelected === undefined) {
            return allStandardStages;
        }

        // 4. Parse stringified JSON if needed
        let stageItems: any[] = [];
        if (Array.isArray(rawSelected)) {
            stageItems = rawSelected;
        } else if (typeof rawSelected === 'string') {
            try {
                const parsed = JSON.parse(rawSelected);
                if (Array.isArray(parsed)) {
                    stageItems = parsed;
                } else {
                    stageItems = [];
                }
            } catch {
                stageItems = [];
            }
        } else {
            stageItems = [];
        }

        // 5. Empty array is explicitly INVALID (Requirement 21)
        if (stageItems.length === 0) {
            throw new ValidationError({
                errorCode: 'INVALID_STAGE_SELECTION',
                message: 'Work Order has an empty stage route. At least one stage must be configured.',
                severity: 'error'
            });
        }

        // 6. Match each entry to a standard production stage
        const matchedStages = new Map<number, ProductionStage>();
        for (const item of stageItems) {
            const strVal = typeof item === 'string' ? item : (item?.stage_code || item?.stage_name || '');
            const match = this.matchStageToProductionStage(strVal, allStandardStages);
            if (match && !matchedStages.has(match.id)) {
                matchedStages.set(match.id, match);
            }
        }

        if (matchedStages.size === 0) {
            throw new ValidationError({
                errorCode: 'INVALID_STAGE_SELECTION',
                message: 'None of the configured stages match active production stages.',
                severity: 'error'
            });
        }

        // 7. Sort strictly by standard production_stages.stage_order ASC
        return Array.from(matchedStages.values()).sort((a, b) => a.stage_order - b.stage_order);
    }

    /**
     * Get the first active stage in the Work Order's route.
     */
    static async getFirstStage(
        workOrderOrBatch: { workOrderId?: number | null; batchId?: number | null; woNumber?: string | null; selectedStages?: any },
        dbClient?: any
    ): Promise<ProductionStage> {
        const route = await this.resolveActiveRoute(workOrderOrBatch, dbClient);
        return route[0];
    }

    /**
     * Get the next active stage in the Work Order's route after currentStageId.
     * Returns null if currentStageId is the last stage.
     */
    static async getNextStage(
        currentStageId: number,
        workOrderOrBatch?: { workOrderId?: number | null; batchId?: number | null; woNumber?: string | null; selectedStages?: any } | null,
        condition: string = 'ACCEPTED',
        dbClient?: any
    ): Promise<ProductionStage | null> {
        if (workOrderOrBatch && (workOrderOrBatch.workOrderId || workOrderOrBatch.batchId || workOrderOrBatch.woNumber || workOrderOrBatch.selectedStages)) {
            const route = await this.resolveActiveRoute(workOrderOrBatch, dbClient);
            const currentIndex = route.findIndex(s => s.id === currentStageId);
            if (currentIndex >= 0 && currentIndex < route.length - 1) {
                return route[currentIndex + 1];
            }
            if (currentIndex === -1) {
                const currentStageObj = await this.getStageById(currentStageId, dbClient);
                if (currentStageObj) {
                    const nextIdx = route.findIndex(s => s.stage_order > currentStageObj.stage_order);
                    return nextIdx >= 0 ? route[nextIdx] : null;
                }
            }
            return null;
        }

        // Legacy fallback to static workflow_transitions table
        const db = dbClient || pool;
        const query = `
            SELECT ps.* 
            FROM workflow_transitions wt
            JOIN production_stages ps ON wt.to_stage_id = ps.id
            WHERE wt.from_stage_id = $1 AND wt.on_scan_result = $2 AND wt.is_active = true
            LIMIT 1
        `;
        const res = await db.query(query, [currentStageId, condition]);
        return res.rows.length > 0 ? res.rows[0] : null;
    }

    /**
     * Get the previous active stage in the Work Order's route before currentStageId.
     * Returns null if currentStageId is the first stage.
     */
    static async getPreviousStage(
        currentStageId: number,
        workOrderOrBatch: { workOrderId?: number | null; batchId?: number | null; woNumber?: string | null; selectedStages?: any },
        dbClient?: any
    ): Promise<ProductionStage | null> {
        const route = await this.resolveActiveRoute(workOrderOrBatch, dbClient);
        const currentIndex = route.findIndex(s => s.id === currentStageId);
        if (currentIndex > 0) {
            return route[currentIndex - 1];
        }
        if (currentIndex === -1) {
            const currentStageObj = await this.getStageById(currentStageId, dbClient);
            if (currentStageObj) {
                const prevStages = route.filter(s => s.stage_order < currentStageObj.stage_order);
                return prevStages.length > 0 ? prevStages[prevStages.length - 1] : null;
            }
        }
        return null;
    }

    /**
     * Get the last active stage in the Work Order's route.
     */
    static async getLastStage(
        workOrderOrBatch: { workOrderId?: number | null; batchId?: number | null; woNumber?: string | null; selectedStages?: any },
        dbClient?: any
    ): Promise<ProductionStage> {
        const route = await this.resolveActiveRoute(workOrderOrBatch, dbClient);
        return route[route.length - 1];
    }

    /**
     * Check if a stage (by ID or code) is in the Work Order's active route.
     */
    static async isStageInRoute(
        stageIdOrCode: number | string,
        workOrderOrBatch: { workOrderId?: number | null; batchId?: number | null; woNumber?: string | null; selectedStages?: any },
        dbClient?: any
    ): Promise<boolean> {
        const route = await this.resolveActiveRoute(workOrderOrBatch, dbClient);
        if (typeof stageIdOrCode === 'number') {
            return route.some(s => s.id === stageIdOrCode);
        }
        const clean = this.normalizeStageIdentifier(stageIdOrCode);
        return route.some(s => this.normalizeStageIdentifier(s.stage_code) === clean || this.normalizeStageIdentifier(s.stage_name) === clean);
    }

    /**
     * Strictly validate if a unit is allowed to scan at a target stage.
     * Returns true if valid, or throws a detailed ValidationError if invalid.
     */
    static async validateTransition(
        unit: any | null,
        targetStage: any,
        context?: {
            batchId?: number | null;
            workOrderId?: number | null;
            woNumber?: string | null;
            barcode?: string;
            selectedStages?: any;
            dbClient?: any;
        }
    ): Promise<boolean> {
        const db = context?.dbClient || pool;

        try {
            // 1. Rework and Debug stages are independent repair queues that bypass linear routing
            if (targetStage.stage_code === 'REWORK' || targetStage.stage_code === 'DEBUG') {
                if (!unit) {
                    throw new ValidationError({
                        errorCode: 'NO_PRODUCTION_HISTORY',
                        message: 'Barcode has no production scan history.',
                        currentStage: targetStage.stage_name,
                        suggestedAction: 'Please scan this barcode at its initial production stage first.',
                        severity: 'error'
                    });
                }
                if (unit.current_status !== targetStage.stage_code) {
                    throw new ValidationError({
                        errorCode: 'WRONG_REPAIR_STATUS',
                        message: `Barcode is not in ${targetStage.stage_code} status. Current status is ${unit.current_status}.`,
                        currentStage: targetStage.stage_name,
                        suggestedAction: `Ensure this unit is marked as ${targetStage.stage_code} from its failed production stage first.`,
                        severity: 'error'
                    });
                }
                return true;
            }

            // 2. Resolve the authoritative active route for this Work Order
            const activeRoute = await this.resolveActiveRoute({
                batchId: context?.batchId || unit?.batch_id,
                workOrderId: context?.workOrderId,
                woNumber: context?.woNumber || unit?.unit_wo_number,
                selectedStages: context?.selectedStages
            }, db);

            // 3. Ensure the target stage is included in the Work Order's active route
            const targetIndex = activeRoute.findIndex(s => s.id === targetStage.id);
            if (targetIndex === -1) {
                throw new ValidationError({
                    errorCode: 'STAGE_NOT_IN_ROUTING',
                    message: `Stage "${targetStage.stage_name}" (${targetStage.stage_code}) is not part of this Work Order's process routing.`,
                    currentStage: targetStage.stage_name,
                    suggestedAction: 'This stage was not selected when the Work Order was created. Scanning is not allowed here.',
                    severity: 'error'
                });
            }

            // 4. First Scan Validation: new unit scanning for the first time
            if (!unit) {
                const firstStage = activeRoute[0];
                if (targetStage.id !== firstStage.id) {
                    throw new ValidationError({
                        errorCode: 'INVALID_STAGE',
                        message: 'Previous required stage is missing.',
                        requiredStage: `${firstStage.stage_name} (${firstStage.stage_code})`,
                        currentStage: targetStage.stage_name,
                        suggestedAction: `Please scan this barcode in ${firstStage.stage_name} (${firstStage.stage_code}) stage first before proceeding.`,
                        severity: 'error'
                    });
                }

                // Check if Work Order has SMT enabled
                let woNumber = context?.woNumber;
                let hasSmt = true;

                if (context?.workOrderId) {
                    const woRes = await db.query(
                        'SELECT wo_number, has_smt FROM work_orders WHERE id = $1',
                        [context.workOrderId]
                    );
                    if (woRes.rows.length > 0) {
                        hasSmt = woRes.rows[0].has_smt !== false;
                        woNumber = woRes.rows[0].wo_number;
                    }
                } else if (context?.batchId) {
                    const woRes = await db.query(
                        `SELECT w.wo_number, w.has_smt 
                         FROM batches b 
                         JOIN work_orders w ON b.work_order_id = w.id 
                         WHERE b.id = $1`,
                        [context.batchId]
                    );
                    if (woRes.rows.length > 0) {
                        hasSmt = woRes.rows[0].has_smt !== false;
                        woNumber = woRes.rows[0].wo_number;
                    }
                } else if (woNumber) {
                    const woRes = await db.query(
                        'SELECT wo_number, has_smt FROM work_orders WHERE wo_number = $1',
                        [woNumber]
                    );
                    if (woRes.rows.length > 0) {
                        hasSmt = woRes.rows[0].has_smt !== false;
                    }
                }

                if (hasSmt) {
                    const barcodeToTest = context?.barcode || unit?.barcode;
                    if (barcodeToTest) {
                        const cleanBarcode = barcodeToTest.trim().toUpperCase();
                        // Query SMT database for PASS record in SMT FG for this barcode
                        const smtPassCheck = await smtPool.query(
                            `SELECT 1 
                             FROM smt_inspections i
                             LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                             WHERE (UPPER(TRIM(i.scanned_barcode)) = $1 OR UPPER(TRIM(sn.serial_number)) = $1)
                               AND i.process_step = 'SMT FG'
                               AND i.status = 'PASS'
                             LIMIT 1`,
                            [cleanBarcode]
                        );

                        if (smtPassCheck.rows.length === 0) {
                            // Check if the serial was generated in SMT
                            const smtSerialCheck = await smtPool.query(
                                `SELECT id, serial_number FROM smt_serial_numbers 
                                 WHERE UPPER(TRIM(serial_number)) = $1`,
                                [cleanBarcode]
                            );

                            // Check latest inspection status in SMT (if any scans exist)
                            const smtLatestInspection = await smtPool.query(
                                `SELECT i.process_step, i.status, i.rework_reason
                                 FROM smt_inspections i
                                 LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                                 WHERE UPPER(TRIM(i.scanned_barcode)) = $1 OR UPPER(TRIM(sn.serial_number)) = $1
                                 ORDER BY i.scanned_at DESC, i.id DESC
                                 LIMIT 1`,
                                [cleanBarcode]
                            );

                            if (smtLatestInspection.rows.length > 0) {
                                const latest = smtLatestInspection.rows[0];
                                const statusUpper = (latest.status || '').toUpperCase();
                                if (['FAIL', 'FAILED', 'REWORK', 'INVALID'].includes(statusUpper)) {
                                    throw new ValidationError({
                                        errorCode: 'SMT_UNIT_FAILED',
                                        message: `Barcode "${cleanBarcode}" failed in SMT process (${latest.process_step}: ${latest.status}) and cannot enter Backend.`,
                                        currentStage: targetStage.stage_name,
                                        suggestedAction: `This unit failed at SMT stage ${latest.process_step}. Please repair and pass it in SMT line first.`,
                                        severity: 'error'
                                    });
                                }
                            }

                            if (smtSerialCheck.rows.length === 0 && smtLatestInspection.rows.length === 0) {
                                throw new ValidationError({
                                    errorCode: 'SMT_SERIAL_NOT_FOUND',
                                    message: `Barcode "${cleanBarcode}" was not generated or processed in SMT line.`,
                                    currentStage: targetStage.stage_name,
                                    suggestedAction: 'Please generate serial number and process it through SMT stages first.',
                                    severity: 'error'
                                });
                            }

                            throw new ValidationError({
                                errorCode: 'SMT_FG_NOT_PASSED',
                                message: `Barcode "${cleanBarcode}" has not passed SMT FG stage yet.`,
                                currentStage: targetStage.stage_name,
                                suggestedAction: 'This unit must complete and pass the SMT FG stage before entering Backend process routing.',
                                severity: 'error'
                            });
                        }
                    }
                }

                return true;
            }

            // 5. Existing unit scanning in the SAME stage
            if (unit.current_stage_id === targetStage.id) {
                if (unit.current_status === 'ACCEPTED' || unit.current_status === 'COMPLETED') {
                    throw new ValidationError({
                        errorCode: 'ALREADY_COMPLETED',
                        message: 'Barcode already completed this stage.',
                        currentStage: targetStage.stage_name,
                        actualStage: targetStage.stage_name,
                        severity: 'warning'
                    });
                }
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
                // If it is PENDING, READY_FOR_RESCAN, or FAILED, allow retry/rescan
                if (['PENDING', 'READY_FOR_RESCAN', 'FAILED'].includes(unit.current_status)) {
                    return true;
                }
            }

            // 6. Unit is transitioning from a different stage
            // Current stage must have been passed (ACCEPTED)
            const currentIndex = activeRoute.findIndex(s => s.id === unit.current_stage_id);
            const currentStageObj = currentIndex >= 0 ? activeRoute[currentIndex] : await this.getStageById(unit.current_stage_id, db);
            const currentStageName = currentStageObj ? `${currentStageObj.stage_name} (${currentStageObj.stage_code})` : 'Previous Stage';

            if (unit.current_status !== 'ACCEPTED' && unit.current_status !== 'COMPLETED') {
                throw new ValidationError({
                    errorCode: 'INVALID_TRANSITION',
                    message: `Barcode has not passed ${currentStageName}. Current status is ${unit.current_status}.`,
                    currentStage: targetStage.stage_name,
                    actualStage: currentStageName,
                    suggestedAction: `Barcode must complete and be marked as ACCEPTED at ${currentStageName} before proceeding.`,
                    severity: 'error'
                });
            }

            // Determine the expected next stage in the active route
            let expectedNextStage: ProductionStage | null = null;
            if (currentIndex >= 0) {
                expectedNextStage = activeRoute[currentIndex + 1] || null;
            } else if (currentStageObj) {
                // If unit's current_stage_id is NOT in activeRoute (e.g. stage was removed/skipped after unit completed it),
                // find the first stage in activeRoute whose stage_order > currentStageObj.stage_order
                const nextIdx = activeRoute.findIndex(s => s.stage_order > currentStageObj.stage_order);
                expectedNextStage = nextIdx >= 0 ? activeRoute[nextIdx] : null;
            } else {
                expectedNextStage = activeRoute[0] || null;
            }

            if (!expectedNextStage) {
                throw new ValidationError({
                    errorCode: 'INVALID_TRANSITION',
                    message: 'Barcode has already completed all configured stages for this Work Order.',
                    currentStage: targetStage.stage_name,
                    actualStage: currentStageName,
                    suggestedAction: 'This unit has reached its final production stage.',
                    severity: 'warning'
                });
            }

            if (targetStage.id !== expectedNextStage.id) {
                throw new ValidationError({
                    errorCode: 'INVALID_TRANSITION',
                    message: 'Previous required stage is missing or invalid sequence.',
                    requiredStage: `${expectedNextStage.stage_name} (${expectedNextStage.stage_code})`,
                    currentStage: targetStage.stage_name,
                    actualStage: currentStageName,
                    suggestedAction: `Barcode must complete the correct previous stage sequence. It is currently at ${currentStageName}. Expected next stage is ${expectedNextStage.stage_name} (${expectedNextStage.stage_code}).`,
                    severity: 'error'
                });
            }

            // 7. Dynamic USN Requirement Check:
            // Only enforce USN linking if a prior stage IN THIS WORK ORDER'S ACTIVE ROUTE requires a USN
            const priorRequiresUsn = activeRoute.some(s => s.stage_order < targetStage.stage_order && s.requires_usn);
            if (priorRequiresUsn) {
                const mappingRes = await db.query(
                    'SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1',
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
     * Get stage record by its code.
     */
    static async getStageByCode(stageCode: string, dbClient?: any): Promise<ProductionStage | null> {
        try {
            const allStages = await this.getAllProductionStages(dbClient);
            const found = this.matchStageToProductionStage(stageCode, allStages);
            if (found) return found;
            return allStages.find(s => s.stage_code.toUpperCase() === stageCode.trim().toUpperCase()) || null;
        } catch (error: any) {
            logger.error(`Error in getStageByCode: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get stage record by its ID.
     */
    static async getStageById(stageId: number, dbClient?: any): Promise<ProductionStage | null> {
        try {
            const allStages = await this.getAllProductionStages(dbClient);
            return allStages.find(s => s.id === stageId) || null;
        } catch (error: any) {
            logger.error(`Error in getStageById: ${error.message}`);
            throw error;
        }
    }
}
