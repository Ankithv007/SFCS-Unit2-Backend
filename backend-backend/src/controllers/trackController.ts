import { Request, Response } from 'express';
import pool, { smtPool } from '../config/db';
import { syncSmtWorkOrders, syncSingleWorkOrder } from '../services/workOrderSyncService';
import { ValidationService } from '../services/validation/ValidationService';
import { WorkflowEngineService } from '../services/workflow/WorkflowEngineService';

const isTopBottomWo = (sides: string | null | undefined): boolean => {
    if (!sides) return false;
    const s = sides.toLowerCase().trim();
    return s.includes('+') || s.includes('/') || s.includes('both') || (s.includes('top') && s.includes('bottom'));
};

const isBottomOnlyWo = (sides: string | null | undefined): boolean => {
    if (!sides) return false;
    if (isTopBottomWo(sides)) return false;
    const s = sides.toLowerCase().trim();
    return s.includes('bottom') || s.includes('btm');
};

const normalizeStageId = (str: string) => (str || '').toUpperCase().replace(/[\s\-_]/g, '');

const normalizeSmtStepName = (stepName: string | null | undefined): string => {
    if (!stepName) return '';
    const s = stepName.toString().trim().toUpperCase().replace(/[\s\-_]/g, '');
    if (s === 'PRINTING') return 'Printing';
    if (s === 'SPI') return 'SPI';
    if (s === 'PREAOI') return 'Pre AOI';
    if (s === 'POSTAOI') return 'Post AOI';
    if (s === 'REWORK') return 'Rework';
    if (s === 'SMTFG' || s === 'FG') return 'SMT FG';
    return stepName.trim();
};

const normalizeSmtStatus = (status: string | null | undefined): string => {
    if (!status) return 'PENDING';
    const s = status.toString().trim().toUpperCase();
    if (s === 'ACCEPTED' || s === 'PASS' || s === 'PASSED' || s === 'OK' || s === 'GOOD') return 'PASS';
    if (s === 'REWORK') return 'REWORK';
    if (s === 'FAIL' || s === 'FAILED' || s === 'DEBUG' || s === 'NG' || s === 'REJECT') return 'FAIL';
    if (s === 'N/A' || s === 'NA' || s === 'SKIPPED') return 'N/A';
    return s;
};

