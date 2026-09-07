import { Request, Response } from 'express';
import pool, { smtPool } from '../config/db';
import { syncSmtWorkOrders, syncSingleWorkOrder } from '../services/workOrderSyncService';
import { ValidationService } from '../services/validation/ValidationService';
import { WorkflowEngineService } from '../services/workflow/WorkflowEngineService';

export const trackBarcode = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Barcode or Unit Serial Number is required.' });
    }

    const inputValue = id.trim().toUpperCase();

    try {
        // --- Dual Search: accept PCB barcode OR Unit Serial Number ---
        let barcode = inputValue;
        let unitSerialNumber: string | null = null;

        // Check if the input is direct PCB barcode in units table
        const pcbCheck = await pool.query(`SELECT barcode FROM units WHERE barcode = $1`, [inputValue]);
        if (pcbCheck.rows.length > 0) {
            barcode = pcbCheck.rows[0].barcode;
            // Lookup its USN if mapped
            const usnRes = await pool.query(`SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1`, [barcode]);
            if (usnRes.rows.length > 0) {
                unitSerialNumber = usnRes.rows[0].unit_serial_number;
            }
        } else {
            // Check if it's a mapped Unit Serial Number
            const usnResult = await pool.query(
                `SELECT barcode, unit_serial_number FROM unit_serial_mapping WHERE unit_serial_number = $1`,
                [inputValue]
            );
            if (usnResult.rows.length > 0) {
                barcode = usnResult.rows[0].barcode;
                unitSerialNumber = usnResult.rows[0].unit_serial_number;
            }
        }

        // 1. Main tracking info (current state) from units ledger
        const trackingResult = await pool.query(`
            SELECT 
                u.barcode,
                u.current_status,
                u.failed_at AS failure_created_at,
                u.last_scanned_at AS last_updated_at,
                b.id AS batch_id,
                b.batch_number,
                wo.id AS work_order_id,
                wo.wo_number,
                wo.customer_name,
                wo.model,
                wo.quantity,
                ps.stage_name AS current_stage,
                fps.stage_name AS failed_stage
            FROM units u
            LEFT JOIN batches b ON u.batch_id = b.id
            LEFT JOIN work_orders wo ON b.work_order_id = wo.id
            LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
            LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
            WHERE u.barcode = $1
        `, [barcode]);

        if ((trackingResult.rowCount ?? 0) === 0) {
            // Check if it exists in SMT serial numbers (generated but not yet scanned in backend)
            try {
                const smtSerialRes = await smtPool.query(`
                    SELECT sn.serial_number, sn.work_order_id, wo.customer_name, wo.model_name, wo.quantity, wo.selected_stages
                    FROM smt_serial_numbers sn
                    LEFT JOIN smt_work_orders wo ON sn.work_order_id = wo.id
                    WHERE UPPER(TRIM(sn.serial_number)) = $1
                    LIMIT 1
                `, [inputValue]);

                if (smtSerialRes.rowCount && smtSerialRes.rowCount > 0) {
                    const smtSn = smtSerialRes.rows[0];
                    const activeRoute = await WorkflowEngineService.resolveActiveRoute({ stagesList: smtSn.selected_stages });
                    const firstStage = activeRoute.length > 0 ? activeRoute[0].stage_name : 'Pre-Soldering';
                    return res.status(200).json({
                        barcode: smtSn.serial_number,
                        unit_serial_number: null,
                        searched_by: 'barcode',
                        batch_number: smtSn.work_order_id || '-',
                        wo_number: smtSn.work_order_id || '-',
                        customer_name: smtSn.customer_name || '-',
                        model: smtSn.model_name || '-',
                        quantity: smtSn.quantity || '-',
                        current_stage: firstStage,
                        current_status: 'PENDING',
                        failed_stage: null,
                        final_status_label: 'AWAITING FIRST SCAN',
                        last_updated_at: null,
                        failure_created_at: null,
                        repair_completed_at: null,
                        revalidated_passed_at: null,
                        total_failures: 0,
                        total_reworks: 0,
                        total_debugs: 0,
                        scan_history: [],
                    });
                }
            } catch (smtErr) {
                console.warn('Fallback check to smt_serial_numbers failed:', smtErr);
            }

            return res.status(404).json({
                error: `"${inputValue}" was not found in the system. Please check the barcode or Unit Serial Number.`,
                code: 'UNIT_NOT_FOUND'
            });
        }

        const tracking = trackingResult.rows[0];

        // 2. Full scan history from centralized scans log
        const historyResult = await pool.query(`
            SELECT 
                ps.stage_name AS station,
                ps.stage_order,
                s.scan_result AS status,
                s.scanned_by,
                s.scanned_at,
                s.remarks,
                s.resolution_remarks,
                m.unit_serial_number
            FROM scans s
            JOIN production_stages ps ON s.stage_id = ps.id
            LEFT JOIN unit_serial_mapping m ON s.barcode = m.barcode
            WHERE s.barcode = $1
            ORDER BY s.scanned_at ASC
        `, [barcode]);

        const history = historyResult.rows.map((row: any) => {
            const isRework = row.station === 'Rework';
            const isDebug = row.station === 'Debug';
            const isFailure = row.status === 'REWORK' || row.status === 'DEBUG' || row.status === 'FAILED';
            
            return {
                station: row.station,
                stage_order: row.stage_order,
                status: (row.status || '').toUpperCase(),
                scanned_by: row.scanned_by || '-',
                scanned_at: row.scanned_at,
                remarks: isFailure ? row.remarks : null,
                resolution_remarks: (!isFailure && !isRework && !isDebug) ? row.resolution_remarks : null,
                failed_at: isFailure ? row.scanned_at : null,
                failed_remarks: isFailure ? row.remarks : null,
                repair_remark: (isRework || isDebug) ? row.remarks : null,
                repair_time: (isRework || isDebug) ? row.scanned_at : null,
                unit_serial_number: row.unit_serial_number || null,
            };
        });

        // 3. Find dynamic repair timestamps
        const failureCreatedAt = tracking.failure_created_at;

        // Find repair_completed_at: latest scan at stage_id = 10 (Rework) or 11 (Debug) with status RESOLVED or ACCEPTED
        const repairRes = await pool.query(`
            SELECT scanned_at FROM scans 
            WHERE barcode = $1 AND stage_id IN (10, 11) AND scan_result IN ('RESOLVED', 'ACCEPTED', 'PASS') 
            ORDER BY scanned_at DESC LIMIT 1
        `, [barcode]);
        const repairCompletedAt = repairRes.rows.length > 0 ? repairRes.rows[0].scanned_at : null;

        // Find revalidated_passed_at: first successful scan at any stage that was >= the failed stage, scanned after repair_completed_at (if exists), or after failure_created_at
        let revalidatedPassedAt = null;
        if (failureCreatedAt) {
            const revalQuery = `
                SELECT scanned_at FROM scans 
                WHERE barcode = $1 
                  AND scan_result = 'ACCEPTED' 
                  AND scanned_at > $2
                ORDER BY scanned_at ASC LIMIT 1
            `;
            const revalRes = await pool.query(revalQuery, [barcode, repairCompletedAt || failureCreatedAt]);
            if (revalRes.rows.length > 0) {
                revalidatedPassedAt = revalRes.rows[0].scanned_at;
            }
        }

        // 4. Compute summary stats
        const totalFailures = history.filter((h: any) => h.status === 'REWORK' || h.status === 'DEBUG' || h.status === 'FAILED').length;
        const totalReworks = history.filter((h: any) => h.station === 'Rework').length;
        const totalDebugs = history.filter((h: any) => h.station === 'Debug').length;

        // 5. Compute "final status" label dynamically based on active work order route
        const status = (tracking.current_status || '').toUpperCase();
        let finalStatusLabel = 'IN PRODUCTION';
        const lastStage = await WorkflowEngineService.getLastStage({
            workOrderId: tracking.work_order_id,
            batchId: tracking.batch_id
        });
        const isFinalStage = lastStage 
            ? (tracking.current_stage === lastStage.stage_name || tracking.current_stage === lastStage.stage_code)
            : tracking.current_stage === 'Packing';

        if (status === 'ACCEPTED' && isFinalStage) {
            finalStatusLabel = 'COMPLETED';
        } else if (status === 'ACCEPTED') {
            finalStatusLabel = 'IN PRODUCTION';
        } else if (status === 'REWORK') {
            finalStatusLabel = 'IN REWORK';
        } else if (status === 'DEBUG') {
            finalStatusLabel = 'IN DEBUG';
        } else if (status === 'READY_FOR_RESCAN') {
            finalStatusLabel = 'REPAIR DONE – AWAITING RESCAN';
        }

        return res.status(200).json({
            barcode: tracking.barcode,
            unit_serial_number: unitSerialNumber,
            searched_by: inputValue !== barcode ? 'unit_serial_number' : 'barcode',
            batch_number: tracking.batch_number || '-',
            wo_number: tracking.wo_number || '-',
            customer_name: tracking.customer_name || '-',
            model: tracking.model || '-',
            quantity: tracking.quantity || '-',
            current_stage: tracking.current_stage || 'Unknown',
            current_status: status,
            failed_stage: tracking.failed_stage || null,
            final_status_label: finalStatusLabel,
            last_updated_at: tracking.last_updated_at,
            failure_created_at: failureCreatedAt,
            repair_completed_at: repairCompletedAt,
            revalidated_passed_at: revalidatedPassedAt,
            total_failures: totalFailures,
            total_reworks: totalReworks,
            total_debugs: totalDebugs,
            scan_history: history,
        });

    } catch (err: any) {
        console.error('❌ Error in trackBarcode:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};

export const validateScanController = async (req: Request, res: Response) => {
    const { stage_code, barcode, batch_number, work_order_id, failed_stage_id } = req.body;

    if (!stage_code || !barcode || !batch_number) {
        return res.status(400).json({
            success: false,
            error: 'Missing required validation parameters: stage_code, barcode, and batch_number are required.'
        });
    }

    try {
        const result = await ValidationService.validateScanBeforeAction(stage_code, {
            barcode,
            batch_number,
            work_order_id: work_order_id ? parseInt(work_order_id) : null,
            failed_stage_id: failed_stage_id ? parseInt(failed_stage_id) : null
        });

        return res.status(200).json(result);
    } catch (err: any) {
        if (err.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                error: err.message,
                errorCode: err.errorCode,
                suggestedAction: err.suggestedAction,
                severity: err.severity,
                currentStage: err.currentStage,
                requiredStage: err.requiredStage,
                workOrder: err.workOrder,
                batch: err.batch,
                actualBatch: err.actualBatch,
                actualStage: err.actualStage
            });
        }
        return res.status(500).json({
            success: false,
            error: err.message || 'Internal Server Error during pre-validation.'
        });
    }
};