const SMT_STAGE_LIST = ['Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];

export const computeOverallStageStatus = (
    topStatus: string | null | undefined,
    bottomStatus: string | null | undefined
): string => {
    const top = normalizeSmtStatus(topStatus || 'N/A');
    const bottom = normalizeSmtStatus(bottomStatus || 'N/A');

    const topIsNA = top === 'N/A' || top === '-';
    const bottomIsNA = bottom === 'N/A' || bottom === '-';

    // If both sides are N/A, show overall N/A.
    if (topIsNA && bottomIsNA) {
        return 'N/A';
    }

    // If only one side is applicable and its status is PASS, show overall PASS.
    // If an applicable side is FAIL, show overall FAIL.
    // If an applicable side is PENDING and no failure exists, show overall PENDING.
    if (!topIsNA && bottomIsNA) {
        if (top === 'FAIL' || top === 'REWORK') return 'FAIL';
        if (top === 'PASS') return 'PASS';
        return 'PENDING';
    }

    if (topIsNA && !bottomIsNA) {
        if (bottom === 'FAIL' || bottom === 'REWORK') return 'FAIL';
        if (bottom === 'PASS') return 'PASS';
        return 'PENDING';
    }

    // Both sides are applicable:
    // If an applicable side is FAIL, show overall FAIL.
    if (top === 'FAIL' || top === 'REWORK' || bottom === 'FAIL' || bottom === 'REWORK') {
        return 'FAIL';
    }

    // If TOP = PASS and BOTTOM = PASS, show overall PASS.
    if (top === 'PASS' && bottom === 'PASS') {
        return 'PASS';
    }

    // If an applicable side is PENDING and no failure exists, show overall PENDING.
    return 'PENDING';
};

export const isBackendStageInRoute = (
    st: { code: string; name?: string; label?: string },
    activeRoute: any[],
    selectedStages: any,
    hasBackend?: boolean
): boolean => {
    if (hasBackend === false) return false;
    const cNorm = normalizeStageId(st.code);
    const nNorm = normalizeStageId(st.name || '');
    const lNorm = normalizeStageId(st.label || '');

    if (Array.isArray(activeRoute) && activeRoute.length > 0) {
        return activeRoute.some((r: any) => {
            const rCode = normalizeStageId(r.stage_code);
            const rName = normalizeStageId(r.stage_name);
            return rCode === cNorm || rName === nNorm || rCode === lNorm || rName === lNorm ||
                (cNorm === 'PTH' && (rCode === 'PRESOLDERING' || rName === 'PRESOLDERING')) ||
                (cNorm === 'QA' && (rCode === 'QUALITYASSURANCE' || rName === 'QUALITYASSURANCE')) ||
                (cNorm === 'VI' && (rCode === 'VISUALINSPECTION' || rName === 'VISUALINSPECTION')) ||
                (cNorm === 'QI' && (rCode === 'QUALITYINSPECTION' || rName === 'QUALITYINSPECTION')) ||
                (cNorm === 'PCBA_FCT' && (rCode === 'PCBAFCT' || rName === 'PCBAFCT')) ||
                (cNorm === 'UNIT_TESTING' && (rCode === 'UNITTESTING' || rName === 'UNITTESTING'));
        });
    }

    if (selectedStages !== undefined && selectedStages !== null) {
        let list: any[] = [];
        if (Array.isArray(selectedStages)) list = selectedStages;
        else if (typeof selectedStages === 'string') {
            try { list = JSON.parse(selectedStages); } catch { list = []; }
        }
        if (list.length > 0) {
            return list.some((item: any) => {
                const itemStr = typeof item === 'string' ? item : (item?.stage_code || item?.stage_name || item?.stage_label || item?.code || item?.name || '');
                const itemNorm = normalizeStageId(itemStr);
                return itemNorm === cNorm || itemNorm === nNorm || itemNorm === lNorm ||
                    (cNorm === 'PTH' && itemNorm === 'PRESOLDERING') ||
                    (cNorm === 'QA' && itemNorm === 'QUALITYASSURANCE') ||
                    (cNorm === 'VI' && itemNorm === 'VISUALINSPECTION') ||
                    (cNorm === 'QI' && itemNorm === 'QUALITYINSPECTION') ||
                    (cNorm === 'PCBA_FCT' && itemNorm === 'PCBAFCT') ||
                    (cNorm === 'UNIT_TESTING' && itemNorm === 'UNITTESTING');
            });
        }
        return false;
    }

    return true;
};

const resolveSerialSmtStatuses = (
    sides: string | null | undefined,
    rawTopStatuses: Record<string, string> | null | undefined,
    rawBottomStatuses: Record<string, string> | null | undefined,
    rawOverallStatuses: Record<string, string> | null | undefined
) => {
    const isDoubleSided = isTopBottomWo(sides);
    const isBottomOnly = isBottomOnlyWo(sides);
    const isTopOnly = !isDoubleSided && !isBottomOnly;

    const topMap: Record<string, string> = {};
    if (rawTopStatuses) {
        for (const [k, v] of Object.entries(rawTopStatuses)) {
            if (v) {
                const normKey = normalizeSmtStepName(k);
                topMap[normKey] = normalizeSmtStatus(v);
            }
        }
    }

    const botMap: Record<string, string> = {};
    if (rawBottomStatuses) {
        for (const [k, v] of Object.entries(rawBottomStatuses)) {
            if (v) {
                const normKey = normalizeSmtStepName(k);
                botMap[normKey] = normalizeSmtStatus(v);
            }
        }
    }

    const overallMap: Record<string, string> = {};
    if (rawOverallStatuses) {
        for (const [k, v] of Object.entries(rawOverallStatuses)) {
            if (v) {
                const normKey = normalizeSmtStepName(k);
                overallMap[normKey] = normalizeSmtStatus(v);
            }
        }
    }

    const hasTopFail = Object.values(topMap).some(v => v === 'FAIL' || v === 'REWORK');
    const hasBotFail = Object.values(botMap).some(v => v === 'FAIL' || v === 'REWORK');
    const hasOverallFail = Object.values(overallMap).some(v => v === 'FAIL' || v === 'REWORK');

    const step_status: Record<string, string> = {};
    const step_status_top: Record<string, string> = {};
    const step_status_bottom: Record<string, string> = {};

    for (const step of SMT_STAGE_LIST) {
        const isRework = step === 'Rework';
        const isSmtFg = step === 'SMT FG';

        if (isSmtFg) {
            // SMT-FG supports TOP only. Never use BOTTOM record or generate combined TOP/BOTTOM text.
            let topVal = topMap['SMT FG'] || (overallMap['SMT FG'] && !botMap['SMT FG'] ? overallMap['SMT FG'] : null);
            if (!topVal) {
                topVal = isBottomOnly ? 'N/A' : 'PENDING';
            }
            step_status_top['SMT FG'] = topVal;
            step_status_bottom['SMT FG'] = 'N/A';
            step_status['SMT FG'] = computeOverallStageStatus(topVal, 'N/A');
            continue;
        }

        if (isTopOnly) {
            let val = topMap[step] || overallMap[step];
            if (!val) {
                val = isRework ? ((hasTopFail || hasOverallFail) ? 'PENDING' : 'N/A') : 'PENDING';
            }
            step_status_top[step] = val;
            step_status_bottom[step] = 'N/A';
            step_status[step] = computeOverallStageStatus(val, 'N/A');
        } else if (isBottomOnly) {
            let val = botMap[step] || overallMap[step];
            if (!val) {
                val = isRework ? ((hasBotFail || hasOverallFail) ? 'PENDING' : 'N/A') : 'PENDING';
            }
            step_status_top[step] = 'N/A';
            step_status_bottom[step] = val;
            step_status[step] = computeOverallStageStatus('N/A', val);
        } else {
            // DOUBLE SIDED
            let topVal = topMap[step] || (overallMap[step] && !botMap[step] ? overallMap[step] : null);
            if (!topVal) {
                topVal = isRework ? (hasTopFail ? 'PENDING' : 'N/A') : 'PENDING';
            }

            let botVal = botMap[step] || (overallMap[step] && !topMap[step] ? overallMap[step] : null);
            if (!botVal) {
                botVal = isRework ? (hasBotFail ? 'PENDING' : 'N/A') : 'PENDING';
            }

            step_status_top[step] = topVal;
            step_status_bottom[step] = botVal;
            step_status[step] = computeOverallStageStatus(topVal, botVal);
        }
    }

    return {
        step_status,
        step_status_top,
        step_status_bottom,
        is_double_sided: isDoubleSided,
        is_bottom_only: isBottomOnly
    };
};

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
                wo.selected_stages,
                wo.has_smt,
                wo.has_backend,
                wo.sides,
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
                    let activeRoute: any[] = [];
                    try {
                        activeRoute = await WorkflowEngineService.resolveActiveRoute({ stagesList: smtSn.selected_stages });
                    } catch (routeErr: any) {
                        console.warn('Failed to resolve active route for smt serial:', routeErr);
                        activeRoute = [];
                    }
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
                        selected_stages: smtSn.selected_stages,
                        active_route: activeRoute.map((s: any) => ({
                            id: s.id,
                            stage_code: s.stage_code,
                            stage_name: s.stage_name,
                            stage_order: s.stage_order
                        })),
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
                ps.stage_code,
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
                stage_code: row.stage_code || null,
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
        let activeRoute: any[] = [];
        try {
            activeRoute = await WorkflowEngineService.resolveActiveRoute({
                workOrderId: tracking.work_order_id,
                batchId: tracking.batch_id,
                woNumber: tracking.wo_number,
                selectedStages: tracking.selected_stages
            });
        } catch (routeErr: any) {
            console.warn(`Failed to resolve active route for WO [${tracking.wo_number}]:`, routeErr.message);
            activeRoute = [];
        }

        const lastStage = activeRoute.length > 0
            ? activeRoute[activeRoute.length - 1]
            : await WorkflowEngineService.getLastStage({
                workOrderId: tracking.work_order_id,
                batchId: tracking.batch_id
            });
        const isFinalStage = lastStage
            ? (tracking.current_stage === lastStage.stage_name || tracking.current_stage === lastStage.stage_code)
            : tracking.current_stage === 'Packing';

        if ((status === 'ACCEPTED' || status === 'COMPLETED') && isFinalStage) {
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

        // Candidate barcodes for flexible matching across SMT + Backend
        const candidateSerials = new Set<string>();
        if (inputValue) candidateSerials.add(inputValue.trim().toUpperCase());
        if (barcode) candidateSerials.add(barcode.trim().toUpperCase());
        if (unitSerialNumber) candidateSerials.add(unitSerialNumber.trim().toUpperCase());

        try {
            const mapRes = await pool.query(
                `SELECT barcode, unit_serial_number FROM unit_serial_mapping 
                 WHERE UPPER(TRIM(barcode)) = $1 OR UPPER(TRIM(unit_serial_number)) = $1`,
                [barcode]
            );
            mapRes.rows.forEach((r: any) => {
                if (r.barcode) candidateSerials.add(r.barcode.trim().toUpperCase());
                if (r.unit_serial_number) candidateSerials.add(r.unit_serial_number.trim().toUpperCase());
            });
        } catch (mErr: any) {
            console.warn('Unit serial mapping lookup warning for trackBarcode:', mErr.message);
        }

        const candidatesArray = Array.from(candidateSerials);

        let smtSerialIds: number[] = [];
        try {
            const sIdRes = await smtPool.query(
                `SELECT id FROM smt_serial_numbers WHERE UPPER(TRIM(serial_number)) = ANY($1::text[])`,
                [candidatesArray]
            );
            smtSerialIds = sIdRes.rows.map((r: any) => r.id);
        } catch (e: any) {
            console.warn('Failed to query smt_serial_numbers IDs in trackBarcode:', e.message);
        }

        let woSides: string | null = tracking.sides || null;
        if (tracking.wo_number) {
            try {
                const smtWoRes = await smtPool.query(`
                    SELECT sides FROM smt_work_orders 
                    WHERE UPPER(TRIM(id)) = UPPER(TRIM($1)) OR UPPER(TRIM(po_id)) = UPPER(TRIM($1)) 
                    LIMIT 1
                `, [tracking.wo_number]);
                if (smtWoRes.rows.length > 0 && smtWoRes.rows[0].sides) {
                    woSides = smtWoRes.rows[0].sides;
                }
            } catch (wErr: any) {
                console.warn('Failed to fetch SMT WO sides in trackBarcode:', wErr.message);
            }
        }

        // Fetch SMT inspection history with session side mapping
        let smtScans: any[] = [];
        try {
            const smtRes = await smtPool.query(
                `SELECT 
                    i.id,
                    i.process_step,
                    i.scanned_by,
                    i.scanned_at,
                    i.status,
                    i.rework_reason,
                    UPPER(TRIM(COALESCE(ps.side, spis.side, pas.side, poas.side, rs.side, fgs.side))) AS raw_side
                FROM smt_inspections i
                LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
                LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
                LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
                LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
                LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
                LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
                WHERE (i.serial_id IS NOT NULL AND i.serial_id = ANY($1::int[]))
                   OR UPPER(TRIM(sn.serial_number)) = ANY($2::text[])
                   OR UPPER(TRIM(i.scanned_barcode)) = ANY($2::text[])
                   OR (UPPER(TRIM(i.work_order_id)) = UPPER(TRIM($3)) AND UPPER(TRIM(i.scanned_barcode)) = ANY($2::text[]))
                   OR (UPPER(TRIM(sn.work_order_id)) = UPPER(TRIM($3)) AND UPPER(TRIM(sn.serial_number)) = ANY($2::text[]))
                ORDER BY i.scanned_at ASC, i.id ASC`,
                [smtSerialIds.length > 0 ? smtSerialIds : [-1], candidatesArray, tracking.wo_number || '']
            );
            smtScans = smtRes.rows;
        } catch (sErr: any) {
            console.warn('Failed to fetch SMT scan history in backend trackController:', sErr.message);
        }

        const rawTopStatuses: Record<string, string> = {};
        const rawBottomStatuses: Record<string, string> = {};
        const rawOverallStatuses: Record<string, string> = {};

        smtScans.forEach((row: any) => {
            const normStep = normalizeSmtStepName(row.process_step);
            if (!normStep) return;
            const status = normalizeSmtStatus(row.status);
            rawOverallStatuses[normStep] = status;

            const sideUpper = (row.raw_side || '').toString().trim().toUpperCase();
            if (sideUpper === 'TOP' || sideUpper === 'T' || sideUpper === 'PRIMARY' || sideUpper === '1') {
                rawTopStatuses[normStep] = status;
            } else if (sideUpper === 'BOTTOM' || sideUpper === 'BTM' || sideUpper === 'B' || sideUpper === 'SECONDARY' || sideUpper === '2') {
                rawBottomStatuses[normStep] = status;
            } else {
                if (isBottomOnlyWo(woSides)) {
                    rawBottomStatuses[normStep] = status;
                } else if (!isTopBottomWo(woSides)) {
                    rawTopStatuses[normStep] = status;
                } else {
                    if (!rawTopStatuses[normStep]) {
                        rawTopStatuses[normStep] = status;
                    } else {
                        rawBottomStatuses[normStep] = status;
                    }
                }
            }
        });

        const smtResolved = resolveSerialSmtStatuses(
            woSides,
            rawTopStatuses,
            rawBottomStatuses,
            rawOverallStatuses
        );

        const smtScanHistory = smtScans.map((r: any) => ({
            id: r.id,
            process_step: normalizeSmtStepName(r.process_step) || r.process_step,
            status: normalizeSmtStatus(r.status),
            scanned_by: r.scanned_by || '-',
            scanned_at: r.scanned_at,
            rework_reason: r.rework_reason || null,
            side: r.raw_side || '-'
        }));

        let resolvedCurrentStage = tracking.current_stage || 'Unknown';
        if (!tracking.current_stage || tracking.current_stage === 'Unknown' || tracking.current_stage === 'Pre-Soldering') {
            if (history.length > 0) {
                resolvedCurrentStage = history[history.length - 1].station;
            } else if (smtScanHistory.length > 0) {
                resolvedCurrentStage = normalizeSmtStepName(smtScanHistory[smtScanHistory.length - 1].process_step);
            }
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
            current_stage: resolvedCurrentStage,
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
            smt_scan_history: smtScanHistory,
            sides: woSides || '-',
            is_double_sided: smtResolved.is_double_sided,
            is_bottom_only: smtResolved.is_bottom_only,
            smt_statuses: smtResolved.step_status,
            smt_top: smtResolved.step_status_top,
            smt_bottom: smtResolved.step_status_bottom,
            step_status_top: smtResolved.step_status_top,
            step_status_bottom: smtResolved.step_status_bottom,
            step_status: smtResolved.step_status,
            selected_stages: tracking.selected_stages,
            has_smt: tracking.has_smt ?? true,
            has_backend: tracking.has_backend ?? true,
            active_route: activeRoute.map((s: any) => ({
                id: s.id,
                stage_code: s.stage_code,
                stage_name: s.stage_name,
                stage_order: s.stage_order
            })),
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

        let activeRoute: any[] = [];
        try {
            activeRoute = await WorkflowEngineService.resolveActiveRoute({ workOrderId: wo.id });
        } catch (routeErr: any) {
            console.warn(`Failed to resolve active route for WO [${wo.wo_number}]:`, routeErr.message);
            activeRoute = [];
        }
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

        // 4. Fetch SMT WO sides & step statuses for all serials in this WO
        const smtDataBySerial: {
            [barcode: string]: {
                top: { [step: string]: string };
                bottom: { [step: string]: string };
                overall: { [step: string]: string };
            }
        } = {};
        let woSides: string | null = null;

        try {
            const smtWoRes = await smtPool.query(`
                SELECT sides FROM smt_work_orders 
                WHERE UPPER(TRIM(id)) = UPPER(TRIM($1)) OR UPPER(TRIM(po_id)) = UPPER(TRIM($1)) 
                LIMIT 1
            `, [wo.wo_number]);
            if (smtWoRes.rows.length > 0) {
                woSides = smtWoRes.rows[0].sides;
            }

            const barcodes = serials.map((s: any) => s.barcode).filter(Boolean);
            const unitSerials = serials.map((s: any) => s.unit_serial_number).filter(Boolean);
            const allSerialsList = Array.from(new Set([...barcodes, ...unitSerials])).map((b: string) => b.trim().toUpperCase());

            if (allSerialsList.length > 0) {
                const smtInspRes = await smtPool.query(`
                    SELECT 
                        UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode))) as barcode,
                        i.process_step,
                        i.status,
                        i.scanned_at,
                        UPPER(TRIM(COALESCE(ps.side, spis.side, pas.side, poas.side, rs.side, fgs.side))) AS side
                    FROM smt_inspections i
                    LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                    LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
                    LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
                    LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
                    LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
                    LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
                    LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
                    WHERE UPPER(TRIM(sn.serial_number)) = ANY($1::text[])
                       OR UPPER(TRIM(i.scanned_barcode)) = ANY($1::text[])
                       OR UPPER(TRIM(i.work_order_id)) = UPPER(TRIM($2))
                       OR UPPER(TRIM(sn.work_order_id)) = UPPER(TRIM($2))
                    ORDER BY i.scanned_at ASC, i.id ASC
                `, [allSerialsList, wo.wo_number]);

                const barcodeAliasMap: { [alias: string]: string } = {};
                serials.forEach((s: any) => {
                    if (s.barcode) barcodeAliasMap[s.barcode.trim().toUpperCase()] = s.barcode;
                    if (s.unit_serial_number) barcodeAliasMap[s.unit_serial_number.trim().toUpperCase()] = s.barcode;
                });

                smtInspRes.rows.forEach((row: any) => {
                    const matchedBarcode = barcodeAliasMap[row.barcode] || row.barcode;
                    if (!matchedBarcode) return;
                    if (!smtDataBySerial[matchedBarcode]) {
                        smtDataBySerial[matchedBarcode] = { top: {}, bottom: {}, overall: {} };
                    }
                    const normStepName = normalizeSmtStepName(row.process_step);
                    if (!normStepName) return;

                    const status = (row.status || '').toUpperCase();
                    smtDataBySerial[matchedBarcode].overall[normStepName] = status;

                    const sideUpper = (row.side || '').toString().trim().toUpperCase();
                    if (sideUpper === 'TOP' || sideUpper === 'T') {
                        smtDataBySerial[matchedBarcode].top[normStepName] = status;
                    } else if (sideUpper === 'BOTTOM' || sideUpper === 'BTM' || sideUpper === 'B') {
                        smtDataBySerial[matchedBarcode].bottom[normStepName] = status;
                    } else {
                        if (isBottomOnlyWo(woSides)) {
                            smtDataBySerial[matchedBarcode].bottom[normStepName] = status;
                        } else if (!isTopBottomWo(woSides)) {
                            smtDataBySerial[matchedBarcode].top[normStepName] = status;
                        }
                    }
                });
            }
        } catch (smtErr: any) {
            console.warn('Failed to fetch SMT step statuses for WO report:', smtErr.message);
        }

        const mappedSerials = serials.map((s: any) => {
            const history = historyBySerial[s.barcode] || [];
            const rawSmt = smtDataBySerial[s.barcode] || { top: {}, bottom: {}, overall: {} };
            const smtRes = resolveSerialSmtStatuses(woSides, rawSmt.top, rawSmt.bottom, rawSmt.overall);
            
            let currentStage = s.current_stage || 'Unknown';
            let currentStatus = s.current_status || 'PENDING';
            
            const totalFailures = history.filter((h: any) => h.status === 'REWORK' || h.status === 'DEBUG' || h.status === 'FAILED').length;
            const totalReworks = history.filter((h: any) => h.station === 'Rework').length;
            const totalDebugs = history.filter((h: any) => h.station === 'Debug').length;
            const totalPassed = history.filter((h: any) => h.status === 'ACCEPTED' || h.status === 'PASS').length;

            const normalizeStageId = (str: string) => (str || '').toUpperCase().replace(/[\s\-_]/g, '');

            const BACKEND_STAGES = [
                { code: 'PTH', name: 'Pre-Soldering', label: 'PTH' },
                { code: 'VI', name: 'Visual Inspection', label: 'VI' },
                { code: 'QA', name: 'Quality Assurance', label: 'QA' },
                { code: 'FLASHING', name: 'Flashing', label: 'Flashing' },
                { code: 'PCBA_FCT', name: 'PCBA FCT', label: 'PCBA-FCT' },
                { code: 'ASSEMBLY', name: 'Assembly', label: 'Assembly' },
                { code: 'UNIT_TESTING', name: 'Unit Testing', label: 'Unit Testing' },
                { code: 'QI', name: 'Quality Inspection', label: 'QI' },
                { code: 'PACKING', name: 'Packing', label: 'Packing' }
            ];

            const step_status: { [key: string]: string } = {};
            let selectedCount = 0;
            let passedSelectedCount = 0;

            BACKEND_STAGES.forEach(st => {
                const cNorm = normalizeStageId(st.code);
                const nNorm = normalizeStageId(st.name);
                const lNorm = normalizeStageId(st.label);

                const isSelected = isBackendStageInRoute(st, activeRoute, wo.selected_stages, wo.has_backend);

                if (!isSelected) {
                    step_status[st.code] = 'N/A';
                    step_status[st.name] = 'N/A';
                    step_status[st.label] = 'N/A';
                } else {
                    selectedCount++;
                    const matching = history.filter((h: any) => {
                        const hStation = normalizeStageId(h.station);
                        return hStation === cNorm || hStation === nNorm || hStation === lNorm ||
                            (cNorm === 'PTH' && hStation === 'PRESOLDERING') ||
                            (cNorm === 'QA' && hStation === 'QUALITYASSURANCE') ||
                            (cNorm === 'VI' && hStation === 'VISUALINSPECTION') ||
                            (cNorm === 'QI' && hStation === 'QUALITYINSPECTION') ||
                            (cNorm === 'PCBA_FCT' && hStation === 'PCBAFCT') ||
                            (cNorm === 'UNIT_TESTING' && hStation === 'UNITTESTING');
                    });

                    let statusVal = 'PENDING';
                    if (matching.length > 0) {
                        const last = matching[matching.length - 1];
                        const rawSt = (last.status || '').toUpperCase();
                        if (rawSt === 'ACCEPTED' || rawSt === 'PASS') {
                            statusVal = 'PASS';
                            passedSelectedCount++;
                        } else if (rawSt === 'REWORK' || rawSt === 'DEBUG') {
                            statusVal = 'REWORK';
                        } else if (rawSt === 'FAIL' || rawSt === 'FAILED') {
                            statusVal = 'FAIL';
                        } else {
                            statusVal = rawSt;
                        }
                    } else {
                        statusVal = 'PENDING';
                    }

                    step_status[st.code] = statusVal;
                    step_status[st.name] = statusVal;
                    step_status[st.label] = statusVal;
                }
            });

            let finalStatusLabel = 'Pending';
            if (selectedCount > 0 && passedSelectedCount === selectedCount) {
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
                smt_step_status: smtRes.step_status,
                smt_step_status_top: smtRes.step_status_top,
                smt_step_status_bottom: smtRes.step_status_bottom,
                created_at: s.created_at
            };
        });

        return res.status(200).json({
            work_order_id: wo.wo_number,
            customer_name: wo.customer_name || '-',
            model: wo.model || '-',
            product_name: ((wo.customer_name || '') + ' ' + (wo.model || '')).trim() || '-',
            quantity: wo.quantity,
            line_id: wo.line_id || '-',
            total_serials: serials.length,
            has_smt: wo.has_smt ?? false,
            has_backend: wo.has_backend ?? true,
            sides: woSides,
            is_double_sided: isTopBottomWo(woSides),
            selected_stages: wo.selected_stages,
            active_route: activeRoute.map((s: any) => ({
                id: s.id,
                stage_code: s.stage_code,
                stage_name: s.stage_name,
                stage_order: s.stage_order
            })),
            serials: mappedSerials
        });

    } catch (err: any) {
        console.error('❌ Error in trackWorkOrder:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};

export const downloadWorkOrderExcel = async (req: Request, res: Response) => {
    const { woId } = req.params;

    if (!woId || woId.trim() === '') {
        return res.status(400).json({ error: 'Work Order ID is required.' });
    }

    const inputValue = woId.trim().toUpperCase();

    try {
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

        // Fetch SMT WO sides & step statuses for all serials in this WO
        const smtDataBySerial: {
            [barcode: string]: {
                top: { [step: string]: string };
                bottom: { [step: string]: string };
                overall: { [step: string]: string };
            }
        } = {};
        let woSides: string | null = null;

        try {
            const smtWoRes = await smtPool.query(`
                SELECT sides FROM smt_work_orders 
                WHERE UPPER(TRIM(id)) = UPPER(TRIM($1)) OR UPPER(TRIM(po_id)) = UPPER(TRIM($1)) 
                LIMIT 1
            `, [wo.wo_number]);
            if (smtWoRes.rows.length > 0) {
                woSides = smtWoRes.rows[0].sides;
            }

            const barcodes = serials.map((s: any) => s.barcode).filter(Boolean);
            const unitSerials = serials.map((s: any) => s.unit_serial_number).filter(Boolean);
            const allSerialsList = Array.from(new Set([...barcodes, ...unitSerials])).map((b: string) => b.trim().toUpperCase());

            if (allSerialsList.length > 0) {
                const smtInspRes = await smtPool.query(`
                    SELECT 
                        UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode))) as barcode,
                        i.process_step,
                        i.status,
                        i.scanned_at,
                        UPPER(TRIM(COALESCE(ps.side, spis.side, pas.side, poas.side, rs.side, fgs.side))) AS side
                    FROM smt_inspections i
                    LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                    LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
                    LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
                    LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
                    LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
                    LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
                    LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
                    WHERE UPPER(TRIM(sn.serial_number)) = ANY($1::text[])
                       OR UPPER(TRIM(i.scanned_barcode)) = ANY($1::text[])
                       OR UPPER(TRIM(i.work_order_id)) = UPPER(TRIM($2))
                       OR UPPER(TRIM(sn.work_order_id)) = UPPER(TRIM($2))
                    ORDER BY i.scanned_at ASC, i.id ASC
                `, [allSerialsList, wo.wo_number]);

                const barcodeAliasMap: { [alias: string]: string } = {};
                serials.forEach((s: any) => {
                    if (s.barcode) barcodeAliasMap[s.barcode.trim().toUpperCase()] = s.barcode;
                    if (s.unit_serial_number) barcodeAliasMap[s.unit_serial_number.trim().toUpperCase()] = s.barcode;
                });

                smtInspRes.rows.forEach((row: any) => {
                    const matchedBarcode = barcodeAliasMap[row.barcode] || row.barcode;
                    if (!matchedBarcode) return;
                    if (!smtDataBySerial[matchedBarcode]) {
                        smtDataBySerial[matchedBarcode] = { top: {}, bottom: {}, overall: {} };
                    }
                    const normStepName = normalizeSmtStepName(row.process_step);
                    if (!normStepName) return;

                    const status = (row.status || '').toUpperCase();
                    smtDataBySerial[matchedBarcode].overall[normStepName] = status;

                    const sideUpper = (row.side || '').toString().trim().toUpperCase();
                    if (sideUpper === 'TOP' || sideUpper === 'T') {
                        smtDataBySerial[matchedBarcode].top[normStepName] = status;
                    } else if (sideUpper === 'BOTTOM' || sideUpper === 'BTM' || sideUpper === 'B') {
                        smtDataBySerial[matchedBarcode].bottom[normStepName] = status;
                    } else {
                        if (isBottomOnlyWo(woSides)) {
                            smtDataBySerial[matchedBarcode].bottom[normStepName] = status;
                        } else if (!isTopBottomWo(woSides)) {
                            smtDataBySerial[matchedBarcode].top[normStepName] = status;
                        }
                    }
                });
            }
        } catch (smtErr: any) {
            console.warn('Failed to fetch SMT step statuses for WO Excel export:', smtErr.message);
        }

        let activeRoute: any[] = [];
        try {
            activeRoute = await WorkflowEngineService.resolveActiveRoute({
                workOrderId: wo.id,
                woNumber: wo.wo_number,
                selectedStages: wo.selected_stages
            });
        } catch (routeErr: any) {
            console.warn(`Failed to resolve active route for WO [${wo.wo_number}]:`, routeErr.message);
            activeRoute = [];
        }

        const normalizeStageId = (str: string) => (str || '').toUpperCase().replace(/[\s\-_]/g, '');

        const SMT_STAGES = ['Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];

        const BACKEND_STAGES = [
            { code: 'PTH', name: 'Pre-Soldering', label: 'PTH' },
            { code: 'VI', name: 'Visual Inspection', label: 'VI' },
            { code: 'QA', name: 'Quality Assurance', label: 'QA' },
            { code: 'FLASHING', name: 'Flashing', label: 'Flashing' },
            { code: 'PCBA_FCT', name: 'PCBA FCT', label: 'PCBA-FCT' },
            { code: 'ASSEMBLY', name: 'Assembly', label: 'Assembly' },
            { code: 'UNIT_TESTING', name: 'Unit Testing', label: 'Unit Testing' },
            { code: 'QI', name: 'Quality Inspection', label: 'QI' },
            { code: 'PACKING', name: 'Packing', label: 'Packing' }
        ];

        const isDoubleSided = isTopBottomWo(woSides);

        const mappedSerials = serials.map((s: any) => {
            const history = historyBySerial[s.barcode] || [];
            const rawSmt = smtDataBySerial[s.barcode] || { top: {}, bottom: {}, overall: {} };
            const smtRes = resolveSerialSmtStatuses(woSides, rawSmt.top, rawSmt.bottom, rawSmt.overall);
            
            const totalFailures = history.filter((h: any) => h.status === 'REWORK' || h.status === 'DEBUG' || h.status === 'FAILED').length;
            const totalReworks = history.filter((h: any) => h.station === 'Rework').length;
            const totalDebugs = history.filter((h: any) => h.station === 'Debug').length;

            const step_status: { [key: string]: string } = {};
            let selectedCount = 0;
            let passedSelectedCount = 0;

            BACKEND_STAGES.forEach(st => {
                const cNorm = normalizeStageId(st.code);
                const nNorm = normalizeStageId(st.name);
                const lNorm = normalizeStageId(st.label);

                const isSelected = isBackendStageInRoute(st, activeRoute, wo.selected_stages, wo.has_backend);

                if (!isSelected) {
                    step_status[st.code] = 'N/A';
                } else {
                    selectedCount++;
                    const matchingScans = history.filter((h: any) => {
                        const hStation = normalizeStageId(h.station);
                        return hStation === cNorm || hStation === nNorm || hStation === lNorm ||
                            (cNorm === 'PTH' && hStation === 'PRESOLDERING') ||
                            (cNorm === 'QA' && hStation === 'QUALITYASSURANCE') ||
                            (cNorm === 'VI' && hStation === 'VISUALINSPECTION') ||
                            (cNorm === 'QI' && hStation === 'QUALITYINSPECTION') ||
                            (cNorm === 'PCBA_FCT' && hStation === 'PCBAFCT') ||
                            (cNorm === 'UNIT_TESTING' && hStation === 'UNITTESTING');
                    });

                    if (matchingScans.length > 0) {
                        const lastScan = matchingScans[matchingScans.length - 1];
                        const stStatus = (lastScan.status || '').toUpperCase();
                        if (stStatus === 'ACCEPTED' || stStatus === 'PASS') {
                            step_status[st.code] = 'PASS';
                            passedSelectedCount++;
                        } else if (stStatus === 'REWORK' || stStatus === 'DEBUG') {
                            step_status[st.code] = 'REWORK';
                        } else if (stStatus === 'FAILED' || stStatus === 'FAIL') {
                            step_status[st.code] = 'FAIL';
                        } else {
                            step_status[st.code] = stStatus;
                        }
                    } else {
                        step_status[st.code] = 'PENDING';
                    }
                }
            });

            let finalStatusLabel = 'Pending';
            if (selectedCount > 0 && passedSelectedCount === selectedCount) {
                finalStatusLabel = 'Completed';
            }

            let resolvedCurrentStage = s.current_stage || 'Pending';
            const lastBackendScan = history.length > 0 ? history[history.length - 1] : null;
            const hasSmtScans = Object.keys(rawSmt.overall).length > 0 || Object.keys(rawSmt.top).length > 0 || Object.keys(rawSmt.bottom).length > 0;
            if (lastBackendScan) {
                resolvedCurrentStage = lastBackendScan.station || resolvedCurrentStage;
            } else if (hasSmtScans) {
                const smtStepsScanned = SMT_STAGES.filter(st => rawSmt.overall[st] || rawSmt.top[st] || rawSmt.bottom[st]);
                if (smtStepsScanned.length > 0) {
                    resolvedCurrentStage = smtStepsScanned[smtStepsScanned.length - 1];
                }
            }

            return {
                serial_number: s.barcode,
                unit_serial_number: s.unit_serial_number || '-',
                current_stage: resolvedCurrentStage,
                final_status_label: finalStatusLabel,
                total_failures: totalFailures,
                total_reworks: totalReworks,
                total_debugs: totalDebugs,
                step_status: step_status,
                smt_statuses: smtRes.step_status,
                smt_top: smtRes.step_status_top,
                smt_bottom: smtRes.step_status_bottom,
                created_at: s.created_at
            };
        });

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Backend WO Report');

        const labelStyle = {
            font: { bold: true, color: { argb: 'FF595959' }, name: 'Segoe UI', size: 10 },
            alignment: { horizontal: 'left' }
        };
        const valueStyle = {
            font: { bold: true, name: 'Segoe UI', size: 10 },
            alignment: { horizontal: 'left' }
        };
        const borderStyle = {
            top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };

        const metadata = [
            { label: 'Work Order ID:', val: wo.wo_number || wo.id },
            { label: 'Customer / Model:', val: `${wo.customer_name || ''} ${wo.model || ''}`.trim() || '-' },
            { label: 'Process Type:', val: wo.has_smt && wo.has_backend ? 'SMT + Backend' : wo.has_smt ? 'SMT' : 'Backend' },
            { label: 'SMT Sides:', val: woSides || 'Single Side' },
            { label: 'Total Serials:', val: `${serials.length} / ${wo.quantity || '-'}` },
            { label: 'Report Generated:', val: new Date().toLocaleString('en-IN') }
        ];

        metadata.forEach((item, index) => {
            const rowNumber = index + 1;
            worksheet.getCell(`A${rowNumber}`).value = item.label;
            worksheet.getCell(`A${rowNumber}`).style = labelStyle;
            worksheet.getCell(`B${rowNumber}`).value = item.val;
            worksheet.getCell(`B${rowNumber}`).style = valueStyle;
        });

        worksheet.addRow([]);

        const hasSmt = wo.has_smt ?? false;

        let smtHeaders: string[] = [];
        if (hasSmt) {
            smtHeaders = SMT_STAGES.map(s => `SMT: ${s}`);
        }

        const tableHeaders = [
            'WORK ORDER',
            'SERIAL NUMBER',
            'UNIT SERIAL NUMBER',
            'OVERALL STATUS',
            ...smtHeaders,
            'PTH',
            'VI',
            'QA',
            'FLASHING',
            'PCBA-FCT',
            'ASSEMBLY',
            'UNIT TESTING',
            'QI',
            'PACKING',
            'TOTAL FAILURES',
            'TOTAL REWORKS',
            'TOTAL DEBUGS'
        ];

        const headerRow = worksheet.addRow(tableHeaders);
        headerRow.height = 26;

        const headerFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E3A8A' }
        };

        const smtHeaderFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E4DB7' }
        };

        const smtColCount = smtHeaders.length;
        const backendStartCol = 5 + smtColCount;
        const backendEndCol = backendStartCol + 8;

        headerRow.eachCell((cell: any, colNumber: number) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            if (hasSmt && colNumber >= 5 && colNumber < backendStartCol) {
                cell.fill = smtHeaderFill;
            } else {
                cell.fill = headerFill;
            }
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        mappedSerials.forEach((s: any) => {
            let smtValues: string[] = [];
            if (hasSmt) {
                smtValues = SMT_STAGES.map(st => {
                    const isSmtFg = st === 'SMT FG';
                    const isRework = st === 'Rework';
                    let top = s.smt_top?.[st] || (isRework ? 'N/A' : 'PENDING');
                    let bot = isSmtFg ? 'N/A' : (s.smt_bottom?.[st] || (isRework ? 'N/A' : 'PENDING'));

                    if (isDoubleSided) {
                        if (isRework && (top === 'N/A' || top === '-') && (bot === 'N/A' || bot === '-')) {
                            return 'N/A';
                        }
                        if (isSmtFg) {
                            return `TOP: ${top}, BOTTOM: N/A`;
                        }
                        return `TOP: ${top}, BOTTOM: ${bot}`;
                    } else if (isBottomOnlyWo(woSides)) {
                        if (isRework && (bot === 'N/A' || bot === '-')) return 'N/A';
                        return `BOTTOM: ${bot}`;
                    } else {
                        if (isRework && (top === 'N/A' || top === '-')) return 'N/A';
                        return `TOP: ${top}`;
                    }
                });
            }

            const rowData = [
                wo.wo_number || wo.id,
                s.serial_number,
                s.unit_serial_number,
                s.final_status_label === 'Completed' ? 'COMPLETED' : 'PENDING',
                ...smtValues,
                s.step_status['PTH'] || 'N/A',
                s.step_status['VI'] || 'N/A',
                s.step_status['QA'] || 'N/A',
                s.step_status['FLASHING'] || 'N/A',
                s.step_status['PCBA_FCT'] || 'N/A',
                s.step_status['ASSEMBLY'] || 'N/A',
                s.step_status['UNIT_TESTING'] || 'N/A',
                s.step_status['QI'] || 'N/A',
                s.step_status['PACKING'] || 'N/A',
                s.total_failures || 0,
                s.total_reworks || 0,
                s.total_debugs || 0
            ];

            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 20;

            const isCompleted = s.final_status_label === 'Completed';

            dataRow.eachCell((cell: any, colNumber: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;

                if (colNumber >= 1 && colNumber <= 3) {
                    cell.numFmt = '@';
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                } else {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                }

                if (colNumber === 4) {
                    if (isCompleted) {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 };
                    }
                }

                // SMT status styling
                if (hasSmt && colNumber >= 5 && colNumber < backendStartCol) {
                    const val = cell.value?.toString().toUpperCase() || '';
                    if (val === 'N/A' || val === '-') {
                        cell.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI', size: 10 };
                    } else if (val.includes('FAIL') || val.includes('REWORK')) {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (val.includes('PENDING')) {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (val.includes('PASS')) {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    }
                }

                // Backend status styling
                if (colNumber >= backendStartCol && colNumber <= backendEndCol) {
                    const val = cell.value?.toString().toUpperCase();
                    if (val === 'PASS') {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (val === 'PENDING') {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (val === 'N/A' || val === 'NA') {
                        cell.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI', size: 10 };
                    }
                }
            });
        });

        worksheet.columns.forEach((column: any) => {
            let maxLen = 0;
            column.eachCell!({ includeEmpty: true }, (cell: any) => {
                if (cell.row && (cell.row as any).number <= 7) return;
                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
            column.width = maxLen < 15 ? 15 : maxLen + 5;
        });

        worksheet.getColumn(1).width = 20;
        worksheet.getColumn(2).width = 25;
        worksheet.getColumn(3).width = 25;
        worksheet.getColumn(4).width = 18;

        worksheet.views = [{ state: 'frozen', ySplit: 8 }];

        const safeWoId = inputValue.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `Backend_WorkOrder_Report_${safeWoId}_${nowStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        console.error('❌ Error in downloadWorkOrderExcel:', err);
        return res.status(500).json({ error: 'Failed to download Work Order Excel report: ' + err.message });
    }
};

export const downloadSerialExcel = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Barcode or Serial Number is required.' });
    }

    const inputValue = id.trim().toUpperCase();

    try {
        let barcode = inputValue;
        let unitSerialNumber: string | null = null;

        const pcbCheck = await pool.query(`SELECT barcode FROM units WHERE barcode = $1`, [inputValue]);
        if (pcbCheck.rows.length > 0) {
            barcode = pcbCheck.rows[0].barcode;
            const usnRes = await pool.query(`SELECT unit_serial_number FROM unit_serial_mapping WHERE barcode = $1`, [barcode]);
            if (usnRes.rows.length > 0) {
                unitSerialNumber = usnRes.rows[0].unit_serial_number;
            }
        } else {
            const usnResult = await pool.query(
                `SELECT barcode, unit_serial_number FROM unit_serial_mapping WHERE unit_serial_number = $1`,
                [inputValue]
            );
            if (usnResult.rows.length > 0) {
                barcode = usnResult.rows[0].barcode;
                unitSerialNumber = usnResult.rows[0].unit_serial_number;
            }
        }

        const trackingResult = await pool.query(`
            SELECT 
                u.barcode, u.current_status, u.failed_at AS failure_created_at, u.last_scanned_at AS last_updated_at,
                b.id AS batch_id, b.batch_number, wo.id AS work_order_id, wo.wo_number, wo.customer_name, wo.model,
                wo.quantity, wo.selected_stages, wo.has_smt, wo.has_backend, wo.sides,
                ps.stage_name AS current_stage, fps.stage_name AS failed_stage
            FROM units u
            LEFT JOIN batches b ON u.batch_id = b.id
            LEFT JOIN work_orders wo ON b.work_order_id = wo.id
            LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
            LEFT JOIN production_stages fps ON u.failed_stage_id = fps.id
            WHERE u.barcode = $1
        `, [barcode]);

        if ((trackingResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `Unit "${inputValue}" not found in system.` });
        }

        const tracking = trackingResult.rows[0];

        const historyResult = await pool.query(`
            SELECT ps.stage_code, ps.stage_name AS station, ps.stage_order, s.scan_result AS status, s.scanned_by, s.scanned_at, s.remarks
            FROM scans s
            JOIN production_stages ps ON s.stage_id = ps.id
            WHERE s.barcode = $1
            ORDER BY s.scanned_at ASC
        `, [barcode]);

        // Candidate barcodes for flexible matching across SMT + Backend
        const candidateSerials = new Set<string>();
        if (inputValue) candidateSerials.add(inputValue.trim().toUpperCase());
        if (barcode) candidateSerials.add(barcode.trim().toUpperCase());
        if (unitSerialNumber) candidateSerials.add(unitSerialNumber.trim().toUpperCase());

        try {
            const mapRes = await pool.query(
                `SELECT barcode, unit_serial_number FROM unit_serial_mapping 
                 WHERE UPPER(TRIM(barcode)) = $1 OR UPPER(TRIM(unit_serial_number)) = $1`,
                [barcode]
            );
            mapRes.rows.forEach((r: any) => {
                if (r.barcode) candidateSerials.add(r.barcode.trim().toUpperCase());
                if (r.unit_serial_number) candidateSerials.add(r.unit_serial_number.trim().toUpperCase());
            });
        } catch (mErr: any) {
            console.warn('Unit serial mapping lookup warning for serial Excel:', mErr.message);
        }

        const candidatesArray = Array.from(candidateSerials);

        let smtSerialIds: number[] = [];
        try {
            const sIdRes = await smtPool.query(
                `SELECT id FROM smt_serial_numbers WHERE UPPER(TRIM(serial_number)) = ANY($1::text[])`,
                [candidatesArray]
            );
            smtSerialIds = sIdRes.rows.map((r: any) => r.id);
        } catch (e: any) {
            console.warn('Failed to query smt_serial_numbers IDs for serial Excel:', e.message);
        }

        let woSides: string | null = tracking.sides || null;
        if (!woSides && tracking.wo_number) {
            try {
                const smtWoRes = await smtPool.query(`
                    SELECT sides FROM smt_work_orders 
                    WHERE UPPER(TRIM(id)) = UPPER(TRIM($1)) OR UPPER(TRIM(po_id)) = UPPER(TRIM($1)) 
                    LIMIT 1
                `, [tracking.wo_number]);
                if (smtWoRes.rows.length > 0) {
                    woSides = smtWoRes.rows[0].sides;
                }
            } catch (wErr: any) {
                console.warn('Failed to fetch SMT WO sides for serial Excel:', wErr.message);
            }
        }

        let smtScans: any[] = [];
        try {
            const smtRes = await smtPool.query(`
                SELECT i.id, i.process_step, i.scanned_by, i.scanned_at, i.status, i.rework_reason,
                       UPPER(TRIM(COALESCE(ps.side, spis.side, pas.side, poas.side, rs.side, fgs.side))) AS raw_side
                FROM smt_inspections i
                LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
                LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
                LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
                LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
                LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
                LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
                WHERE (i.serial_id IS NOT NULL AND i.serial_id = ANY($1::int[]))
                   OR UPPER(TRIM(sn.serial_number)) = ANY($2::text[])
                   OR UPPER(TRIM(i.scanned_barcode)) = ANY($2::text[])
                   OR (UPPER(TRIM(i.work_order_id)) = UPPER(TRIM($3)) AND UPPER(TRIM(i.scanned_barcode)) = ANY($2::text[]))
                   OR (UPPER(TRIM(sn.work_order_id)) = UPPER(TRIM($3)) AND UPPER(TRIM(sn.serial_number)) = ANY($2::text[]))
                ORDER BY i.scanned_at ASC, i.id ASC
            `, [smtSerialIds.length > 0 ? smtSerialIds : [-1], candidatesArray, tracking.wo_number || '']);
            smtScans = smtRes.rows;
        } catch (sErr: any) {
            console.warn('Failed to fetch SMT scans for serial Excel:', sErr.message);
        }

        const resolvedSmtScans = smtScans.map((h: any) => {
            const normStep = normalizeSmtStepName(h.process_step);
            const rawSide = (h.raw_side || '').toString().trim().toUpperCase();
            let resolvedSide = '-';
            if (rawSide === 'TOP' || rawSide === 'T' || rawSide === 'PRIMARY' || rawSide === '1') {
                resolvedSide = 'TOP';
            } else if (rawSide === 'BOTTOM' || rawSide === 'BTM' || rawSide === 'B' || rawSide === 'SECONDARY' || rawSide === '2') {
                resolvedSide = 'BOTTOM';
            } else {
                if (isBottomOnlyWo(woSides)) {
                    resolvedSide = 'BOTTOM';
                } else if (!isTopBottomWo(woSides)) {
                    resolvedSide = 'TOP';
                } else {
                    resolvedSide = '-';
                }
            }
            return {
                id: h.id,
                source: 'SMT',
                station: normStep,
                side: resolvedSide,
                status: normalizeSmtStatus(h.status),
                operator: h.scanned_by || '-',
                scanned_at: h.scanned_at,
                remarks: h.rework_reason || '-'
            };
        });

        // Stage-wise status map for SMT
        const smtStageMap: {
            top: { [step: string]: string };
            bottom: { [step: string]: string };
            overall: { [step: string]: string };
        } = { top: {}, bottom: {}, overall: {} };

        resolvedSmtScans.forEach((scan: any) => {
            if (!scan.station) return;
            smtStageMap.overall[scan.station] = scan.status;
            if (scan.side === 'TOP') {
                smtStageMap.top[scan.station] = scan.status;
            } else if (scan.side === 'BOTTOM') {
                smtStageMap.bottom[scan.station] = scan.status;
            } else {
                if (!smtStageMap.top[scan.station]) {
                    smtStageMap.top[scan.station] = scan.status;
                } else {
                    smtStageMap.bottom[scan.station] = scan.status;
                }
            }
        });

        // Build combined logs first to resolve current stage accurately
        const combinedLogs = [
            ...resolvedSmtScans,
            ...historyResult.rows.map((h: any) => ({
                source: 'Backend',
                station: h.station,
                side: '-',
                status: (h.status || '').toUpperCase() === 'ACCEPTED' ? 'PASS' : (h.status || '').toUpperCase(),
                operator: h.scanned_by || '-',
                scanned_at: h.scanned_at,
                remarks: h.remarks || '-'
            }))
        ].sort((a: any, b: any) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime());

        let currentStage = tracking.current_stage || 'Unknown';
        if (!tracking.current_stage || tracking.current_stage === 'Unknown' || tracking.current_stage === 'Pre-Soldering') {
            if (combinedLogs.length > 0) {
                const lastLog = combinedLogs[combinedLogs.length - 1];
                if (lastLog && lastLog.station && lastLog.station !== '-') {
                    currentStage = lastLog.station;
                }
            }
        }

        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Serial Traceability');

        const labelStyle = { font: { bold: true, color: { argb: 'FF595959' }, name: 'Segoe UI', size: 10 } };
        const valueStyle = { font: { bold: true, name: 'Segoe UI', size: 10 } };
        const borderStyle = {
            top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
            right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };

        const metadata = [
            { label: 'PCB Barcode / Serial Number:', val: barcode },
            { label: 'Unit Serial Number:', val: unitSerialNumber || '-' },
            { label: 'Work Order Number:', val: tracking.wo_number || '-' },
            { label: 'Customer / Model:', val: `${tracking.customer_name || ''} ${tracking.model || ''}`.trim() || '-' },
            { label: 'Current Stage:', val: currentStage },
            { label: 'Current Status:', val: (tracking.current_status || 'PENDING').toUpperCase() },
            { label: 'Report Generated:', val: new Date().toLocaleString('en-IN') }
        ];

        metadata.forEach((item, index) => {
            const r = index + 1;
            worksheet.getCell(`A${r}`).value = item.label;
            worksheet.getCell(`A${r}`).style = labelStyle;
            worksheet.getCell(`B${r}`).value = item.val;
            worksheet.getCell(`B${r}`).style = valueStyle;
        });

        worksheet.addRow([]); // Blank spacer

        // ── Section 1: SMT Stage Traceability Summary (TOP / BOTTOM Breakout) ──
        const smtSummaryHeaders = ['SMT STAGE', 'TOP SIDE STATUS', 'BOTTOM SIDE STATUS', 'OVERALL STATUS'];
        const smtHeaderRow = worksheet.addRow(smtSummaryHeaders);
        smtHeaderRow.height = 22;
        const smtHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
        smtHeaderRow.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = smtHeaderFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        const smtResolved = resolveSerialSmtStatuses(
            woSides,
            smtStageMap.top,
            smtStageMap.bottom,
            smtStageMap.overall
        );

        const smtStagesList = ['Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];
        smtStagesList.forEach((stage: string) => {
            const isSmtFg = stage === 'SMT FG';
            let topStatus = smtResolved.step_status_top[stage] || (stage === 'Rework' ? 'N/A' : 'PENDING');
            let bottomStatus = isSmtFg ? 'N/A' : (smtResolved.step_status_bottom[stage] || (stage === 'Rework' ? 'N/A' : 'PENDING'));
            if (tracking.has_smt === false) {
                topStatus = 'N/A';
                bottomStatus = 'N/A';
            }
            const overallStatus = computeOverallStageStatus(topStatus, bottomStatus);

            const rowData = [stage, topStatus, bottomStatus, overallStatus];
            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 18;

            dataRow.eachCell((cell: any, colIdx: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;
                cell.alignment = { horizontal: colIdx === 1 ? 'left' : 'center', vertical: 'middle' };
                if (colIdx > 1) {
                    const st = cell.value ? cell.value.toString().toUpperCase() : '';
                    if (st === 'PASS' || st.includes('PASS')) {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (st === 'FAIL' || st === 'REWORK' || st.includes('FAIL')) {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (st === 'PENDING' || st.includes('PENDING')) {
                        cell.font = { color: { argb: 'FFD97706' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (st === 'N/A') {
                        cell.font = { color: { argb: 'FF808080' }, name: 'Segoe UI', size: 10 };
                    }
                }
            });
        });

        worksheet.addRow([]); // Blank spacer

        // ── Section 2: Backend Stage Traceability Summary ──
        const bSummaryHeaders = ['BACKEND STAGE', 'STATUS'];
        const bHeaderRow = worksheet.addRow(bSummaryHeaders);
        bHeaderRow.height = 22;
        const bHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        bHeaderRow.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = bHeaderFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        let activeRoute: any[] = [];
        if (tracking.work_order_id) {
            try {
                activeRoute = await WorkflowEngineService.resolveActiveRoute({
                    workOrderId: tracking.work_order_id,
                    batchId: tracking.batch_id,
                    woNumber: tracking.wo_number,
                    selectedStages: tracking.selected_stages
                });
            } catch (err: any) {
                console.warn('Failed to resolve active route for serial excel:', err.message);
            }
        }

        const BACKEND_STAGES_LIST = [
            { code: 'PTH', name: 'Pre-Soldering', label: 'PTH' },
            { code: 'VI', name: 'Visual Inspection', label: 'VI' },
            { code: 'QA', name: 'Quality Assurance', label: 'QA' },
            { code: 'FLASHING', name: 'Flashing', label: 'Flashing' },
            { code: 'PCBA_FCT', name: 'PCBA FCT', label: 'PCBA-FCT' },
            { code: 'ASSEMBLY', name: 'Assembly', label: 'Assembly' },
            { code: 'UNIT_TESTING', name: 'Unit Testing', label: 'Unit Testing' },
            { code: 'QI', name: 'Quality Inspection', label: 'QI' },
            { code: 'PACKING', name: 'Packing', label: 'Packing' }
        ];

        BACKEND_STAGES_LIST.forEach(st => {
            const isSelected = isBackendStageInRoute(st, activeRoute, tracking.selected_stages, tracking.has_backend);

            let bStatus = 'PENDING';
            if (!isSelected) {
                bStatus = 'N/A';
            } else {
                const cNorm = normalizeStageId(st.code);
                const nNorm = normalizeStageId(st.name);
                const lNorm = normalizeStageId(st.label);
                const matching = historyResult.rows.filter((h: any) => {
                    const hStation = normalizeStageId(h.station);
                    return hStation === cNorm || hStation === nNorm || hStation === lNorm ||
                        (cNorm === 'PTH' && hStation === 'PRESOLDERING') ||
                        (cNorm === 'QA' && hStation === 'QUALITYASSURANCE') ||
                        (cNorm === 'VI' && hStation === 'VISUALINSPECTION') ||
                        (cNorm === 'QI' && hStation === 'QUALITYINSPECTION') ||
                        (cNorm === 'PCBA_FCT' && hStation === 'PCBAFCT') ||
                        (cNorm === 'UNIT_TESTING' && hStation === 'UNITTESTING');
                });
                if (matching.length > 0) {
                    const last = matching[matching.length - 1];
                    const rawSt = (last.status || '').toUpperCase();
                    bStatus = (rawSt === 'ACCEPTED' || rawSt === 'PASS') ? 'PASS' : (rawSt === 'FAIL' || rawSt === 'FAILED') ? 'FAIL' : (rawSt === 'REWORK' || rawSt === 'DEBUG') ? 'REWORK' : rawSt;
                } else {
                    bStatus = 'PENDING';
                }
            }

            const rowData = [st.label, bStatus];
            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 18;
            dataRow.eachCell((cell: any, colIdx: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;
                cell.alignment = { horizontal: colIdx === 1 ? 'left' : 'center', vertical: 'middle' };
                if (colIdx === 2) {
                    if (bStatus === 'PASS') cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    else if (bStatus === 'FAIL' || bStatus === 'REWORK') cell.font = { color: { argb: 'FFFF0000' }, bold: true, name: 'Segoe UI', size: 10 };
                    else if (bStatus === 'PENDING') cell.font = { color: { argb: 'FFD97706' }, bold: true, name: 'Segoe UI', size: 10 };
                    else if (bStatus === 'N/A') cell.font = { color: { argb: 'FF808080' }, name: 'Segoe UI', size: 10 };
                }
            });
        });

        worksheet.addRow([]); // Blank spacer

        // ── Section 3: Chronological Audit Scan Logs ──
        const logHeaders = ['SL NO', 'SOURCE', 'STAGE / STATION', 'SIDE', 'STATUS', 'OPERATOR', 'DATE & TIME', 'REMARKS'];
        const logHeaderRow = worksheet.addRow(logHeaders);
        logHeaderRow.height = 24;

        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
        logHeaderRow.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = headerFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        combinedLogs.forEach((log: any, idx: number) => {
            const timeStr = log.scanned_at ? new Date(log.scanned_at).toLocaleString('en-IN') : '-';
            const rowData = [
                idx + 1,
                log.source,
                log.station,
                log.side,
                log.status,
                log.operator,
                timeStr,
                log.remarks
            ];
            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 20;

            dataRow.eachCell((cell: any, colIdx: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;
                if (colIdx === 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
                else if (colIdx === 5) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                    if (log.status === 'PASS' || log.status === 'ACCEPTED') {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (log.status === 'FAIL' || log.status === 'REWORK') {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 };
                    }
                } else {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                }
            });
        });

        worksheet.columns.forEach((col: any) => {
            let maxLen = 0;
            col.eachCell!({ includeEmpty: true }, (cell: any) => {
                if (cell.row && (cell.row as any).number <= 8) return;
                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
            col.width = maxLen < 15 ? 15 : maxLen + 5;
        });

        worksheet.getColumn(1).width = 12;
        worksheet.getColumn(2).width = 20;
        worksheet.getColumn(3).width = 25;
        worksheet.getColumn(4).width = 18;
        worksheet.getColumn(5).width = 15;
        worksheet.getColumn(6).width = 20;
        worksheet.getColumn(7).width = 24;
        worksheet.getColumn(8).width = 30;

        worksheet.views = [{ state: 'frozen', ySplit: 16 }];

        const safeId = barcode.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `Backend_Serial_Traceability_${safeId}_${nowStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        console.error('❌ Error in downloadSerialExcel:', err);
        return res.status(500).json({ error: 'Failed to download Serial Excel report: ' + err.message });
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