export const trackWorkOrder = async (req: Request, res: Response) => {
    const { woId } = req.params;

    if (!woId || woId.trim() === '') {
        return res.status(400).json({ error: 'Work Order ID is required.' });
    }

    const inputValue = woId.trim().toUpperCase();

    try {
        // 1. Find the work order record by wo_number OR integer ID
        let woResult = await pool.query(
            `SELECT * FROM work_orders 
             WHERE UPPER(TRIM(wo_number)) = $1 
                OR (CASE WHEN $1 ~ '^[0-9]+$' THEN id = $1::int ELSE false END)
             LIMIT 1`,
            [inputValue]
        );

        if ((woResult.rowCount ?? 0) === 0) {
            await syncSingleWorkOrder(inputValue);
            woResult = await pool.query(
                `SELECT * FROM work_orders 
                 WHERE UPPER(TRIM(wo_number)) = $1 
                    OR (CASE WHEN $1 ~ '^[0-9]+$' THEN id = $1::int ELSE false END)
                 LIMIT 1`,
                [inputValue]
            );
        }

        if ((woResult.rowCount ?? 0) === 0) {
            return res.status(404).json({
                error: `Work Order "${inputValue}" was not found in the system.`,
                code: 'WORK_ORDER_NOT_FOUND'
            });
        }

        const wo = woResult.rows[0];

        // 2. Fetch all serials for this WO (join units with batches)
        const serialsResult = await pool.query(`
            SELECT u.id, u.barcode, u.current_status, m.unit_serial_number, u.created_at, ps.stage_name as current_stage
            FROM units u
            JOIN batches b ON u.batch_id = b.id
            LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
            LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
            WHERE b.work_order_id = $1
            ORDER BY u.id ASC
        `, [wo.id]);

        const serials = serialsResult.rows;

        // 3. Fetch all scans for these serials
        const historyResult = await pool.query(`
            SELECT s.barcode, ps.stage_name as station, s.scan_result as status, s.scanned_by, s.scanned_at, s.remarks
            FROM scans s
            JOIN production_stages ps ON s.stage_id = ps.id
            JOIN batches b ON s.batch_id = b.id
            WHERE b.work_order_id = $1
            ORDER BY s.scanned_at ASC
        `, [wo.id]);

        const historyBySerial: { [key: string]: any[] } = {};
        historyResult.rows.forEach((row: any) => {
            if (!historyBySerial[row.barcode]) historyBySerial[row.barcode] = [];
            historyBySerial[row.barcode].push(row);
        });

        const activeRoute = await WorkflowEngineService.resolveActiveRoute({ workOrderId: wo.id });
        const stepNames = activeRoute.length > 0
            ? activeRoute.map(s => s.stage_name)
            : [
                'Pre-Soldering', 
                'Visual Inspection', 
                'Quality Assurance', 
                'Flashing', 
                'PCBA FCT', 
                'Assembly', 
                'Unit Testing', 
                'Quality Inspection', 
                'Packing'
            ];
        const lastStage = activeRoute.length > 0 ? activeRoute[activeRoute.length - 1] : null;
        const isFinalStage = (stageName: string) => {
            if (!lastStage) return stageName === 'Packing';
            return stageName === lastStage.stage_name || stageName === lastStage.stage_code;
        };

        const mappedSerials = serials.map((s: any) => {
            const history = historyBySerial[s.barcode] || [];
            
            let currentStage = s.current_stage || 'Unknown';
            let currentStatus = s.current_status || 'PENDING';
            
            const totalFailures = history.filter((h: any) => h.status === 'REWORK' || h.status === 'DEBUG' || h.status === 'FAILED').length;
            const totalReworks = history.filter((h: any) => h.station === 'Rework').length;
            const totalDebugs = history.filter((h: any) => h.station === 'Debug').length;
            const totalPassed = history.filter((h: any) => h.status === 'ACCEPTED' || h.status === 'PASS').length;

            const step_status: { [key: string]: string } = {};
            stepNames.forEach(step => {
                const stepHist = history.filter((h: any) => h.station === step);
                if (stepHist.length > 0) {
                    step_status[step] = stepHist[stepHist.length - 1].status;
                } else {
                    step_status[step] = '-';
                }
            });

            let finalStatusLabel = 'Pending';
            if (s.current_status === 'ACCEPTED' && isFinalStage(s.current_stage)) {
                finalStatusLabel = 'Completed';
            }

            return {
                serial_number: s.barcode,
                unit_serial_number: s.unit_serial_number,
                current_stage: currentStage,
                current_status: currentStatus,
                final_status_label: finalStatusLabel,
                total_failures: totalFailures,
                total_reworks: totalReworks,
                total_debugs: totalDebugs,
                total_passed: totalPassed,
                step_status: step_status,
                created_at: s.created_at
            };
        });

        return res.status(200).json({
            work_order_id: wo.wo_number,
            product_name: wo.customer_name + ' ' + wo.model,
            quantity: wo.quantity,
            line_id: '-',
            total_serials: serials.length,
            serials: mappedSerials
        });

    } catch (err: any) {
        console.error('❌ Error in trackWorkOrder:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};

export const getBatchUnitDetails = async (req: Request, res: Response) => {
    const batchId = parseInt(req.query.batchId as string);
    const stageCode = (req.query.stageCode as string || '').toUpperCase();
    const columnType = req.query.columnType as string; // 'previousStagePassed' | 'scanned' | 'pending' | 'passed' | 'rework' | 'debug'
    const failedStageId = req.query.failedStageId ? parseInt(req.query.failedStageId as string) : null;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string || '';

    if (!batchId || !stageCode || !columnType) {
        return res.status(400).json({ error: 'Missing required parameters: batchId, stageCode, and columnType are required.' });
    }

    try {
        // Find stage details
        const stageRes = await pool.query(`
            SELECT id, stage_order, stage_name FROM production_stages 
            WHERE UPPER(REPLACE(REPLACE(stage_code, '-', '_'), ' ', '_')) = UPPER(REPLACE(REPLACE($1, '-', '_'), ' ', '_'))
               OR UPPER(stage_name) = UPPER($1)
            LIMIT 1
        `, [stageCode]);
        if (stageRes.rows.length === 0) {
            return res.status(404).json({ error: `Stage with code "${stageCode}" not found.`, code: 'STAGE_NOT_FOUND' });
        }
        const stageId = stageRes.rows[0].id;
        const stageOrder = stageRes.rows[0].stage_order;

        let prevStageId = null;
        let prevStageName = '';
        if (stageCode !== 'REWORK' && stageCode !== 'DEBUG') {
            const prevStage = await WorkflowEngineService.getPreviousStage(stageId, { batchId });
            if (prevStage) {
                prevStageId = prevStage.id;
                prevStageName = prevStage.stage_name;
            }
        }
        const prevStageLabel = prevStageName ? `${prevStageName} - Passed` : '-';
        const prevStageEscaped = prevStageLabel.replace(/'/g, "''");

        let baseQuery = '';
        let queryParams: any[] = [];

        if (stageCode === 'REWORK' || stageCode === 'DEBUG') {
            // Rework / Debug Pages
            if (columnType === 'scanned') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        fps.stage_name AS previous_stage,
                        u.current_status AS status,
                        s.scanned_at AS scan_date_time,
                        s.scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        s.remarks AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN scans s ON s.id = (
                        SELECT s2.id 
                        FROM scans s2 
                        WHERE s2.barcode = u.barcode AND s2.stage_id = $2 AND s2.batch_id = $1 
                        ORDER BY s2.scanned_at DESC LIMIT 1
                    )
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE u.barcode IN (
                        SELECT DISTINCT s2.barcode
                        FROM scans s2
                        WHERE s2.batch_id = $1 
                          AND s2.stage_id = $2
                          AND (
                              SELECT sf.stage_id 
                              FROM scans sf 
                              WHERE sf.barcode = s2.barcode 
                                AND sf.scan_result IN ('REWORK', 'DEBUG') 
                                AND sf.scanned_at < s2.scanned_at 
                              ORDER BY sf.scanned_at DESC LIMIT 1
                          ) = $3
                    )
                `;
                queryParams = [batchId, stageId, failedStageId];
            } else if (columnType === 'pending' || columnType === 'rework' || columnType === 'debug') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        fps.stage_name AS previous_stage,
                        u.current_status AS status,
                        u.failed_at AS scan_date_time,
                        u.last_scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        u.failure_remark AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE u.batch_id = $1 
                      AND u.current_status = $2
                      AND u.failed_stage_id = $3
                `;
                queryParams = [batchId, stageCode, failedStageId];
            } else if (columnType === 'passed') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        fps.stage_name AS previous_stage,
                        u.current_status AS status,
                        s.scanned_at AS scan_date_time,
                        s.scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        s.remarks AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN scans s ON s.id = (
                        SELECT s2.id 
                        FROM scans s2 
                        WHERE s2.barcode = u.barcode AND s2.stage_id = $2 AND s2.scan_result IN ('ACCEPTED', 'RESOLVED') 
                        ORDER BY s2.scanned_at DESC LIMIT 1
                    )
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE u.barcode IN (
                        SELECT DISTINCT s2.barcode
                        FROM scans s2
                        WHERE s2.batch_id = $1 
                          AND s2.stage_id = $2 
                          AND s2.scan_result IN ('ACCEPTED', 'RESOLVED')
                          AND (
                              SELECT sf.stage_id 
                              FROM scans sf 
                              WHERE sf.barcode = s2.barcode 
                                AND sf.scan_result IN ('REWORK', 'DEBUG') 
                                AND sf.scanned_at < s2.scanned_at 
                              ORDER BY sf.scanned_at DESC LIMIT 1
                          ) = $3
                    )
                `;
                queryParams = [batchId, stageId, failedStageId];
            } else {
                return res.status(400).json({ error: 'Invalid columnType for repair stage.' });
            }
        } else {
            // Standard Stage Pages
            if (columnType === 'previousStagePassed') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        '${prevStageEscaped}'::varchar AS previous_stage,
                        u.current_status AS status,
                        u.last_scanned_at AS scan_date_time,
                        u.last_scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        u.failure_remark AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE wo.id = (SELECT work_order_id FROM batches WHERE id = $1)
                      AND ($2::int IS NULL OR u.current_stage_id > $2::int OR (u.current_stage_id = $2::int AND u.current_status = 'ACCEPTED'))
                `;
                queryParams = [batchId, prevStageId];
            } else if (columnType === 'scanned') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        '${prevStageEscaped}'::varchar AS previous_stage,
                        u.current_status AS status,
                        s.scanned_at AS scan_date_time,
                        s.scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        s.remarks AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN scans s ON s.id = (
                        SELECT s2.id 
                        FROM scans s2 
                        WHERE s2.barcode = u.barcode AND s2.stage_id = $2 AND s2.batch_id = $1 
                        ORDER BY s2.scanned_at DESC LIMIT 1
                    )
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE u.barcode IN (
                        SELECT DISTINCT s2.barcode
                        FROM scans s2
                        WHERE s2.batch_id = $1 AND s2.stage_id = $2
                    )
                `;
                queryParams = [batchId, stageId];
            } else if (columnType === 'pending') {
                if (prevStageId === null) {
                    baseQuery = `
                        SELECT 
                            NULL::varchar AS barcode,
                            wo.wo_number,
                            b.batch_number,
                            wo.customer_name,
                            wo.model,
                            'Expected'::varchar AS current_stage,
                            NULL::varchar AS previous_stage,
                            'PENDING'::varchar AS status,
                            NULL::timestamp AS scan_date_time,
                            NULL::varchar AS operator,
                            NULL::varchar AS failed_stage,
                            NULL::varchar AS rework_debug_reason,
                            NULL::varchar AS unit_serial_number
                        FROM batches b
                        JOIN work_orders wo ON b.work_order_id = wo.id
                        WHERE b.id = $1
                        LIMIT 0
                    `;
                    queryParams = [batchId];
                } else {
                    baseQuery = `
                        SELECT 
                            u.barcode,
                            wo.wo_number,
                            b.batch_number,
                            wo.customer_name,
                            wo.model,
                            ps.stage_name AS current_stage,
                            '${prevStageEscaped}'::varchar AS previous_stage,
                            'PENDING'::varchar AS status,
                            u.last_scanned_at AS scan_date_time,
                            u.last_scanned_by AS operator,
                            fps.stage_name AS failed_stage,
                            u.failure_remark AS rework_debug_reason,
                            m.unit_serial_number
                        FROM units u
                        JOIN batches b ON u.batch_id = b.id
                        JOIN work_orders wo ON b.work_order_id = wo.id
                        LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                        LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                        LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                        WHERE u.batch_id = $1
                          AND u.barcode NOT IN (
                              SELECT DISTINCT s2.barcode
                              FROM scans s2
                              WHERE s2.batch_id = $1 AND s2.stage_id = $2
                          )
                    `;
                    queryParams = [batchId, stageId];
                }
            } else if (columnType === 'passed') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        '${prevStageEscaped}'::varchar AS previous_stage,
                        u.current_status AS status,
                        s.scanned_at AS scan_date_time,
                        s.scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        u.failure_remark AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN scans s ON s.id = (
                        SELECT s2.id 
                        FROM scans s2 
                        WHERE s2.barcode = u.barcode AND s2.stage_id = $2 AND s2.scan_result = 'ACCEPTED' 
                        ORDER BY s2.scanned_at DESC LIMIT 1
                    )
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE u.batch_id = $1
                      AND (u.current_stage_id > $2 OR (u.current_stage_id = $2 AND u.current_status = 'ACCEPTED'))
                `;
                queryParams = [batchId, stageId];
            } else if (columnType === 'rework') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        '${prevStageEscaped}'::varchar AS previous_stage,
                        u.current_status AS status,
                        u.failed_at AS scan_date_time,
                        u.last_scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        u.failure_remark AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE u.batch_id = $1
                      AND u.failed_stage_id = $2
                      AND (u.current_stage_id = $2 OR u.current_stage_id = 10 OR u.current_stage_id = 11)
                      AND u.current_status != 'ACCEPTED'
                      AND (
                          SELECT s2.scan_result 
                          FROM scans s2 
                          WHERE s2.barcode = u.barcode AND s2.stage_id = $2 AND s2.scan_result IN ('REWORK', 'DEBUG') 
                          ORDER BY s2.scanned_at DESC LIMIT 1
                      ) = 'REWORK'
                `;
                queryParams = [batchId, stageId];
            } else if (columnType === 'debug') {
                baseQuery = `
                    SELECT 
                        u.barcode,
                        wo.wo_number,
                        b.batch_number,
                        wo.customer_name,
                        wo.model,
                        ps.stage_name AS current_stage,
                        '${prevStageEscaped}'::varchar AS previous_stage,
                        u.current_status AS status,
                        u.failed_at AS scan_date_time,
                        u.last_scanned_by AS operator,
                        fps.stage_name AS failed_stage,
                        u.failure_remark AS rework_debug_reason,
                        m.unit_serial_number
                    FROM units u
                    JOIN batches b ON u.batch_id = b.id
                    JOIN work_orders wo ON b.work_order_id = wo.id
                    LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                    LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
                    LEFT JOIN unit_serial_mapping m ON u.barcode = m.barcode
                    WHERE u.batch_id = $1
                      AND u.failed_stage_id = $2
                      AND (u.current_stage_id = $2 OR u.current_stage_id = 10 OR u.current_stage_id = 11)
                      AND u.current_status != 'ACCEPTED'
                      AND (
                          SELECT s2.scan_result 
                          FROM scans s2 
                          WHERE s2.barcode = u.barcode AND s2.stage_id = $2 AND s2.scan_result IN ('REWORK', 'DEBUG') 
                          ORDER BY s2.scanned_at DESC LIMIT 1
                      ) = 'DEBUG'
                `;
                queryParams = [batchId, stageId];
            } else {
                return res.status(400).json({ error: 'Invalid columnType for standard stage.' });
            }
        }

        const searchParamIdx = queryParams.length + 1;
        let countQuery = `
            WITH detail_list AS (${baseQuery})
            SELECT COUNT(*) AS count FROM detail_list
        `;

        let listQuery = `
            WITH detail_list AS (${baseQuery})
            SELECT * FROM detail_list
        `;

        const finalQueryParams = [...queryParams];
        if (search && search.trim() !== '') {
            const searchFilter = `
                WHERE (
                    barcode ILIKE $${searchParamIdx} 
                    OR unit_serial_number ILIKE $${searchParamIdx} 
                    OR wo_number ILIKE $${searchParamIdx} 
                    OR batch_number ILIKE $${searchParamIdx} 
                    OR customer_name ILIKE $${searchParamIdx} 
                    OR model ILIKE $${searchParamIdx}
                    OR current_stage ILIKE $${searchParamIdx}
                    OR status ILIKE $${searchParamIdx}
                )
            `;
            countQuery += searchFilter;
            listQuery += searchFilter;
            finalQueryParams.push(`%${search.trim()}%`);
        }

        const pageIdx = finalQueryParams.length + 1;
        const limitIdx = finalQueryParams.length + 2;
        listQuery += ` ORDER BY scan_date_time DESC NULLS LAST LIMIT $${limitIdx} OFFSET $${pageIdx}`;

        const offset = (page - 1) * limit;
        const countRes = await pool.query(countQuery, finalQueryParams);
        const listRes = await pool.query(listQuery, [...finalQueryParams, offset, limit]);

        let totalRecords = parseInt(countRes.rows[0].count);
        if (prevStageId === null && columnType === 'pending') {
            const woRes = await pool.query(`
                SELECT w.quantity, 
                       (SELECT COUNT(DISTINCT s.barcode) FROM scans s WHERE s.batch_id = $1 AND s.stage_id = $2) as scanned
                FROM batches b
                JOIN work_orders w ON b.work_order_id = w.id
                WHERE b.id = $1
            `, [batchId, stageId]);
            if (woRes.rows.length > 0) {
                const qty = woRes.rows[0].quantity;
                const scanned = parseInt(woRes.rows[0].scanned || 0);
                totalRecords = Math.max(0, qty - scanned);
            }
        }

        return res.status(200).json({
            data: listRes.rows,
            total: totalRecords,
            page,
            limit,
            totalPages: Math.ceil(totalRecords / limit)
        });
    } catch (err: any) {
        console.error('❌ Error in getBatchUnitDetails:', err);
        return res.status(500).json({ error: 'Failed to retrieve batch unit details: ' + err.message });
    }
};
