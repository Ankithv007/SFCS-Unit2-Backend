import { Request, Response } from 'express';
import pool, { backendPool } from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('SMT_TRACK_CONTROLLER');

const normalizeStageId = (s: string) => (s || '').toUpperCase().replace(/[\s\-_]/g, '');

export const isTopBottomWo = (sides: string | null | undefined): boolean => {
    if (!sides) return false;
    const s = sides.toLowerCase().trim();
    return s.includes('+') || s.includes('/') || s.includes('both') || (s.includes('top') && s.includes('bottom'));
};

export const isBottomOnlyWo = (sides: string | null | undefined): boolean => {
    if (!sides) return false;
    const s = sides.toLowerCase().trim();
    return !isTopBottomWo(sides) && s.includes('bottom');
};

export const isTopOnlyWo = (sides: string | null | undefined): boolean => {
    return !isTopBottomWo(sides) && !isBottomOnlyWo(sides);
};

const normalizeStatus = (status: string): string => {
    switch ((status || '').toUpperCase()) {
        case 'ACCEPTED': return 'PASS';
        case 'PASS':     return 'PASS';
        case 'PASSED':   return 'PASS';
        case 'FAILED':   return 'FAIL';
        case 'FAIL':     return 'FAIL';
        case 'REWORK':   return 'REWORK';
        case 'RESOLVED': return 'RESOLVED';
        default: return (status || '').toUpperCase();
    }
};

export const computeOverallStageStatus = (
    topStatus: string | null | undefined,
    bottomStatus: string | null | undefined
): string => {
    const top = normalizeStatus(topStatus || 'N/A');
    const bottom = normalizeStatus(bottomStatus || 'N/A');

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

export interface SmtStatusResolution {
    step_status: Record<string, string>;
    step_status_top: Record<string, string>;
    step_status_bottom: Record<string, string>;
    is_completed: boolean;
    final_status_label: string;
}

export const resolveSerialSmtStatuses = (
    sides: string | null | undefined,
    rawTopStatuses: Record<string, any> | null | undefined,
    rawBottomStatuses: Record<string, any> | null | undefined,
    rawOverallStatuses: Record<string, any> | null | undefined,
    hasActiveFailure: boolean = false,
    sqlIsCompleted?: boolean,
    hasSmt: boolean = true
): SmtStatusResolution => {
    const smtStepNames = ['Serial Number', 'Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];

    if (hasSmt === false) {
        const step_status: Record<string, string> = {};
        const step_status_top: Record<string, string> = {};
        const step_status_bottom: Record<string, string> = {};
        for (const step of smtStepNames) {
            step_status_top[step] = 'N/A';
            step_status_bottom[step] = 'N/A';
            step_status[step] = 'N/A';
        }
        return {
            step_status,
            step_status_top,
            step_status_bottom,
            is_completed: false,
            final_status_label: 'Pending'
        };
    }

    const isDoubleSided = isTopBottomWo(sides);
    const isBottomOnly = isBottomOnlyWo(sides);
    const isTopOnly = !isDoubleSided && !isBottomOnly;

    const topMap: Record<string, string> = {};
    if (rawTopStatuses && typeof rawTopStatuses === 'object') {
        for (const [k, v] of Object.entries(rawTopStatuses)) {
            if (v) topMap[k] = normalizeStatus(String(v));
        }
    }

    const botMap: Record<string, string> = {};
    if (rawBottomStatuses && typeof rawBottomStatuses === 'object') {
        for (const [k, v] of Object.entries(rawBottomStatuses)) {
            if (v) botMap[k] = normalizeStatus(String(v));
        }
    }

    const overallMap: Record<string, string> = {};
    if (rawOverallStatuses && typeof rawOverallStatuses === 'object') {
        for (const [k, v] of Object.entries(rawOverallStatuses)) {
            if (v) overallMap[k] = normalizeStatus(String(v));
        }
    }

    const step_status: Record<string, string> = {};
    const step_status_top: Record<string, string> = {};
    const step_status_bottom: Record<string, string> = {};

    if (isTopOnly) {
        // TOP ONLY: Bottom is always 'N/A'
        for (const step of smtStepNames) {
            if (step === 'Serial Number') {
                step_status_top[step] = 'PASS';
                step_status_bottom[step] = 'N/A';
                step_status[step] = 'PASS';
            } else if (step === 'SMT FG') {
                const val = topMap[step] || overallMap[step] || 'PENDING';
                step_status_top[step] = val;
                step_status_bottom[step] = 'N/A';
                step_status[step] = computeOverallStageStatus(val, 'N/A');
            } else {
                const val = topMap[step] || overallMap[step] || (step === 'Rework' ? 'N/A' : 'PENDING');
                step_status_top[step] = val;
                step_status_bottom[step] = 'N/A';
                step_status[step] = computeOverallStageStatus(val, 'N/A');
            }
        }
    } else if (isBottomOnly) {
        // BOTTOM ONLY: Top is always 'N/A'
        for (const step of smtStepNames) {
            if (step === 'Serial Number') {
                step_status_top[step] = 'N/A';
                step_status_bottom[step] = 'PASS';
                step_status[step] = 'PASS';
            } else if (step === 'SMT FG') {
                step_status_top[step] = 'N/A';
                step_status_bottom[step] = 'N/A';
                step_status[step] = 'N/A';
            } else {
                const val = botMap[step] || overallMap[step] || (step === 'Rework' ? 'N/A' : 'PENDING');
                step_status_top[step] = 'N/A';
                step_status_bottom[step] = val;
                step_status[step] = computeOverallStageStatus('N/A', val);
            }
        }
    } else {
        // DOUBLE SIDED (Top / Bottom)
        for (const step of smtStepNames) {
            if (step === 'Serial Number') {
                step_status_top[step] = 'PASS';
                step_status_bottom[step] = 'PASS';
                step_status[step] = 'PASS';
            } else if (step === 'SMT FG') {
                // SMT-FG supports TOP only. Never use BOTTOM record or generate combined TOP/BOTTOM text.
                let topVal = topMap['SMT FG'] || (overallMap['SMT FG'] && !botMap['SMT FG'] ? overallMap['SMT FG'] : null);
                if (!topVal) {
                    topVal = isBottomOnly ? 'N/A' : 'PENDING';
                }
                step_status_top[step] = topVal;
                step_status_bottom[step] = 'N/A';
                step_status[step] = computeOverallStageStatus(topVal, 'N/A');
            } else {
                const topVal = topMap[step] || (overallMap[step] && !botMap[step] ? overallMap[step] : (step === 'Rework' ? 'N/A' : 'PENDING'));
                const botVal = botMap[step] || (overallMap[step] && !topMap[step] ? overallMap[step] : (step === 'Rework' ? 'N/A' : 'PENDING'));

                step_status_top[step] = topVal;
                step_status_bottom[step] = botVal;
                step_status[step] = computeOverallStageStatus(topVal, botVal);
            }
        }
    }

    // Determine completion
    let is_completed = false;
    if (sqlIsCompleted !== undefined) {
        is_completed = sqlIsCompleted;
    } else if (!hasActiveFailure) {
        if (isDoubleSided) {
            const topPostPass = step_status_top['Post AOI'] === 'PASS';
            const botPostPass = step_status_bottom['Post AOI'] === 'PASS';
            const topFgPass = step_status_top['SMT FG'] === 'PASS';
            const botFgPass = step_status_bottom['SMT FG'] === 'PASS';
            const overallFgPass = overallMap['SMT FG'] === 'PASS';

            is_completed = topFgPass || overallFgPass || (topPostPass && botPostPass);
        } else if (isBottomOnly) {
            const botPostPass = step_status_bottom['Post AOI'] === 'PASS' || overallMap['Post AOI'] === 'PASS';
            const botFgPass = step_status_bottom['SMT FG'] === 'PASS' || overallMap['SMT FG'] === 'PASS';
            is_completed = botFgPass || botPostPass;
        } else {
            const topPostPass = step_status_top['Post AOI'] === 'PASS' || overallMap['Post AOI'] === 'PASS';
            const topFgPass = step_status_top['SMT FG'] === 'PASS' || overallMap['SMT FG'] === 'PASS';
            is_completed = topFgPass || topPostPass;
        }
    }

    const final_status_label = is_completed ? 'Completed' : 'Pending';

    return {
        step_status,
        step_status_top,
        step_status_bottom,
        is_completed,
        final_status_label
    };
};

const isBackendStageSelected = (stage: any, selectedStages: any): boolean => {
    if (selectedStages === null || selectedStages === undefined) return true;
    let list: any[] = [];
    if (Array.isArray(selectedStages)) {
        list = selectedStages;
    } else if (typeof selectedStages === 'string') {
        try { list = JSON.parse(selectedStages); } catch { list = []; }
    }
    if (list.length === 0) return false;
    const codeNorm = normalizeStageId(stage.stage_code || stage.code || '');
    const nameNorm = normalizeStageId(stage.stage_name || stage.name || '');
    const labelNorm = normalizeStageId(stage.stage_label || stage.label || '');
    return list.some((item: any) => {
        const s = typeof item === 'string' ? item : (item?.stage_code || item?.stage_name || item?.stage_label || item?.code || item?.name || item?.label || '');
        const sNorm = normalizeStageId(s);
        return sNorm === codeNorm || sNorm === nameNorm || sNorm === labelNorm ||
            (codeNorm === 'PTH' && (sNorm === 'PRESOLDERING' || sNorm === 'PTH')) ||
            (codeNorm === 'QA' && sNorm === 'QUALITYASSURANCE') ||
            (codeNorm === 'VI' && sNorm === 'VISUALINSPECTION') ||
            (codeNorm === 'QI' && sNorm === 'QUALITYINSPECTION') ||
            (codeNorm === 'PCBA_FCT' && sNorm === 'PCBAFCT') ||
            (codeNorm === 'UNIT_TESTING' && sNorm === 'UNITTESTING');
    });
};

export interface SerialBackendResolution {
    current_stage: string;
    current_status: string;
    final_status_label: string;
    backend_step_status: Record<string, string>;
}

export const resolveSerialsBackendTraceability = async (
    serials: any[],
    wo: any,
    smtResolutions: Record<string, SmtStatusResolution>
): Promise<{
    activeBackendStages: any[];
    serialResolutions: Record<string, SerialBackendResolution>;
}> => {
    let backendStagesList: any[] = [];
    let selectedBackendStages: any[] = [];

    if (wo.has_backend) {
        try {
            const bStagesRes = await backendPool.query(
                `SELECT id, stage_code, stage_name, stage_order 
                 FROM production_stages 
                 WHERE is_active = TRUE AND workflow_type = 'STANDARD' 
                 ORDER BY stage_order ASC`
            );
            backendStagesList = bStagesRes.rows.map((st: any) => ({
                ...st,
                stage_label: st.stage_code === 'PTH' ? 'PTH' : (st.stage_code === 'PCBA_FCT' ? 'PCBA-FCT' : st.stage_name)
            }));
            if (wo.selected_stages) {
                try {
                    selectedBackendStages = typeof wo.selected_stages === 'string' ? JSON.parse(wo.selected_stages) : wo.selected_stages;
                } catch (e) {}
            } else {
                selectedBackendStages = backendStagesList;
            }
        } catch (err: any) {
            logger.warn('Failed to fetch backend stages for WO tracking:', err.message);
        }
    }

    if (backendStagesList.length === 0) {
        backendStagesList = [
            { stage_code: 'PTH', stage_name: 'Pre-Soldering', stage_label: 'PTH', stage_order: 1 },
            { stage_code: 'VI', stage_name: 'Visual Inspection', stage_label: 'VI', stage_order: 2 },
            { stage_code: 'QA', stage_name: 'Quality Assurance', stage_label: 'QA', stage_order: 3 },
            { stage_code: 'FLASHING', stage_name: 'Flashing', stage_label: 'Flashing', stage_order: 4 },
            { stage_code: 'PCBA_FCT', stage_name: 'PCBA FCT', stage_label: 'PCBA-FCT', stage_order: 5 },
            { stage_code: 'ASSEMBLY', stage_name: 'Assembly', stage_label: 'Assembly', stage_order: 6 },
            { stage_code: 'UNIT_TESTING', stage_name: 'Unit Testing', stage_label: 'Unit Testing', stage_order: 7 },
            { stage_code: 'QI', stage_name: 'Quality Inspection', stage_label: 'QI', stage_order: 8 },
            { stage_code: 'PACKING', stage_name: 'Packing', stage_label: 'Packing', stage_order: 9 }
        ];
    }

    const selectedStages = backendStagesList.filter(st => isBackendStageSelected(st, selectedBackendStages));

    const candidateSerialsMap: { [serial: string]: string[] } = {};
    const allBarcodesToQuery = new Set<string>();

    serials.forEach((s: any) => {
        const sn = (s.serial_number || '').trim().toUpperCase();
        if (sn) {
            candidateSerialsMap[s.serial_number] = [sn];
            allBarcodesToQuery.add(sn);
        }
    });

    if (wo.has_backend && allBarcodesToQuery.size > 0) {
        try {
            const mapRes = await backendPool.query(
                `SELECT barcode, unit_serial_number FROM unit_serial_mapping 
                 WHERE UPPER(TRIM(unit_serial_number)) = ANY($1::text[]) 
                    OR UPPER(TRIM(barcode)) = ANY($1::text[])`,
                [Array.from(allBarcodesToQuery)]
            );
            mapRes.rows.forEach((r: any) => {
                const bc = (r.barcode || '').trim().toUpperCase();
                const usn = (r.unit_serial_number || '').trim().toUpperCase();
                if (bc) allBarcodesToQuery.add(bc);
                if (usn) allBarcodesToQuery.add(usn);
                serials.forEach((s: any) => {
                    const sn = (s.serial_number || '').trim().toUpperCase();
                    if (sn === bc || sn === usn) {
                        if (bc && !candidateSerialsMap[s.serial_number].includes(bc)) candidateSerialsMap[s.serial_number].push(bc);
                        if (usn && !candidateSerialsMap[s.serial_number].includes(usn)) candidateSerialsMap[s.serial_number].push(usn);
                    }
                });
            });
        } catch (mErr: any) {
            logger.warn('Backend unit_serial_mapping lookup warning for WO:', mErr.message);
        }
    }

    const backendScansBySerial: { [key: string]: any[] } = {};
    const backendUnitBySerial: { [key: string]: any } = {};

    if (wo.has_backend && allBarcodesToQuery.size > 0) {
        const queryBarcodes = Array.from(allBarcodesToQuery);
        try {
            const scansRes = await backendPool.query(`
                SELECT s.barcode, ps.stage_code, ps.stage_name as station, ps.stage_order, s.scan_result as status, s.scanned_at
                FROM scans s
                JOIN production_stages ps ON s.stage_id = ps.id
                WHERE UPPER(TRIM(s.barcode)) = ANY($1::text[])
                ORDER BY s.scanned_at ASC, s.id ASC
            `, [queryBarcodes]);

            scansRes.rows.forEach((row: any) => {
                const bc = (row.barcode || '').trim().toUpperCase();
                serials.forEach((s: any) => {
                    if (candidateSerialsMap[s.serial_number]?.includes(bc)) {
                        if (!backendScansBySerial[s.serial_number]) backendScansBySerial[s.serial_number] = [];
                        backendScansBySerial[s.serial_number].push({
                            stage_code: row.stage_code,
                            station: row.station,
                            stage_order: row.stage_order,
                            status: normalizeStatus(row.status),
                            scanned_at: row.scanned_at
                        });
                    }
                });
            });

            const unitsRes = await backendPool.query(`
                SELECT u.barcode, u.current_status, ps.stage_code AS current_stage_code, ps.stage_name AS current_stage_name
                FROM units u
                LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                WHERE UPPER(TRIM(u.barcode)) = ANY($1::text[])
            `, [queryBarcodes]);

            unitsRes.rows.forEach((row: any) => {
                const bc = (row.barcode || '').trim().toUpperCase();
                serials.forEach((s: any) => {
                    if (candidateSerialsMap[s.serial_number]?.includes(bc)) {
                        backendUnitBySerial[s.serial_number] = row;
                    }
                });
            });
        } catch (err: any) {
            logger.warn('Failed to fetch backend scans/units for WO:', err.message);
        }
    }

    const serialResolutions: Record<string, SerialBackendResolution> = {};

    serials.forEach((s: any) => {
        const snKey = s.serial_number;
        const bScans = backendScansBySerial[snKey] || [];
        const bUnit = backendUnitBySerial[snKey];
        const smtRes = smtResolutions[snKey];

        const backend_step_status: Record<string, string> = {};

        // 1. Resolve Backend stage statuses for ALL configured backend stages:
        // non-applicable -> N/A, applicable completed -> PASS/FAIL/REWORK, applicable incomplete -> PENDING
        backendStagesList.forEach((st: any) => {
            const isSelected = isBackendStageSelected(st, selectedBackendStages);
            const stepKey = st.stage_code;

            let statusVal = 'PENDING';
            if (!isSelected) {
                statusVal = 'N/A';
            } else {
                const scNorm = normalizeStageId(st.stage_code);
                const snNorm = normalizeStageId(st.stage_name);
                const slNorm = normalizeStageId(st.stage_label);

                const stageScans = bScans.filter((h: any) => {
                    const hCode = normalizeStageId(h.stage_code);
                    const hStat = normalizeStageId(h.station);
                    return hCode === scNorm || hStat === scNorm || hStat === snNorm || (slNorm && hStat === slNorm) ||
                        (scNorm === 'PTH' && (hCode === 'PRESOLDERING' || hStat === 'PRESOLDERING')) ||
                        (scNorm === 'QA' && (hCode === 'QUALITYASSURANCE' || hStat === 'QUALITYASSURANCE')) ||
                        (scNorm === 'VI' && (hCode === 'VISUALINSPECTION' || hStat === 'VISUALINSPECTION')) ||
                        (scNorm === 'QI' && (hCode === 'QUALITYINSPECTION' || hStat === 'QUALITYINSPECTION')) ||
                        (scNorm === 'PCBA_FCT' && (hCode === 'PCBAFCT' || hStat === 'PCBAFCT')) ||
                        (scNorm === 'UNIT_TESTING' && (hCode === 'UNITTESTING' || hStat === 'UNITTESTING'));
                });

                if (stageScans.length > 0) {
                    const lastStScan = stageScans[stageScans.length - 1];
                    const rawSt = (lastStScan.status || '').toUpperCase();
                    if (rawSt === 'ACCEPTED' || rawSt === 'PASS') {
                        statusVal = 'PASS';
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
            }

            backend_step_status[stepKey] = statusVal;
            if (st.stage_name) backend_step_status[st.stage_name] = statusVal;
            if (st.stage_label) backend_step_status[st.stage_label] = statusVal;
            if (st.stage_code === 'PTH') {
                backend_step_status['Pre-Soldering'] = statusVal;
                backend_step_status['PTH'] = statusVal;
            }
            if (st.stage_code === 'PCBA_FCT') {
                backend_step_status['PCBA FCT'] = statusVal;
                backend_step_status['PCBA-FCT'] = statusVal;
                backend_step_status['PCBA_FCT'] = statusVal;
            }
        });

        // 2. Resolve authoritative current_stage & current_status
        let resolvedCurrentStage = s.current_stage || 'Pending';
        let resolvedCurrentStatus = normalizeStatus(s.current_status || 'PENDING');

        if (bScans.length > 0) {
            const lastBackendScan = bScans[bScans.length - 1];
            const lastBackendStation = lastBackendScan.station || lastBackendScan.stage_code;

            if (lastBackendScan.status === 'REWORK' || lastBackendScan.status === 'FAIL') {
                resolvedCurrentStage = lastBackendStation;
                resolvedCurrentStatus = lastBackendScan.status;
            } else if (lastBackendStation.toUpperCase() === 'PACKING' && (lastBackendScan.status === 'PASS' || lastBackendScan.status === 'ACCEPTED')) {
                resolvedCurrentStage = 'Packing';
                resolvedCurrentStatus = 'PASS';
            } else if (bUnit?.current_status === 'COMPLETED') {
                resolvedCurrentStage = 'Packing';
                resolvedCurrentStatus = 'PASS';
            } else if (bUnit?.current_stage_name) {
                resolvedCurrentStage = bUnit.current_stage_name;
                resolvedCurrentStatus = bUnit.current_status || lastBackendScan.status;
            } else {
                resolvedCurrentStage = lastBackendStation;
                resolvedCurrentStatus = lastBackendScan.status;
            }
        } else {
            resolvedCurrentStage = s.current_stage || 'Pending';
            resolvedCurrentStatus = normalizeStatus(s.current_status || 'PENDING');
        }

        // 3. Resolve authoritative final_status_label (overall status)
        let resolvedOverallStatus = 'Pending';
        const allStatuses = [
            ...Object.values(smtRes?.step_status || {}),
            ...Object.values(backend_step_status)
        ];
        const anyFail = allStatuses.some(v => v === 'FAIL' || v.includes('FAIL'));
        const anyRework = allStatuses.some(v => v === 'REWORK' || v.includes('REWORK'));

        if (anyRework) {
            resolvedOverallStatus = 'In Rework';
        } else if (anyFail) {
            resolvedOverallStatus = 'Failed';
        } else if (wo.has_backend) {
            const allActiveBackendPassed = selectedStages.length > 0 && selectedStages.every((st: any) => backend_step_status[st.stage_code] === 'PASS');
            const smtPass = smtRes ? smtRes.is_completed : false;
            if (allActiveBackendPassed && smtPass) {
                resolvedOverallStatus = 'Completed';
            } else {
                resolvedOverallStatus = 'Pending';
            }
        } else {
            resolvedOverallStatus = smtRes?.is_completed ? 'Completed' : 'Pending';
        }

        serialResolutions[snKey] = {
            current_stage: resolvedCurrentStage,
            current_status: resolvedCurrentStatus,
            final_status_label: resolvedOverallStatus,
            backend_step_status
        };
    });

    return { activeBackendStages: backendStagesList, serialResolutions };
};

export const trackSerialNumber = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Serial Number is required.' });
    }

    const inputValue = id.trim().toUpperCase();

    try {
        // 1. Find the serial number record
        const serialResult = await pool.query(
            `SELECT sn.*, wo.product_name, wo.quantity, wo.line_id, wo.sides, wo.has_smt, wo.has_backend, wo.selected_stages, wo.customer_name, wo.model_name, wo.created_by as wo_created_by, wo.created_at as wo_created_at
             FROM smt_serial_numbers sn
             LEFT JOIN smt_work_orders wo ON sn.work_order_id = wo.id
             WHERE sn.serial_number = $1`,
            [inputValue]
        );

        if ((serialResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `"${inputValue}" was not found in the system. Please check the Serial Number.` });
        }

        const serial = serialResult.rows[0];

        // 2. Fetch all inspection history for this serial across all process steps
        const historyResult = await pool.query(
            `SELECT 
                i.id,
                i.serial_id,
                i.process_step,
                i.scanned_by,
                i.scanned_at,
                i.status,
                i.rework_reason,
                COALESCE(
                    ps.side,
                    spis.side,
                    pas.side,
                    poas.side,
                    rs.side,
                    fgs.side
                ) AS side
            FROM smt_inspections i
            LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
            LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
            LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
            LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
            LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
            LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
            WHERE i.serial_id = $1
            ORDER BY i.scanned_at ASC`,
            [serial.id]
        );

        const history = historyResult.rows.map((row: any) => ({
            id: row.id,
            process_step: row.process_step || '-',
            status: (row.status || '').toUpperCase(),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            rework_reason: row.rework_reason || null,
            side: row.side || null,
        }));

        // 3. Fetch Solder Paste details for the work order
        const spResult = await pool.query(
            `SELECT 
                solder_paste_barcode, 
                solder_paste_status,
                solder_paste_stage1_operator, 
                solder_paste_stage1_employee_code, 
                solder_paste_stage1_at, 
                solder_paste_stage1_status,
                solder_paste_stage2_start_at, 
                solder_paste_stage2_status,
                solder_paste_stage3_start_at, 
                solder_paste_stage3_completed_at, 
                solder_paste_stage3_operator, 
                solder_paste_stage3_employee_code, 
                solder_paste_stage3_status
             FROM smt_work_orders WHERE id = $1`,
            [serial.work_order_id]
        );
        const sp = spResult.rows[0] || {};
        
        const spLogsResult = await pool.query(
            `SELECT process_step, scanned_by, scanned_at, status, rework_reason
             FROM smt_inspections
             WHERE work_order_id = $1 AND serial_id IS NULL
             ORDER BY scanned_at ASC`,
            [serial.work_order_id]
        );
        const spLogs = spLogsResult.rows.map((row: any) => ({
            process_step: row.process_step || '-',
            status: normalizeStatus(row.status || ''),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            rework_reason: row.rework_reason || null
        }));

        // 4. Resolve all Backend unit identifiers (PCB Barcode, Unit Serial Number, etc.)
        const candidateBarcodes = new Set<string>([serial.serial_number.toUpperCase()]);
        try {
            // Lookup 1: via unit_serial_mapping (handles case where PCB barcode != SMT serial)
            const mapRes = await backendPool.query(
                `SELECT barcode, unit_serial_number FROM unit_serial_mapping 
                 WHERE UPPER(TRIM(unit_serial_number)) = $1 OR UPPER(TRIM(barcode)) = $1`,
                [serial.serial_number.toUpperCase()]
            );
            mapRes.rows.forEach((r: any) => {
                if (r.barcode) candidateBarcodes.add(r.barcode.toUpperCase());
                if (r.unit_serial_number) candidateBarcodes.add(r.unit_serial_number.toUpperCase());
            });

            // Lookup 2: check units table directly in case barcode = SMT serial (no mapping row needed)
            const unitsRes = await backendPool.query(
                `SELECT barcode FROM units WHERE UPPER(TRIM(barcode)) = $1 LIMIT 1`,
                [serial.serial_number.toUpperCase()]
            );
            unitsRes.rows.forEach((r: any) => {
                if (r.barcode) candidateBarcodes.add(r.barcode.toUpperCase());
            });
        } catch (mErr: any) {
            logger.warn('Backend unit identifier lookup warning:', mErr.message);
        }

        // 5. Dynamic Backend Stages & Scans (Data-Driven for future-proofing)
        let backendStagesList: any[] = [];
        let backendScanHistory: any[] = [];
        let backendStagesResolved: any[] = [];
        let backendUnitRecord: any = null;

        try {
            const uRes = await backendPool.query(
                `SELECT u.barcode, u.current_stage_id, ps.stage_name AS current_stage_name, ps.stage_code AS current_stage_code, u.current_status 
                 FROM units u 
                 LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                 WHERE UPPER(TRIM(u.barcode)) = ANY($1) 
                 ORDER BY u.updated_at DESC LIMIT 1`,
                [Array.from(candidateBarcodes)]
            );
            if (uRes.rows.length > 0) {
                backendUnitRecord = uRes.rows[0];
            }

            const bStagesRes = await backendPool.query(
                `SELECT id, stage_code, stage_name, stage_order, workflow_type 
                 FROM production_stages 
                 WHERE is_active = TRUE AND workflow_type = 'STANDARD'
                 ORDER BY stage_order ASC`
            );
            backendStagesList = bStagesRes.rows.map((st: any) => ({
                ...st,
                stage_label: st.stage_code === 'PTH' ? 'PTH' : (st.stage_code === 'PCBA_FCT' ? 'PCBA-FCT' : st.stage_name)
            }));

            const bScansRes = await backendPool.query(
                `SELECT 
                    s.id,
                    s.barcode,
                    s.stage_id,
                    ps.stage_code,
                    ps.stage_name AS station,
                    ps.stage_order,
                    s.scan_result AS status,
                    s.scanned_by,
                    s.scanned_at,
                    s.remarks
                FROM scans s
                JOIN production_stages ps ON s.stage_id = ps.id
                WHERE UPPER(TRIM(s.barcode)) = ANY($1)
                ORDER BY s.scanned_at ASC, s.id ASC`,
                [Array.from(candidateBarcodes)]
            );

            // Audit Log: only ACTUAL scans recorded in database
            backendScanHistory = bScansRes.rows.map((row: any) => ({
                id: row.id,
                stage_code: row.stage_code || null,
                station: row.station || row.stage_name || row.stage_code,
                process_step: row.station || row.stage_name || row.stage_code,
                stage_order: row.stage_order,
                status: normalizeStatus(row.status),
                scanned_by: row.scanned_by || '-',
                scanned_at: row.scanned_at,
                remarks: row.remarks || null,
            }));

            // Resolve Pipeline Status for every backend stage
            backendStagesResolved = backendStagesList.map((stage: any) => {
                const isSelected = isBackendStageSelected(stage, serial.selected_stages);
                if (!isSelected) {
                    return {
                        code: stage.stage_code,
                        name: stage.stage_name,
                        label: stage.stage_label || stage.stage_name,
                        stage_order: stage.stage_order,
                        is_selected: false,
                        status: 'N/A',
                        scans_count: 0,
                        scans: []
                    };
                }

                const stageScans = backendScanHistory.filter((h: any) => {
                    const sc = normalizeStageId(h.stage_code || '');
                    const st = normalizeStageId(h.station || '');
                    const cn = normalizeStageId(stage.stage_code);
                    const nn = normalizeStageId(stage.stage_name);
                    const ln = normalizeStageId(stage.stage_label || '');
                    return sc === cn || st === cn || st === nn || (ln && st === ln);
                });

                if (stageScans.length > 0) {
                    const latest = stageScans[stageScans.length - 1];
                    const rawSt = latest.status;
                    const stageStatus = (rawSt === 'PASS' || rawSt === 'ACCEPTED') ? 'PASS' : (rawSt === 'FAIL' || rawSt === 'FAILED') ? 'FAIL' : rawSt;
                    return {
                        code: stage.stage_code,
                        name: stage.stage_name,
                        label: stage.stage_label || stage.stage_name,
                        stage_order: stage.stage_order,
                        is_selected: true,
                        status: stageStatus,
                        scans_count: stageScans.length,
                        scans: stageScans
                    };
                } else {
                    return {
                        code: stage.stage_code,
                        name: stage.stage_name,
                        label: stage.stage_label || stage.stage_name,
                        stage_order: stage.stage_order,
                        is_selected: true,
                        status: 'PENDING',
                        scans_count: 0,
                        scans: []
                    };
                }
            });

        } catch (bErr: any) {
            logger.warn('Failed to fetch backend stages/scans:', bErr.message);
        }

        // 6. Build single COMBINED scan history (SMT + Backend) in true chronological order
        const combinedHistory = [
            ...history.map((h: any) => ({
                id: h.id,
                source: 'SMT',
                process_step: h.process_step || '-',
                status: normalizeStatus(h.status || ''),
                scanned_by: h.scanned_by || '-',
                scanned_at: h.scanned_at,
                remark: h.rework_reason || null,
                side: h.side || null
            })),
            ...backendScanHistory.map((h: any) => ({
                id: h.id,
                source: 'Backend',
                process_step: h.station || h.stage_code || '-',
                status: normalizeStatus(h.status || ''),
                scanned_by: h.scanned_by || '-',
                scanned_at: h.scanned_at,
                remark: h.remarks || null,
                side: null
            }))
        ].sort((a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime());

        // 7. Determine Current Stage & Status authoritatively across BOTH SMT and Backend
        let currentStage = 'Pending';
        let currentStatus = 'PENDING';

        if (backendScanHistory.length > 0) {
            const lastBScan = backendScanHistory[backendScanHistory.length - 1];
            const lastBStation = lastBScan.station || lastBScan.stage_code;
            if (lastBScan.status === 'REWORK' || lastBScan.status === 'FAIL') {
                currentStage = lastBStation;
                currentStatus = lastBScan.status;
            } else if (lastBStation.toUpperCase() === 'PACKING' && (lastBScan.status === 'PASS' || lastBScan.status === 'ACCEPTED')) {
                currentStage = 'Packing';
                currentStatus = 'PASS';
            } else if (backendUnitRecord?.current_status === 'COMPLETED') {
                currentStage = 'Packing';
                currentStatus = 'PASS';
            } else if (backendUnitRecord?.current_stage_name) {
                currentStage = backendUnitRecord.current_stage_name;
                currentStatus = backendUnitRecord.current_status || lastBScan.status;
            } else {
                currentStage = lastBStation;
                currentStatus = lastBScan.status;
            }
        } else if (combinedHistory.length > 0) {
            const lastRecord = combinedHistory[combinedHistory.length - 1];
            currentStage = lastRecord.process_step;
            currentStatus = lastRecord.status;
        }

        // 8. Compute summary statistics from COMBINED SMT + Backend tracking records
        const totalFailures = combinedHistory.filter(h => h.status === 'REWORK' || h.status === 'FAIL').length;
        const totalReworks = combinedHistory.filter(h => h.process_step === 'Rework' || h.status === 'REWORK').length;
        const totalPassed = combinedHistory.filter(h => h.status === 'PASS').length;

        // 9. Determine final overall status
        let finalStatusLabel = 'IN PRODUCTION';
        const hasBackend = serial.has_backend ?? true;
        const hasSmt = serial.has_smt ?? true;

        const isDoubleSided = isTopBottomWo(serial.sides);
        const isBottomOnly = isBottomOnlyWo(serial.sides);

        // Check latest status of each side to see if anything is currently FAIL or REWORK
        const topStatuses: Record<string, string> = {};
        const bottomStatuses: Record<string, string> = {};
        const overallStatuses: Record<string, string> = {};

        for (const h of history) {
            const step = h.process_step;
            const st = normalizeStatus(h.status);
            const side = (h.side || '').toUpperCase();
            if (side === 'TOP') {
                topStatuses[step] = st;
            } else if (side === 'BOTTOM') {
                bottomStatuses[step] = st;
            } else {
                overallStatuses[step] = st;
            }
        }

        const anyFail = Object.values(topStatuses).includes('FAIL') || Object.values(bottomStatuses).includes('FAIL') || Object.values(overallStatuses).includes('FAIL') || currentStatus === 'FAIL';
        const anyRework = Object.values(topStatuses).includes('REWORK') || Object.values(bottomStatuses).includes('REWORK') || Object.values(overallStatuses).includes('REWORK') || currentStatus === 'REWORK';
        const hasActiveFailure = anyFail || anyRework;

        let smtCompleted = false;
        if (!hasSmt) {
            smtCompleted = true;
        } else if (!hasActiveFailure) {
            if (isDoubleSided) {
                const topPostPass = topStatuses['Post AOI'] === 'PASS' || topStatuses['Post_AOI'] === 'PASS';
                const botPostPass = bottomStatuses['Post AOI'] === 'PASS' || bottomStatuses['Post_AOI'] === 'PASS';
                const topFgPass = topStatuses['SMT FG'] === 'PASS' || topStatuses['SMT_FG'] === 'PASS';
                const overallFgPass = overallStatuses['SMT FG'] === 'PASS' || overallStatuses['SMT_FG'] === 'PASS';

                smtCompleted = topFgPass || overallFgPass || (topPostPass && botPostPass);
            } else if (isBottomOnly) {
                const botPostPass = bottomStatuses['Post AOI'] === 'PASS' || bottomStatuses['Post_AOI'] === 'PASS' || overallStatuses['Post AOI'] === 'PASS' || overallStatuses['Post_AOI'] === 'PASS';
                const botFgPass = bottomStatuses['SMT FG'] === 'PASS' || bottomStatuses['SMT_FG'] === 'PASS' || overallStatuses['SMT FG'] === 'PASS' || overallStatuses['SMT_FG'] === 'PASS';
                smtCompleted = botFgPass || botPostPass;
            } else {
                const topPostPass = topStatuses['Post AOI'] === 'PASS' || topStatuses['Post_AOI'] === 'PASS' || overallStatuses['Post AOI'] === 'PASS' || overallStatuses['Post_AOI'] === 'PASS';
                const topFgPass = topStatuses['SMT FG'] === 'PASS' || topStatuses['SMT_FG'] === 'PASS' || overallStatuses['SMT FG'] === 'PASS' || overallStatuses['SMT_FG'] === 'PASS';
                smtCompleted = topFgPass || topPostPass;
            }
        }

        const allActiveBackendPassed = backendStagesResolved.length > 0 &&
            backendStagesResolved.filter((s: any) => s.is_selected).every((s: any) => s.status === 'PASS' || s.status === 'PASSED');

        if (anyRework) {
            finalStatusLabel = 'IN REWORK';
        } else if (anyFail) {
            finalStatusLabel = 'FAILED';
        } else if (hasBackend ? (smtCompleted && allActiveBackendPassed) : smtCompleted) {
            finalStatusLabel = 'COMPLETED';
            currentStatus = 'PASS';
        } else {
            finalStatusLabel = 'IN PRODUCTION';
        }

        const resStatus = resolveSerialSmtStatuses(
            serial.sides,
            topStatuses,
            bottomStatuses,
            overallStatuses,
            hasActiveFailure,
            smtCompleted,
            serial.has_smt !== false
        );
        const stepStatusTop = resStatus.step_status_top;
        const stepStatusBottom = resStatus.step_status_bottom;

        return res.status(200).json({
            serial_number: serial.serial_number,
            serial_format: serial.serial_format,
            work_order_id: serial.work_order_id,
            product_name: serial.product_name || '-',
            customer_name: serial.customer_name || '-',
            model_name: serial.model_name || '-',
            quantity: serial.quantity || '-',
            line_id: serial.line_id || '-',
            sides: serial.sides || '-',
            is_double_sided: isDoubleSided,
            has_smt: serial.has_smt ?? true,
            has_backend: serial.has_backend ?? true,
            selected_stages: serial.selected_stages || null,
            current_stage: currentStage,
            current_status: currentStatus,
            final_status_label: finalStatusLabel,
            created_at: serial.created_at,
            total_failures: totalFailures,
            total_reworks: totalReworks,
            total_passed: totalPassed,
            step_status_top: stepStatusTop,
            step_status_bottom: stepStatusBottom,
            scan_history: history,
            backend_scan_history: backendScanHistory,
            backend_stages: backendStagesResolved,
            combined_history: combinedHistory,
            solder_paste: {
                barcode: sp.solder_paste_barcode || '-',
                status: sp.solder_paste_status || 'Pending',
                stage1: {
                    operator: sp.solder_paste_stage1_operator || '-',
                    employee_code: sp.solder_paste_stage1_employee_code || '-',
                    completed_at: sp.solder_paste_stage1_at || null,
                    status: sp.solder_paste_stage1_status || 'Pending'
                },
                stage2: {
                    start_at: sp.solder_paste_stage2_start_at || null,
                    status: sp.solder_paste_stage2_status || 'Pending'
                },
                stage3: {
                    start_at: sp.solder_paste_stage3_start_at || null,
                    completed_at: sp.solder_paste_stage3_completed_at || null,
                    operator: sp.solder_paste_stage3_operator || '-',
                    employee_code: sp.solder_paste_stage3_employee_code || '-',
                    status: sp.solder_paste_stage3_status || 'Pending'
                },
                logs: spLogs
            }
        });

    } catch (err: any) {
        logger.error('❌ Error in trackSerialNumber:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};

export const trackWorkOrder = async (req: Request, res: Response) => {
    const { woId } = req.params;
    const { page = '1', limit = '50', search = '', filterDate = '', filterStatus = '' } = req.query;

    if (!woId || woId.trim() === '') {
        return res.status(400).json({ error: 'Work Order ID is required.' });
    }

    const inputValue = woId.trim().toUpperCase();
    const isFetchAll = limit === 'all' || req.query.fetchAll === 'true';
    const pageNum = parseInt(page as string, 10) || 1;
    const limitNum = isFetchAll ? 100000 : (parseInt(limit as string, 10) || 50);
    const offset = isFetchAll ? 0 : (pageNum - 1) * limitNum;
    
    const searchStr = (search as string).trim() ? `%${(search as string).trim()}%` : null;
    const dateStr = (filterDate as string).trim() || null;
    const statusStr = (filterStatus as string).trim() || null;

    try {
        // 1. Find the work order record
        const woResult = await pool.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 OR po_id = $1 LIMIT 1`,
            [inputValue]
        );

        if ((woResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `Work Order "${inputValue}" was not found in the system.`, code: 'WORK_ORDER_NOT_FOUND' });
        }

        const wo = woResult.rows[0];
        const isDoubleSided = isTopBottomWo(wo.sides);
        const isBottomOnly = isBottomOnlyWo(wo.sides);

        // 2. Fetch all serials and aggregate their history using optimized SQL
        const serialsResult = await pool.query(`
            WITH inspection_with_side AS (
                SELECT 
                    i.id,
                    i.serial_id,
                    i.process_step,
                    i.status,
                    i.scanned_at,
                    UPPER(TRIM(COALESCE(ps.side, spis.side, pas.side, poas.side, rs.side, fgs.side))) AS side
                FROM smt_inspections i
                LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
                LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
                LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
                LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
                LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
                LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
                WHERE i.serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
            ),
            latest_overall AS (
                SELECT DISTINCT ON (serial_id) serial_id, process_step as current_stage, status as current_status
                FROM inspection_with_side
                ORDER BY serial_id, scanned_at DESC, id DESC
            ),
            latest_side_steps AS (
                SELECT DISTINCT ON (serial_id, process_step, side)
                    serial_id, process_step, COALESCE(side, 'NONE') as side, status
                FROM inspection_with_side
                ORDER BY serial_id, process_step, side, scanned_at DESC, id DESC
            ),
            agg_steps AS (
                SELECT serial_id,
                       jsonb_object_agg(process_step, status) FILTER (WHERE side = 'TOP') as step_statuses_top,
                       jsonb_object_agg(process_step, status) FILTER (WHERE side = 'BOTTOM') as step_statuses_bottom,
                       jsonb_object_agg(process_step, status) as step_statuses,
                       MAX(status) FILTER (WHERE side = 'TOP' AND process_step = 'SMT FG') as top_smt_fg_status,
                       MAX(status) FILTER (WHERE side = 'BOTTOM' AND process_step = 'SMT FG') as bot_smt_fg_status,
                       MAX(status) FILTER (WHERE process_step = 'SMT FG') as overall_smt_fg_status,
                       MAX(status) FILTER (WHERE side = 'TOP' AND (process_step = 'Post AOI' OR process_step = 'Post_AOI')) as top_post_aoi_status,
                       MAX(status) FILTER (WHERE side = 'BOTTOM' AND (process_step = 'Post AOI' OR process_step = 'Post_AOI')) as bot_post_aoi_status,
                       MAX(status) FILTER (WHERE process_step = 'Post AOI' OR process_step = 'Post_AOI') as overall_post_aoi_status,
                       BOOL_OR(status IN ('FAIL', 'REWORK')) as has_active_failure
                FROM latest_side_steps
                GROUP BY serial_id
            ),
            stats AS (
                SELECT serial_id,
                       count(case when status IN ('REWORK', 'FAIL') then 1 end) as total_failures,
                       count(case when process_step = 'Rework' then 1 end) as total_reworks,
                       count(case when process_step = 'Debug' then 1 end) as total_debugs,
                       count(case when status = 'PASS' then 1 end) as total_passed
                FROM inspection_with_side
                GROUP BY serial_id
            ),
            combined_serials AS (
                SELECT sn.id, sn.serial_number, sn.serial_format, sn.created_at,
                       COALESCE(lo.current_stage, 'Pending') as current_stage,
                       COALESCE(lo.current_status, 'PENDING') as current_status,
                       COALESCE(st.total_failures, 0) as total_failures,
                       COALESCE(st.total_reworks, 0) as total_reworks,
                       COALESCE(st.total_debugs, 0) as total_debugs,
                       COALESCE(st.total_passed, 0) as total_passed,
                       COALESCE(ast.step_statuses, '{}'::jsonb) as step_statuses,
                       COALESCE(ast.step_statuses_top, '{}'::jsonb) as step_statuses_top,
                       COALESCE(ast.step_statuses_bottom, '{}'::jsonb) as step_statuses_bottom,
                       CASE
                           WHEN COALESCE(ast.has_active_failure, false) = true THEN false
                           WHEN $7::boolean = true THEN
                               (COALESCE(ast.overall_smt_fg_status, '') = 'PASS')
                               OR (COALESCE(ast.top_smt_fg_status, '') = 'PASS' AND COALESCE(ast.bot_smt_fg_status, '') = 'PASS')
                               OR (COALESCE(ast.top_post_aoi_status, '') = 'PASS' AND COALESCE(ast.bot_post_aoi_status, '') = 'PASS')
                               OR (COALESCE(ast.top_smt_fg_status, '') = 'PASS' AND COALESCE(ast.bot_post_aoi_status, '') = 'PASS')
                               OR (COALESCE(ast.bot_smt_fg_status, '') = 'PASS' AND COALESCE(ast.top_post_aoi_status, '') = 'PASS')
                           WHEN $8::boolean = true THEN
                               (COALESCE(ast.bot_smt_fg_status, '') = 'PASS' OR COALESCE(ast.overall_smt_fg_status, '') = 'PASS' OR COALESCE(ast.bot_post_aoi_status, '') = 'PASS' OR COALESCE(ast.overall_post_aoi_status, '') = 'PASS')
                           ELSE
                               (COALESCE(ast.top_smt_fg_status, '') = 'PASS' OR COALESCE(ast.overall_smt_fg_status, '') = 'PASS' OR COALESCE(ast.top_post_aoi_status, '') = 'PASS' OR COALESCE(ast.overall_post_aoi_status, '') = 'PASS')
                       END as is_completed
                FROM smt_serial_numbers sn
                LEFT JOIN latest_overall lo ON sn.id = lo.serial_id
                LEFT JOIN stats st ON sn.id = st.serial_id
                LEFT JOIN agg_steps ast ON sn.id = ast.serial_id
                WHERE sn.work_order_id = $1
            ),
            filtered_serials AS (
                SELECT * FROM combined_serials
                WHERE 
                    ($2::text IS NULL OR serial_number ILIKE $2)
                    AND ($3::date IS NULL OR DATE(created_at) = $3)
                    AND (
                        $4::text IS NULL 
                        OR ($4 = 'COMPLETED' AND is_completed = true)
                        OR ($4 = 'PENDING' AND is_completed = false)
                    )
            ),
            totals AS (
                SELECT 
                    (SELECT COUNT(*) FROM filtered_serials) as total_filtered,
                    COUNT(CASE WHEN is_completed = true THEN 1 END) as total_completed,
                    COUNT(CASE WHEN is_completed = false THEN 1 END) as total_pending,
                    COUNT(*) as total_all
                FROM combined_serials
                WHERE
                    ($2::text IS NULL OR serial_number ILIKE $2)
                    AND ($3::date IS NULL OR DATE(created_at) = $3)
            )
            SELECT
                f.id, f.serial_number, f.serial_format, f.created_at,
                f.current_stage, f.current_status,
                f.total_failures, f.total_reworks, f.total_debugs, f.total_passed,
                f.step_statuses, f.step_statuses_top, f.step_statuses_bottom,
                f.is_completed,
                t.total_filtered, t.total_completed, t.total_pending, t.total_all
            FROM totals t
            LEFT JOIN LATERAL (
                SELECT * FROM filtered_serials
                ORDER BY id ASC
                LIMIT $5 OFFSET $6
            ) f ON true
        `, [wo.id, searchStr, dateStr, statusStr, limitNum, offset, isDoubleSided, isBottomOnly]);

        let totalFiltered = 0;
        let totalCompleted = 0;
        let totalPending = 0;
        let totalAll = 0;

        let serialRows = serialsResult.rows;
        if (serialRows.length > 0) {
            totalFiltered = Number(serialRows[0].total_filtered) || 0;
            totalCompleted = Number(serialRows[0].total_completed) || 0;
            totalPending = Number(serialRows[0].total_pending) || 0;
            totalAll = Number(serialRows[0].total_all) || 0;
            if (serialRows[0].id === null) {
                serialRows = [];
            }
        }

        const smtResolutions: Record<string, SmtStatusResolution> = {};
        serialRows.forEach((s: any) => {
            smtResolutions[s.serial_number] = resolveSerialSmtStatuses(
                wo.sides,
                s.step_statuses_top,
                s.step_statuses_bottom,
                s.step_statuses,
                false,
                Boolean(s.is_completed),
                wo.has_smt !== false
            );
        });

        const { activeBackendStages, serialResolutions } = await resolveSerialsBackendTraceability(
            serialRows,
            wo,
            smtResolutions
        );

        const mappedSerials = serialRows.map((s: any) => {
            const smtRes = smtResolutions[s.serial_number];
            const bRes = serialResolutions[s.serial_number];

            const finalStepStatus: Record<string, string> = {
                ...smtRes.step_status,
                ...(bRes?.backend_step_status || {})
            };

            return {
                serial_number: s.serial_number,
                current_stage: bRes?.current_stage || s.current_stage || 'Pending',
                current_status: bRes?.current_status || (s.current_status || 'PENDING'),
                final_status_label: bRes?.final_status_label || (smtRes.is_completed ? 'Completed' : 'Pending'),
                total_failures: Number(s.total_failures) || 0,
                total_reworks: Number(s.total_reworks) || 0,
                total_debugs: Number(s.total_debugs) || 0,
                total_passed: Number(s.total_passed) || 0,
                step_status: finalStepStatus,
                step_status_top: smtRes.step_status_top,
                step_status_bottom: smtRes.step_status_bottom,
                created_at: s.created_at
            };
        });

        const totalFilteredCount = totalFiltered;
        const totalCompletedCount = totalCompleted;
        const totalPendingCount = totalPending;
        const totalAllCount = totalAll;

        const spLogsResult = await pool.query(
            `SELECT process_step, scanned_by, scanned_at, status, rework_reason
             FROM smt_inspections
             WHERE work_order_id = $1 AND serial_id IS NULL
             ORDER BY scanned_at ASC`,
            [wo.id]
        );
        const spLogs = spLogsResult.rows.map((row: any) => ({
            process_step: row.process_step || '-',
            status: (row.status || '').toUpperCase(),
            scanned_by: row.scanned_by || '-',
            scanned_at: row.scanned_at,
            rework_reason: row.rework_reason || null
        }));

        return res.status(200).json({
            work_order_id: wo.id || wo.work_order_id,
            product_name: wo.product_name,
            customer_name: wo.customer_name || '-',
            model_name: wo.model_name || '-',
            quantity: wo.quantity,
            line_id: wo.line_id,
            sides: wo.sides || '-',
            has_smt: wo.has_smt ?? true,
            has_backend: wo.has_backend ?? true,
            selected_stages: wo.selected_stages,
            active_backend_stages: activeBackendStages,
            total_serials: totalAll,
            total_filtered: totalFiltered,
            completed_count: totalCompleted,
            pending_count: totalPending,
            page: pageNum,
            limit: limitNum,
            serials: mappedSerials,
            solder_paste: {
                barcode: wo.solder_paste_barcode || '-',
                status: wo.solder_paste_status || 'Pending',
                stage1: {
                    operator: wo.solder_paste_stage1_operator || '-',
                    employee_code: wo.solder_paste_stage1_employee_code || '-',
                    completed_at: wo.solder_paste_stage1_at || null,
                    status: wo.solder_paste_stage1_status || 'Pending'
                },
                stage2: {
                    start_at: wo.solder_paste_stage2_start_at || null,
                    status: wo.solder_paste_stage2_status || 'Pending'
                },
                stage3: {
                    start_at: wo.solder_paste_stage3_start_at || null,
                    completed_at: wo.solder_paste_stage3_completed_at || null,
                    operator: wo.solder_paste_stage3_operator || '-',
                    employee_code: wo.solder_paste_stage3_employee_code || '-',
                    status: wo.solder_paste_stage3_status || 'Pending'
                },
                logs: spLogs
            }
        });

    } catch (err: any) {
        logger.error('❌ Error in trackWorkOrder:', err);
        return res.status(500).json({ error: 'Failed to retrieve traceability data: ' + err.message });
    }
};

export const getCountDetails = async (req: Request, res: Response) => {
    const { workOrderId, stage, type, page = '1', limit = '10', search = '', sessionId, side } = req.query;

    if (!workOrderId) {
        return res.status(400).json({ error: 'workOrderId is required.' });
    }

    const woIdStr = (workOrderId as string).trim().toUpperCase();
    const stageStr = (stage as string || '').trim();
    const typeStr = (type as string || '').trim();
    const pageNum = parseInt(page as string || '1');
    const limitNum = parseInt(limit as string || '10');
    const searchStr = (search as string || '').trim().toUpperCase();
    const sessionIdStr = (sessionId as string || '').trim();
    const sideStr = (side as string || '').trim().toLowerCase();

    try {
        const normStage = stageStr.toLowerCase();
        const normType = typeStr.toLowerCase();

        // 1. If a specific session ID is provided (e.g. from an active session card modal)
        if (sessionIdStr) {
            const sessionInspectionsRes = await pool.query(
                `SELECT 
                    i.id,
                    i.serial_id,
                    COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text) AS serial_number,
                    UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))) AS clean_serial,
                    i.process_step,
                    i.scanned_by,
                    i.scanned_at,
                    UPPER(TRIM(i.status)) AS status,
                    i.rework_reason,
                    i.repair_time,
                    i.repair_remark
                 FROM smt_inspections i
                 LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                 WHERE (
                     i.spi_session_id::text = $1
                     OR i.pre_aoi_session_id::text = $1
                     OR i.post_aoi_session_id::text = $1
                     OR i.rework_session_id::text = $1
                     OR i.printing_session_id::text = $1
                     OR i.fg_session_id::text = $1
                 )
                 ORDER BY i.scanned_at ASC, i.id ASC`,
                [sessionIdStr]
            );

            // Deduplicate by clean_serial so the last inspection row represents the unit's latest state in this session
            const latestByUnit: Record<string, any> = {};
            sessionInspectionsRes.rows.forEach((row: any) => {
                latestByUnit[row.clean_serial] = {
                    ...row,
                    status: normalizeStatus(row.status)
                };
            });

            const sessionUnits = Object.values(latestByUnit);
            let filtered: any[] = [];

            if (normType === 'failed') {
                const failedByUnit: Record<string, any> = {};
                sessionInspectionsRes.rows.forEach((row: any) => {
                    const st = normalizeStatus(row.status);
                    if (st === 'FAIL' || st === 'REWORK') {
                        failedByUnit[row.clean_serial] = {
                            ...row,
                            status: 'FAIL'
                        };
                    }
                });
                filtered = Object.values(failedByUnit).map(u => ({
                    serial_number: u.serial_number,
                    status: 'FAIL',
                    scanned_by: u.scanned_by,
                    scanned_at: u.scanned_at,
                    previous_stage: stageStr,
                    rework_reason: u.rework_reason || 'Defect Registered'
                }));
            } else if (normType === 'passed' || normType === 'scanned') {
                filtered = sessionUnits.filter(u => u.status === 'PASS').map(u => ({
                    serial_number: u.serial_number,
                    status: 'PASS',
                    scanned_by: u.scanned_by,
                    scanned_at: u.scanned_at,
                    previous_stage: stageStr,
                    rework_reason: u.repair_remark || null
                }));
            } else {
                filtered = sessionUnits.map(u => ({
                    serial_number: u.serial_number,
                    status: u.status,
                    scanned_by: u.scanned_by,
                    scanned_at: u.scanned_at,
                    previous_stage: stageStr,
                    rework_reason: u.rework_reason || u.repair_remark || null
                }));
            }

            if (searchStr) {
                filtered = filtered.filter(item => (item.serial_number || '').toUpperCase().includes(searchStr));
            }

            const total = filtered.length;
            const startIndex = (pageNum - 1) * limitNum;
            const paginated = filtered.slice(startIndex, startIndex + limitNum);

            return res.status(200).json({
                total,
                page: pageNum,
                limit: limitNum,
                data: paginated
            });
        }

        // 2. Work Order Level Query (e.g. from Work Order History / Tracking)
        const serialsResult = await pool.query(
            `SELECT sn.id, sn.serial_number, sn.serial_format, sn.created_at, sn.created_by, sn.status as main_status
             FROM smt_serial_numbers sn
             WHERE sn.work_order_id = $1
             ORDER BY sn.id ASC`,
            [woIdStr]
        );

        const inspectionsResult = await pool.query(
            `SELECT i.serial_id, i.process_step, i.scanned_by, i.scanned_at, UPPER(TRIM(i.status)) as status, i.rework_reason, i.repair_time, i.repair_remark
             FROM smt_inspections i
             JOIN smt_serial_numbers sn ON i.serial_id = sn.id
             WHERE sn.work_order_id = $1
             ORDER BY i.scanned_at ASC, i.id ASC`,
            [woIdStr]
        );

        const inspectionsBySerial: Record<number, any[]> = {};
        inspectionsResult.rows.forEach((row: any) => {
            if (!inspectionsBySerial[row.serial_id]) {
                inspectionsBySerial[row.serial_id] = [];
            }
            inspectionsBySerial[row.serial_id].push({
                ...row,
                status: normalizeStatus(row.status)
            });
        });

        const mappedSerials = serialsResult.rows.map((sn: any) => {
            const history = inspectionsBySerial[sn.id] || [];
            const stepLatest: Record<string, any> = {};
            history.forEach((insp: any) => {
                stepLatest[insp.process_step] = insp;
            });
            return {
                id: sn.id,
                serial_number: sn.serial_number,
                serial_format: sn.serial_format,
                created_at: sn.created_at,
                created_by: sn.created_by,
                main_status: sn.main_status,
                history,
                stepLatest
            };
        });

        // Dynamic Previous Stage Calculator for SMT
        const getSMTPreviousStage = (s: any, currentProcessStage: string) => {
            const stg = currentProcessStage.toLowerCase();
            if (stg === 'printing') return 'Serial Number';
            if (stg === 'spi') return 'Printing';
            if (stg === 'pre aoi' || stg === 'pre_aoi') return 'SPI';
            if (stg === 'post aoi' || stg === 'post_aoi') return 'Pre AOI';
            if (stg === 'rework') return 'Post AOI';
            if (stg === 'smt fg' || stg === 'smt_fg') {
                return (s && s.stepLatest && s.stepLatest['Rework']) ? 'Rework' : 'Post AOI';
            }
            if (stg === 'work order' || stg === 'work_order' || stg === 'work order history' || stg === 'work_order_history') {
                return (s && s.stepLatest && s.stepLatest['Rework']) ? 'Rework' : 'Post AOI';
            }
            return '-';
        };

        let filtered: any[] = [];

        switch (normStage) {
            case 'work order':
            case 'work_order':
            case 'work order history':
            case 'work_order_history': {
                if (normType === 'passed' || normType === 'completed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SMT FG']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['SMT FG']?.scanned_by || 'System',
                        scanned_at: s.stepLatest['SMT FG']?.scanned_at || s.created_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending' || normType === 'balance') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SMT FG']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['SMT FG']?.status || 'PENDING',
                        scanned_by: s.created_by || 'System',
                        scanned_at: s.created_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                }
                break;
            }

            case 'serial number':
            case 'serial_number': {
                filtered = mappedSerials.map(s => ({
                    serial_number: s.serial_number,
                    status: 'GENERATED',
                    scanned_by: s.created_by || 'System',
                    scanned_at: s.created_at,
                    previous_stage: getSMTPreviousStage(s, stageStr),
                    rework_reason: null
                }));
                break;
            }

            case 'printing': {
                if (normType === 'passed' || normType === 'scanned') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Printing']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Printing']?.scanned_by,
                        scanned_at: s.stepLatest['Printing']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Printing']?.status === 'FAIL').map(s => ({
                        serial_number: s.serial_number,
                        status: 'FAIL',
                        scanned_by: s.stepLatest['Printing']?.scanned_by,
                        scanned_at: s.stepLatest['Printing']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['Printing']?.rework_reason || 'Defect Registered'
                    }));
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Printing']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['Printing']?.status || 'PENDING',
                        scanned_by: s.stepLatest['Printing']?.scanned_by,
                        scanned_at: s.stepLatest['Printing']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['Printing']?.rework_reason
                    }));
                }
                break;
            }

            case 'spi': {
                if (normType === 'passed' || normType === 'scanned') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SPI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['SPI']?.scanned_by,
                        scanned_at: s.stepLatest['SPI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SPI']?.status === 'FAIL').map(s => ({
                        serial_number: s.serial_number,
                        status: 'FAIL',
                        scanned_by: s.stepLatest['SPI']?.scanned_by,
                        scanned_at: s.stepLatest['SPI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['SPI']?.rework_reason || 'Defect Registered'
                    }));
                } else if (normType === 'printing_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Printing']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['Printing']?.scanned_by,
                        scanned_at: s.stepLatest['Printing']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SPI']?.status !== 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => ({
                        serial_number: s.serial_number,
                        status: s.stepLatest['SPI']?.status || 'PENDING',
                        scanned_by: s.stepLatest['SPI']?.scanned_by,
                        scanned_at: s.stepLatest['SPI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: s.stepLatest['SPI']?.rework_reason
                    }));
                }
                break;
            }

            case 'pre aoi':
            case 'pre_aoi': {
                const isPreAoiPass = (s: any) => s.stepLatest['Pre AOI']?.status === 'PASS' || s.stepLatest['Pre_AOI']?.status === 'PASS';
                const isPreAoiFail = (s: any) => s.stepLatest['Pre AOI']?.status === 'FAIL' || s.stepLatest['Pre_AOI']?.status === 'FAIL';

                if (normType === 'passed') {
                    filtered = mappedSerials.filter(isPreAoiPass).map(s => {
                        const prePass = s.stepLatest['Pre AOI'] || s.stepLatest['Pre_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: 'PASS',
                            scanned_by: prePass?.scanned_by,
                            scanned_at: prePass?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: null
                        };
                    });
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(isPreAoiFail).map(s => {
                        const preFail = s.stepLatest['Pre AOI'] || s.stepLatest['Pre_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: 'FAIL',
                            scanned_by: preFail?.scanned_by,
                            scanned_at: preFail?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: preFail?.rework_reason || 'Defect Registered'
                        };
                    });
                } else if (normType === 'spi_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['SPI']?.status === 'PASS').map(s => ({
                        serial_number: s.serial_number,
                        status: 'PASS',
                        scanned_by: s.stepLatest['SPI']?.scanned_by,
                        scanned_at: s.stepLatest['SPI']?.scanned_at,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => !isPreAoiPass(s)).map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => {
                        const preInsp = s.stepLatest['Pre AOI'] || s.stepLatest['Pre_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: preInsp?.status || 'PENDING',
                            scanned_by: preInsp?.scanned_by,
                            scanned_at: preInsp?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: preInsp?.rework_reason
                        };
                    });
                }
                break;
            }

            case 'post aoi':
            case 'post_aoi': {
                const isPostAoiPass = (s: any) => s.stepLatest['Post AOI']?.status === 'PASS' || s.stepLatest['Post_AOI']?.status === 'PASS';
                const isPostAoiFail = (s: any) => s.stepLatest['Post AOI']?.status === 'FAIL' || s.stepLatest['Post_AOI']?.status === 'FAIL';

                if (normType === 'passed') {
                    filtered = mappedSerials.filter(isPostAoiPass).map(s => {
                        const postPass = s.stepLatest['Post AOI'] || s.stepLatest['Post_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: 'PASS',
                            scanned_by: postPass?.scanned_by,
                            scanned_at: postPass?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: null
                        };
                    });
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(isPostAoiFail).map(s => {
                        const postFail = s.stepLatest['Post AOI'] || s.stepLatest['Post_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: 'FAIL',
                            scanned_by: postFail?.scanned_by,
                            scanned_at: postFail?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: postFail?.rework_reason || 'Defect Registered'
                        };
                    });
                } else if (normType === 'pre_aoi_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Pre AOI']?.status === 'PASS' || s.stepLatest['Pre_AOI']?.status === 'PASS').map(s => {
                        const prePass = s.stepLatest['Pre AOI'] || s.stepLatest['Pre_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: 'PASS',
                            scanned_by: prePass?.scanned_by,
                            scanned_at: prePass?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: null
                        };
                    });
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => !isPostAoiPass(s)).map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => {
                        const postInsp = s.stepLatest['Post AOI'] || s.stepLatest['Post_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: postInsp?.status || 'PENDING',
                            scanned_by: postInsp?.scanned_by,
                            scanned_at: postInsp?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: postInsp?.rework_reason
                        };
                    });
                }
                break;
            }

            case 'rework': {
                const processedReworks = mappedSerials.map((s: any) => {
                    const sorted = [...s.history].sort((a: any, b: any) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime());
                    let latestFailure: any = null;
                    for (let i = sorted.length - 1; i >= 0; i--) {
                        if (sorted[i].process_step === 'Post AOI' && sorted[i].status === 'FAIL') {
                            latestFailure = sorted[i];
                            break;
                        }
                    }
                    if (!latestFailure) return null;

                    let latestRepair: any = null;
                    for (let i = sorted.length - 1; i >= 0; i--) {
                        if (sorted[i].process_step === 'Rework' && sorted[i].status === 'PASS' && new Date(sorted[i].scanned_at).getTime() > new Date(latestFailure.scanned_at).getTime()) {
                            latestRepair = sorted[i];
                            break;
                        }
                    }

                    let latestRevalidation: any = null;
                    if (latestRepair) {
                        for (let i = sorted.length - 1; i >= 0; i--) {
                            if (sorted[i].process_step === 'Post AOI' && new Date(sorted[i].scanned_at).getTime() > new Date(latestRepair.scanned_at).getTime()) {
                                latestRevalidation = sorted[i];
                                break;
                            }
                        }
                    }

                    let currentStatus = 'FAILED';
                    if (latestRevalidation) {
                        currentStatus = latestRevalidation.status === 'PASS' ? 'REVALIDATED_PASS' : 'FAILED_AGAIN';
                    } else if (latestRepair) {
                        currentStatus = 'READY_FOR_RECHECK';
                    }

                    return {
                        serial_number: s.serial_number,
                        status: currentStatus,
                        failure_remark: latestFailure.rework_reason || 'Defect Registered',
                        failed_time: latestFailure.scanned_at,
                        failed_by: latestFailure.scanned_by,
                        repair_remark: latestRepair ? latestRepair.rework_reason : null,
                        repair_time: latestRepair ? latestRepair.scanned_at : null,
                        repaired_by: latestRepair ? latestRepair.scanned_by : null,
                        previous_stage: 'Post AOI'
                    };
                }).filter((item: any) => item !== null);

                if (normType === 'pending') {
                    filtered = processedReworks.filter((s: any) => s.status === 'FAILED' || s.status === 'FAILED_AGAIN').map((s: any) => ({
                        serial_number: s.serial_number,
                        status: s.status === 'FAILED_AGAIN' ? 'FAILED AGAIN' : 'PENDING REPAIR',
                        scanned_by: s.failed_by,
                        scanned_at: s.failed_time,
                        previous_stage: s.previous_stage,
                        rework_reason: s.failure_remark
                    }));
                } else if (normType === 'failed') {
                    filtered = processedReworks.filter((s: any) => s.status === 'FAILED' || s.status === 'FAILED_AGAIN').map((s: any) => ({
                        serial_number: s.serial_number,
                        status: 'FAIL',
                        scanned_by: s.failed_by,
                        scanned_at: s.failed_time,
                        previous_stage: s.previous_stage,
                        rework_reason: s.failure_remark
                    }));
                } else if (normType === 'passed' || normType === 'repaired') {
                    filtered = processedReworks.filter((s: any) => s.status === 'READY_FOR_RECHECK' || s.status === 'REVALIDATED_PASS').map((s: any) => ({
                        serial_number: s.serial_number,
                        status: s.status === 'REVALIDATED_PASS' ? 'PASSED RECHECK' : 'READY FOR RECHECK',
                        scanned_by: s.repaired_by,
                        scanned_at: s.repair_time,
                        previous_stage: s.previous_stage,
                        rework_reason: s.repair_remark
                    }));
                } else {
                    filtered = processedReworks.map((s: any) => ({
                        serial_number: s.serial_number,
                        status: s.status,
                        scanned_by: s.failed_by,
                        scanned_at: s.failed_time,
                        previous_stage: s.previous_stage,
                        rework_reason: s.failure_remark
                    }));
                }
                break;
            }

            case 'smt fg':
            case 'smt_fg': {
                const isFgPass = (s: any) => s.stepLatest['SMT FG']?.status === 'PASS' || s.stepLatest['SMT_FG']?.status === 'PASS';
                const isFgFail = (s: any) => s.stepLatest['SMT FG']?.status === 'FAIL' || s.stepLatest['SMT_FG']?.status === 'FAIL';

                if (normType === 'passed' || normType === 'scanned') {
                    filtered = mappedSerials.filter(isFgPass).map(s => {
                        const fgPass = s.stepLatest['SMT FG'] || s.stepLatest['SMT_FG'];
                        return {
                            serial_number: s.serial_number,
                            status: 'PASS',
                            scanned_by: fgPass?.scanned_by,
                            scanned_at: fgPass?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: null
                        };
                    });
                } else if (normType === 'failed') {
                    filtered = mappedSerials.filter(isFgFail).map(s => {
                        const fgFail = s.stepLatest['SMT FG'] || s.stepLatest['SMT_FG'];
                        return {
                            serial_number: s.serial_number,
                            status: 'FAIL',
                            scanned_by: fgFail?.scanned_by,
                            scanned_at: fgFail?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: fgFail?.rework_reason || 'Defect Registered'
                        };
                    });
                } else if (normType === 'post_aoi_passed' || normType === 'previous_passed') {
                    filtered = mappedSerials.filter(s => s.stepLatest['Post AOI']?.status === 'PASS' || s.stepLatest['Post_AOI']?.status === 'PASS').map(s => {
                        const postPass = s.stepLatest['Post AOI'] || s.stepLatest['Post_AOI'];
                        return {
                            serial_number: s.serial_number,
                            status: 'PASS',
                            scanned_by: postPass?.scanned_by,
                            scanned_at: postPass?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: null
                        };
                    });
                } else if (normType === 'pending') {
                    filtered = mappedSerials.filter(s => !isFgPass(s)).map(s => ({
                        serial_number: s.serial_number,
                        status: 'PENDING',
                        scanned_by: null,
                        scanned_at: null,
                        previous_stage: getSMTPreviousStage(s, stageStr),
                        rework_reason: null
                    }));
                } else {
                    filtered = mappedSerials.map(s => {
                        const fgInsp = s.stepLatest['SMT FG'] || s.stepLatest['SMT_FG'];
                        return {
                            serial_number: s.serial_number,
                            status: fgInsp?.status || 'PENDING',
                            scanned_by: fgInsp?.scanned_by,
                            scanned_at: fgInsp?.scanned_at,
                            previous_stage: getSMTPreviousStage(s, stageStr),
                            rework_reason: fgInsp?.rework_reason
                        };
                    });
                }
                break;
            }

            default:
                filtered = mappedSerials.map(s => ({
                    serial_number: s.serial_number,
                    status: s.main_status || 'PENDING',
                    scanned_by: s.created_by,
                    scanned_at: s.created_at,
                    previous_stage: getSMTPreviousStage(s, stageStr),
                    rework_reason: null
                }));
                break;
        }

        if (searchStr) {
            filtered = filtered.filter(item => (item.serial_number || '').toUpperCase().includes(searchStr));
        }

        const total = filtered.length;
        const startIndex = (pageNum - 1) * limitNum;
        const paginated = filtered.slice(startIndex, startIndex + limitNum);

        return res.status(200).json({
            total,
            page: pageNum,
            limit: limitNum,
            data: paginated
        });

    } catch (err: any) {
        logger.error('❌ Error in getCountDetails:', err);
        return res.status(500).json({ error: 'Failed to retrieve count details: ' + err.message });
    }
};

export const downloadWorkOrderExcel = async (req: Request, res: Response) => {
    const { woId } = req.params;

    if (!woId || woId.trim() === '') {
        return res.status(400).json({ error: 'Work Order ID is required.' });
    }

    const inputValue = woId.trim().toUpperCase();

    try {
        // 1. Fetch Work Order Details
        const woResult = await pool.query(
            `SELECT * FROM smt_work_orders WHERE id = $1 OR po_id = $1 LIMIT 1`,
            [inputValue]
        );

        if ((woResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `Work Order "${inputValue}" was not found in the system.`, code: 'WORK_ORDER_NOT_FOUND' });
        }

        const wo = woResult.rows[0];
        const isDoubleSided = isTopBottomWo(wo.sides);
        const isBottomOnly = isBottomOnlyWo(wo.sides);

        // 2. Fetch all serials and aggregate their history using optimized SQL
        const serialsResult = await pool.query(`
            WITH inspection_with_side AS (
                SELECT 
                    i.id,
                    i.serial_id,
                    i.process_step,
                    i.status,
                    i.scanned_at,
                    UPPER(TRIM(COALESCE(ps.side, spis.side, pas.side, poas.side, rs.side, fgs.side))) AS side
                FROM smt_inspections i
                LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
                LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
                LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
                LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
                LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
                LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
                WHERE i.serial_id IN (SELECT id FROM smt_serial_numbers WHERE work_order_id = $1)
            ),
            latest_overall AS (
                SELECT DISTINCT ON (serial_id) serial_id, process_step as current_stage, status as current_status
                FROM inspection_with_side
                ORDER BY serial_id, scanned_at DESC, id DESC
            ),
            latest_side_steps AS (
                SELECT DISTINCT ON (serial_id, process_step, side)
                    serial_id, process_step, COALESCE(side, 'NONE') as side, status
                FROM inspection_with_side
                ORDER BY serial_id, process_step, side, scanned_at DESC, id DESC
            ),
            agg_steps AS (
                SELECT serial_id,
                       jsonb_object_agg(process_step, status) FILTER (WHERE side = 'TOP') as step_statuses_top,
                       jsonb_object_agg(process_step, status) FILTER (WHERE side = 'BOTTOM') as step_statuses_bottom,
                       jsonb_object_agg(process_step, status) as step_statuses,
                       MAX(status) FILTER (WHERE side = 'TOP' AND process_step = 'SMT FG') as top_smt_fg_status,
                       MAX(status) FILTER (WHERE side = 'BOTTOM' AND process_step = 'SMT FG') as bot_smt_fg_status,
                       MAX(status) FILTER (WHERE process_step = 'SMT FG') as overall_smt_fg_status,
                       MAX(status) FILTER (WHERE side = 'TOP' AND (process_step = 'Post AOI' OR process_step = 'Post_AOI')) as top_post_aoi_status,
                       MAX(status) FILTER (WHERE side = 'BOTTOM' AND (process_step = 'Post AOI' OR process_step = 'Post_AOI')) as bot_post_aoi_status,
                       MAX(status) FILTER (WHERE process_step = 'Post AOI' OR process_step = 'Post_AOI') as overall_post_aoi_status,
                       BOOL_OR(status IN ('FAIL', 'REWORK')) as has_active_failure
                FROM latest_side_steps
                GROUP BY serial_id
            ),
            stats AS (
                SELECT serial_id,
                       count(case when status IN ('REWORK', 'FAIL') then 1 end) as total_failures,
                       count(case when process_step = 'Rework' then 1 end) as total_reworks,
                       count(case when process_step = 'Debug' then 1 end) as total_debugs,
                       count(case when status = 'PASS' then 1 end) as total_passed
                FROM inspection_with_side
                GROUP BY serial_id
            )
            SELECT sn.id, sn.serial_number, sn.serial_format, sn.created_at,
                   COALESCE(lo.current_stage, 'Pending') as current_stage,
                   COALESCE(lo.current_status, 'PENDING') as current_status,
                   COALESCE(st.total_failures, 0) as total_failures,
                   COALESCE(st.total_reworks, 0) as total_reworks,
                   COALESCE(st.total_debugs, 0) as total_debugs,
                   COALESCE(st.total_passed, 0) as total_passed,
                   COALESCE(ast.step_statuses, '{}'::jsonb) as step_statuses,
                   COALESCE(ast.step_statuses_top, '{}'::jsonb) as step_statuses_top,
                   COALESCE(ast.step_statuses_bottom, '{}'::jsonb) as step_statuses_bottom,
                   CASE
                       WHEN COALESCE(ast.has_active_failure, false) = true THEN false
                       WHEN $2::boolean = true THEN
                           (COALESCE(ast.overall_smt_fg_status, '') = 'PASS')
                           OR (COALESCE(ast.top_smt_fg_status, '') = 'PASS' AND COALESCE(ast.bot_smt_fg_status, '') = 'PASS')
                           OR (COALESCE(ast.top_post_aoi_status, '') = 'PASS' AND COALESCE(ast.bot_post_aoi_status, '') = 'PASS')
                           OR (COALESCE(ast.top_smt_fg_status, '') = 'PASS' AND COALESCE(ast.bot_post_aoi_status, '') = 'PASS')
                           OR (COALESCE(ast.bot_smt_fg_status, '') = 'PASS' AND COALESCE(ast.top_post_aoi_status, '') = 'PASS')
                       WHEN $3::boolean = true THEN
                           (COALESCE(ast.bot_smt_fg_status, '') = 'PASS' OR COALESCE(ast.overall_smt_fg_status, '') = 'PASS' OR COALESCE(ast.bot_post_aoi_status, '') = 'PASS' OR COALESCE(ast.overall_post_aoi_status, '') = 'PASS')
                       ELSE
                           (COALESCE(ast.top_smt_fg_status, '') = 'PASS' OR COALESCE(ast.overall_smt_fg_status, '') = 'PASS' OR COALESCE(ast.top_post_aoi_status, '') = 'PASS' OR COALESCE(ast.overall_post_aoi_status, '') = 'PASS')
                   END as is_completed
            FROM smt_serial_numbers sn
            LEFT JOIN latest_overall lo ON sn.id = lo.serial_id
            LEFT JOIN stats st ON sn.id = st.serial_id
            LEFT JOIN agg_steps ast ON sn.id = ast.serial_id
            WHERE sn.work_order_id = $1
            ORDER BY sn.id ASC
        `, [wo.id, isDoubleSided, isBottomOnly]);

        const serials = serialsResult.rows;

        // Pre-resolve SMT statuses for all serials
        const smtResolutions: Record<string, SmtStatusResolution> = {};
        serials.forEach((s: any) => {
            smtResolutions[s.serial_number] = resolveSerialSmtStatuses(
                wo.sides,
                s.step_statuses_top,
                s.step_statuses_bottom,
                s.step_statuses,
                false,
                Boolean(s.is_completed),
                wo.has_smt !== false
            );
        });

        // Resolve Backend stages & traceability for all serials authoritatively
        const { activeBackendStages, serialResolutions } = await resolveSerialsBackendTraceability(
            serials,
            wo,
            smtResolutions
        );

        const smtStepNames = ['Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];

        const mappedSerials = serials.map((s: any) => {
            const smtRes = smtResolutions[s.serial_number];
            const bRes = serialResolutions[s.serial_number];

            const finalStepStatus: Record<string, string> = {
                ...(smtRes?.step_status || {})
            };

            if (bRes?.backend_step_status) {
                Object.assign(finalStepStatus, bRes.backend_step_status);
            }

            return {
                serial_number: s.serial_number,
                current_stage: bRes?.current_stage || s.current_stage || 'Pending',
                current_status: bRes?.current_status || normalizeStatus(s.current_status || 'PENDING'),
                final_status_label: bRes?.final_status_label || (smtRes?.is_completed ? 'Completed' : 'Pending'),
                total_failures: Number(s.total_failures) || 0,
                total_reworks: Number(s.total_reworks) || 0,
                total_debugs: Number(s.total_debugs) || 0,
                total_passed: Number(s.total_passed) || 0,
                step_status: finalStepStatus,
                step_status_top: smtRes?.step_status_top || {},
                step_status_bottom: smtRes?.step_status_bottom || {},
                created_at: s.created_at
            };
        });

        // 4. Generate Excel Workbook using ExcelJS
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('SMT WO Report');

        // Common Styles
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

        // Write Metadata Info Cards
        const metadata = [
            { label: 'Work Order ID:', val: wo.id || wo.work_order_id },
            { label: 'Product Name:', val: wo.product_name || '-' },
            { label: 'Total Quantity:', val: `${serials.length} / ${wo.quantity || '-'}` },
            { label: 'Line ID:', val: wo.line_id || '-' },
            { label: 'Report Generated:', val: new Date().toLocaleString() }
        ];

        metadata.forEach((item, index) => {
            const rowNumber = index + 1;
            worksheet.getCell(`A${rowNumber}`).value = item.label;
            worksheet.getCell(`A${rowNumber}`).style = labelStyle;
            worksheet.getCell(`B${rowNumber}`).value = item.val;
            worksheet.getCell(`B${rowNumber}`).style = valueStyle;
        });

        worksheet.addRow([]); // Blank spacer row

        const smtTableHeaders = smtStepNames.map(s => s.toUpperCase());

        const tableHeaders = [
            'SERIAL NUMBER',
            'CURRENT STAGE',
            'OVERALL STATUS',
            ...smtTableHeaders,
            ...activeBackendStages.map((st: any) => (st.stage_label || st.stage_name).toUpperCase()),
            'TOTAL FAILURES',
            'TOTAL REWORKS'
        ];

        const headerRow = worksheet.addRow(tableHeaders);
        headerRow.height = 26;

        const headerFill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1E3A8A' } // SMT Navy Blue
        };

        headerRow.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = headerFill;
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        // Add Data Rows
        mappedSerials.forEach((s: any) => {
            const hasSmt = wo.has_smt !== false;
            let smtRowValues: string[] = [];
            if (!hasSmt) {
                smtRowValues = smtStepNames.map(() => 'N/A');
            } else {
                smtRowValues = smtStepNames.map(step => {
                    const isSmtFg = step === 'SMT FG';
                    const isRework = step === 'Rework';
                    let top = s.step_status_top?.[step] || (isRework ? 'N/A' : 'PENDING');
                    let bot = isSmtFg ? 'N/A' : (s.step_status_bottom?.[step] || (isRework ? 'N/A' : 'PENDING'));

                    if (isDoubleSided) {
                        if (isRework && (top === 'N/A' || top === '-') && (bot === 'N/A' || bot === '-')) return 'N/A';
                        if (isSmtFg) return `TOP: ${top}, BOTTOM: N/A`;
                        return `TOP: ${top}, BOTTOM: ${bot}`;
                    } else if (isBottomOnly) {
                        if (isRework && (bot === 'N/A' || bot === '-')) return 'N/A';
                        return `BOTTOM: ${bot}`;
                    } else {
                        if (isRework && (top === 'N/A' || top === '-')) return 'N/A';
                        return `TOP: ${top}`;
                    }
                });
            }

            const rowData = [
                s.serial_number,
                s.current_stage || 'Pending',
                s.final_status_label || 'Pending',
                ...smtRowValues,
                ...activeBackendStages.map((st: any) => s.step_status[st.stage_code] || s.step_status[st.stage_name] || s.step_status[st.stage_label] || 'N/A'),
                s.total_failures || 0,
                s.total_reworks || 0
            ];
            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 20;

            const isCompleted = s.final_status_label === 'Completed';

            dataRow.eachCell((cell: any, colNumber: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;

                // Center align stages & stats
                if (colNumber > 1) {
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                } else {
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                }

                // Overall status cell color
                if (colNumber === 3) {
                    if (isCompleted) {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else {
                        cell.font = { color: { argb: 'FFFF8C00' }, bold: true, name: 'Segoe UI', size: 10 }; // Dark Orange
                    }
                }

                // Process Stage Statuses
                if (colNumber >= 4 && colNumber <= (3 + smtTableHeaders.length + activeBackendStages.length)) {
                    const statusText = cell.value?.toString().toUpperCase() || '';
                    if (statusText === 'N/A' || statusText === '-') {
                        cell.font = { color: { argb: 'FF94A3B8' }, name: 'Segoe UI', size: 10 };
                    } else if (statusText.includes('FAIL') || statusText.includes('REWORK')) {
                        cell.font = { color: { argb: 'FFFF0000' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (statusText.includes('PENDING')) {
                        cell.font = { color: { argb: 'FFD97706' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (statusText.includes('PASS')) {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    }
                }
            });
        });

        // Set column widths
        worksheet.columns.forEach((column: any) => {
            let maxLen = 0;
            column.eachCell!({ includeEmpty: true }, (cell: any) => {
                if (cell.row && (cell.row as any).number <= 6) return; // Skip metadata
                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
            column.width = maxLen < 15 ? 15 : maxLen + 5;
        });

        worksheet.getColumn(1).width = 25;
        worksheet.getColumn(2).width = 20;
        worksheet.getColumn(3).width = 20;

        // Freeze top 7 rows
        worksheet.views = [{ state: 'frozen', ySplit: 7 }];

        const safeWoId = inputValue.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `SMT_WorkOrder_Report_${safeWoId}_${nowStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error('❌ Error in downloadWorkOrderExcel:', err);
        return res.status(500).json({ error: 'Failed to download Work Order Excel report: ' + err.message });
    }
};

export const downloadSerialNumberExcel = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id || id.trim() === '') {
        return res.status(400).json({ error: 'Serial Number is required.' });
    }

    const inputValue = id.trim().toUpperCase();

    try {
        // 1. Fetch Serial Details
        let serialResult = await pool.query(
            `SELECT sn.*, wo.product_name, wo.quantity, wo.line_id, wo.sides, wo.has_smt, wo.has_backend, wo.selected_stages, wo.customer_name, wo.model_name
             FROM smt_serial_numbers sn
             LEFT JOIN smt_work_orders wo ON sn.work_order_id = wo.id
             WHERE UPPER(TRIM(sn.serial_number)) = $1`,
            [inputValue]
        );

        if ((serialResult.rowCount ?? 0) === 0) {
            try {
                const mapCheck = await backendPool.query(
                    `SELECT barcode, unit_serial_number FROM unit_serial_mapping 
                     WHERE UPPER(TRIM(unit_serial_number)) = $1 OR UPPER(TRIM(barcode)) = $1
                     LIMIT 1`,
                    [inputValue]
                );
                if (mapCheck.rowCount && mapCheck.rowCount > 0) {
                    const mappedSn = mapCheck.rows[0].unit_serial_number || mapCheck.rows[0].barcode;
                    serialResult = await pool.query(
                        `SELECT sn.*, wo.product_name, wo.quantity, wo.line_id, wo.sides, wo.has_smt, wo.has_backend, wo.selected_stages, wo.customer_name, wo.model_name
                         FROM smt_serial_numbers sn
                         LEFT JOIN smt_work_orders wo ON sn.work_order_id = wo.id
                         WHERE UPPER(TRIM(sn.serial_number)) = $1 OR UPPER(TRIM(sn.serial_number)) = $2`,
                        [mappedSn.toUpperCase(), (mapCheck.rows[0].barcode || '').toUpperCase()]
                    );
                }
            } catch (mErr: any) {
                logger.warn('Backend mapping check warning:', mErr.message);
            }
        }

        if ((serialResult.rowCount ?? 0) === 0) {
            return res.status(404).json({ error: `Serial Number "${inputValue}" was not found.` });
        }

        const serial = serialResult.rows[0];

        // 2. Fetch SMT Inspection History with Side
        const historyResult = await pool.query(
            `SELECT i.id, i.process_step, i.scanned_by, i.scanned_at, i.status, i.rework_reason,
                    COALESCE(ps.side, spis.side, pas.side, poas.side, rs.side, fgs.side) AS side
             FROM smt_inspections i
             LEFT JOIN smt_printing_sessions ps ON i.printing_session_id = ps.id
             LEFT JOIN smt_spi_sessions spis ON i.spi_session_id = spis.id
             LEFT JOIN smt_pre_aoi_sessions pas ON i.pre_aoi_session_id = pas.id
             LEFT JOIN smt_post_aoi_sessions poas ON i.post_aoi_session_id = poas.id
             LEFT JOIN smt_rework_sessions rs ON i.rework_session_id = rs.id
             LEFT JOIN smt_fg_sessions fgs ON i.fg_session_id = fgs.id
             WHERE i.serial_id = $1
             ORDER BY i.scanned_at ASC, i.id ASC`,
            [serial.id]
        );

        const topStatuses: Record<string, string> = {};
        const bottomStatuses: Record<string, string> = {};
        const overallStatuses: Record<string, string> = {};

        const history = historyResult.rows.map((row: any) => {
            const step = row.process_step || '-';
            const st = normalizeStatus(row.status || '');
            const side = (row.side || '').toUpperCase();
            if (side === 'TOP') {
                topStatuses[step] = st;
            } else if (side === 'BOTTOM') {
                bottomStatuses[step] = st;
            } else {
                overallStatuses[step] = st;
            }
            return {
                id: row.id,
                source: 'SMT',
                process_step: step,
                side: row.side || null,
                status: st,
                scanned_by: row.scanned_by || '-',
                scanned_at: row.scanned_at,
                remark: row.rework_reason || null
            };
        });

        const smtResolved = resolveSerialSmtStatuses(
            serial.sides,
            topStatuses,
            bottomStatuses,
            overallStatuses,
            false,
            undefined,
            serial.has_smt !== false
        );

        // 3. Resolve Backend Unit Identifiers & Scans
        let unitSerialNumber: string | null = null;
        const candidateBarcodes = new Set<string>([serial.serial_number.toUpperCase()]);
        try {
            const mapRes = await backendPool.query(
                `SELECT barcode, unit_serial_number FROM unit_serial_mapping 
                 WHERE UPPER(TRIM(unit_serial_number)) = $1 OR UPPER(TRIM(barcode)) = $1`,
                [serial.serial_number.toUpperCase()]
            );
            mapRes.rows.forEach((r: any) => {
                if (r.barcode) candidateBarcodes.add(r.barcode.toUpperCase());
                if (r.unit_serial_number) {
                    candidateBarcodes.add(r.unit_serial_number.toUpperCase());
                    if (!unitSerialNumber) unitSerialNumber = r.unit_serial_number;
                }
            });

            const unitsRes = await backendPool.query(
                `SELECT barcode FROM units WHERE UPPER(TRIM(barcode)) = $1 LIMIT 1`,
                [serial.serial_number.toUpperCase()]
            );
            unitsRes.rows.forEach((r: any) => {
                if (r.barcode) candidateBarcodes.add(r.barcode.toUpperCase());
            });
        } catch (mErr: any) {
            logger.warn('Backend candidate barcode lookup warning:', mErr.message);
        }

        let backendScanHistory: any[] = [];
        let backendStagesList: any[] = [];
        let backendUnitRecord: any = null;

        if (serial.has_backend) {
            try {
                const uRes = await backendPool.query(
                    `SELECT u.barcode, u.current_stage_id, ps.stage_name AS current_stage_name, ps.stage_code AS current_stage_code, u.current_status 
                     FROM units u 
                     LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                     WHERE UPPER(TRIM(u.barcode)) = ANY($1) 
                     ORDER BY u.updated_at DESC LIMIT 1`,
                    [Array.from(candidateBarcodes)]
                );
                if (uRes.rows.length > 0) {
                    backendUnitRecord = uRes.rows[0];
                }

                const bStagesRes = await backendPool.query(
                    `SELECT id, stage_code, stage_name, stage_order 
                     FROM production_stages 
                     WHERE is_active = TRUE AND workflow_type = 'STANDARD' 
                     ORDER BY stage_order ASC`
                );
                backendStagesList = bStagesRes.rows.map((st: any) => ({
                    ...st,
                    stage_label: st.stage_code === 'PTH' ? 'PTH' : (st.stage_code === 'PCBA_FCT' ? 'PCBA-FCT' : st.stage_name)
                }));

                const bScansRes = await backendPool.query(
                    `SELECT s.id, ps.stage_code, ps.stage_name AS station, ps.stage_order, s.scan_result AS status, s.scanned_by, s.scanned_at, s.remarks
                     FROM scans s
                     JOIN production_stages ps ON s.stage_id = ps.id
                     WHERE UPPER(TRIM(s.barcode)) = ANY($1)
                     ORDER BY s.scanned_at ASC, s.id ASC`,
                    [Array.from(candidateBarcodes)]
                );
                backendScanHistory = bScansRes.rows.map((row: any) => ({
                    id: row.id,
                    source: 'Backend',
                    stage_code: row.stage_code || null,
                    process_step: row.station || row.stage_name || row.stage_code || '-',
                    side: null,
                    status: normalizeStatus(row.status),
                    scanned_by: row.scanned_by || '-',
                    scanned_at: row.scanned_at,
                    remark: row.remarks || null
                }));
            } catch (bErr: any) {
                logger.warn('Failed to fetch backend scans for serial excel:', bErr.message);
            }
        }

        if (backendStagesList.length === 0) {
            backendStagesList = [
                { stage_code: 'PTH', stage_name: 'Pre-Soldering', stage_label: 'PTH' },
                { stage_code: 'VI', stage_name: 'Visual Inspection', stage_label: 'VI' },
                { stage_code: 'QA', stage_name: 'Quality Assurance', stage_label: 'QA' },
                { stage_code: 'FLASHING', stage_name: 'Flashing', stage_label: 'Flashing' },
                { stage_code: 'PCBA_FCT', stage_name: 'PCBA FCT', stage_label: 'PCBA-FCT' },
                { stage_code: 'ASSEMBLY', stage_name: 'Assembly', stage_label: 'Assembly' },
                { stage_code: 'UNIT_TESTING', stage_name: 'Unit Testing', stage_label: 'Unit Testing' },
                { stage_code: 'QI', stage_name: 'Quality Inspection', stage_label: 'QI' },
                { stage_code: 'PACKING', stage_name: 'Packing', stage_label: 'Packing' }
            ];
        }

        const activeBackendStages = backendStagesList.filter(st => isBackendStageSelected(st, serial.selected_stages));

        const backendStepStatus: Record<string, string> = {};
        backendStagesList.forEach((stage: any) => {
            const isSelected = isBackendStageSelected(stage, serial.selected_stages);
            let statusVal = 'PENDING';
            if (!isSelected) {
                statusVal = 'N/A';
            } else {
                const stageScans = backendScanHistory.filter((h: any) => {
                    const sc = normalizeStageId(h.stage_code || '');
                    const st = normalizeStageId(h.process_step || '');
                    const cn = normalizeStageId(stage.stage_code);
                    const nn = normalizeStageId(stage.stage_name);
                    const ln = normalizeStageId(stage.stage_label || '');
                    return sc === cn || st === cn || st === nn || (ln && st === ln) ||
                        (cn === 'PTH' && (sc === 'PRESOLDERING' || st === 'PRESOLDERING')) ||
                        (cn === 'QA' && (sc === 'QUALITYASSURANCE' || st === 'QUALITYASSURANCE')) ||
                        (cn === 'VI' && (sc === 'VISUALINSPECTION' || st === 'VISUALINSPECTION')) ||
                        (cn === 'QI' && (sc === 'QUALITYINSPECTION' || st === 'QUALITYINSPECTION')) ||
                        (cn === 'PCBA_FCT' && (sc === 'PCBAFCT' || st === 'PCBAFCT')) ||
                        (cn === 'UNIT_TESTING' && (sc === 'UNITTESTING' || st === 'UNITTESTING'));
                });
                if (stageScans.length > 0) {
                    const latest = stageScans[stageScans.length - 1];
                    const rawSt = latest.status;
                    statusVal = (rawSt === 'PASS' || rawSt === 'ACCEPTED') ? 'PASS' : (rawSt === 'FAIL' || rawSt === 'FAILED') ? 'FAIL' : rawSt;
                } else {
                    statusVal = 'PENDING';
                }
            }
            backendStepStatus[stage.stage_code] = statusVal;
            if (stage.stage_name) backendStepStatus[stage.stage_name] = statusVal;
            if (stage.stage_label) backendStepStatus[stage.stage_label] = statusVal;
            if (stage.stage_code === 'PTH') {
                backendStepStatus['Pre-Soldering'] = statusVal;
                backendStepStatus['PTH'] = statusVal;
            }
            if (stage.stage_code === 'PCBA_FCT') {
                backendStepStatus['PCBA FCT'] = statusVal;
                backendStepStatus['PCBA-FCT'] = statusVal;
                backendStepStatus['PCBA_FCT'] = statusVal;
            }
        });

        // Combined History in Chronological Order
        const combinedHistory = [...history, ...backendScanHistory].sort(
            (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
        );

        // Authoritative Current Stage & Status
        let currentStage = 'Pending';
        let currentStatus = 'PENDING';

        if (backendScanHistory.length > 0) {
            const lastBScan = backendScanHistory[backendScanHistory.length - 1];
            const lastBStation = lastBScan.process_step;
            if (lastBScan.status === 'REWORK' || lastBScan.status === 'FAIL') {
                currentStage = lastBStation;
                currentStatus = lastBScan.status;
            } else if (lastBStation.toUpperCase() === 'PACKING' && (lastBScan.status === 'PASS' || lastBScan.status === 'ACCEPTED')) {
                currentStage = 'Packing';
                currentStatus = 'PASS';
            } else if (backendUnitRecord?.current_status === 'COMPLETED') {
                currentStage = 'Packing';
                currentStatus = 'PASS';
            } else if (backendUnitRecord?.current_stage_name) {
                currentStage = backendUnitRecord.current_stage_name;
                currentStatus = backendUnitRecord.current_status || lastBScan.status;
            } else {
                currentStage = lastBStation;
                currentStatus = lastBScan.status;
            }
        } else if (combinedHistory.length > 0) {
            const lastRecord = combinedHistory[combinedHistory.length - 1];
            currentStage = lastRecord.process_step;
            currentStatus = lastRecord.status;
        }

        const totalFailures = combinedHistory.filter(h => h.status === 'REWORK' || h.status === 'FAIL').length;
        const totalReworks = combinedHistory.filter(h => h.process_step === 'Rework' || h.status === 'REWORK').length;
        const totalPassed = combinedHistory.filter(h => h.status === 'PASS').length;

        // Authoritative Overall Status
        const anyFail = combinedHistory.some(h => h.status === 'FAIL');
        const anyRework = combinedHistory.some(h => h.status === 'REWORK' || h.process_step === 'Rework');
        let overallStatusLabel = 'PENDING';

        if (anyRework) {
            overallStatusLabel = 'IN REWORK';
        } else if (anyFail) {
            overallStatusLabel = 'FAILED';
        } else if (serial.has_backend) {
            const allActiveBackendPassed = activeBackendStages.length > 0 && activeBackendStages.every((st: any) => backendStepStatus[st.stage_code] === 'PASS');
            if (allActiveBackendPassed && smtResolved.is_completed) {
                overallStatusLabel = 'COMPLETED';
                currentStatus = 'PASS';
            } else {
                overallStatusLabel = 'IN PRODUCTION';
            }
        } else {
            if (smtResolved.is_completed) {
                overallStatusLabel = 'COMPLETED';
                currentStatus = 'PASS';
            } else {
                overallStatusLabel = 'IN PRODUCTION';
            }
        }

        // Build Excel Workbook
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
            { label: 'PCB Barcode / Serial Number:', val: serial.serial_number },
            { label: 'Unit Serial Number:', val: unitSerialNumber || '-' },
            { label: 'Work Order ID:', val: serial.work_order_id },
            { label: 'Product Name:', val: serial.product_name || '-' },
            { label: 'Customer / Model:', val: `${serial.customer_name || ''} ${serial.model_name || ''}`.trim() || '-' },
            { label: 'Line ID:', val: serial.line_id || '-' },
            { label: 'Process Selection:', val: serial.has_smt && serial.has_backend ? 'SMT + Backend' : serial.has_smt ? 'SMT' : 'Backend' },
            { label: 'Sides:', val: serial.sides || '-' },
            { label: 'Current Stage:', val: currentStage },
            { label: 'Overall Status:', val: overallStatusLabel },
            { label: 'Total Stages Passed:', val: totalPassed },
            { label: 'Rework Events:', val: totalReworks },
            { label: 'Total Failures:', val: totalFailures },
            { label: 'Report Generated:', val: new Date().toLocaleString('en-IN') }
        ];

        metadata.forEach((item, index) => {
            const rowNumber = index + 1;
            worksheet.getCell(`A${rowNumber}`).value = item.label;
            worksheet.getCell(`A${rowNumber}`).style = labelStyle;
            worksheet.getCell(`B${rowNumber}`).value = item.val;
            worksheet.getCell(`B${rowNumber}`).style = valueStyle;
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

        const smtStagesList = ['Printing', 'SPI', 'Pre AOI', 'Post AOI', 'Rework', 'SMT FG'];
        smtStagesList.forEach((stage: string) => {
            const isSmtFg = stage === 'SMT FG';
            let topStatus = 'N/A';
            let bottomStatus = 'N/A';
            let overallStatus = 'N/A';

            if (serial.has_smt !== false) {
                topStatus = smtResolved.step_status_top[stage] || (stage === 'Rework' ? 'N/A' : 'PENDING');
                bottomStatus = isSmtFg ? 'N/A' : (smtResolved.step_status_bottom[stage] || (stage === 'Rework' ? 'N/A' : 'PENDING'));
                overallStatus = computeOverallStageStatus(topStatus, bottomStatus);
            }

            const rowData = [stage, topStatus, bottomStatus, overallStatus];
            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 18;

            dataRow.eachCell((cell: any, colIdx: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;
                cell.alignment = { horizontal: colIdx === 1 ? 'left' : 'center', vertical: 'middle' };
                if (colIdx > 1) {
                    const st = cell.value ? cell.value.toString().toUpperCase() : '';
                    if (st === 'PASS' || (st.includes('PASS') && !st.includes('PENDING') && !st.includes('FAIL'))) {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (st === 'FAIL' || st.includes('FAIL') || st === 'REWORK' || st.includes('REWORK')) {
                        cell.font = { color: { argb: 'FFFF0000' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (st === 'PENDING' || st.includes('PENDING')) {
                        cell.font = { color: { argb: 'FFD97706' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (st === 'N/A') {
                        cell.font = { color: { argb: 'FF808080' }, name: 'Segoe UI', size: 10 };
                    }
                }
            });
        });

        worksheet.addRow([]); // Blank spacer

        // ── Section 2: Backend Pipeline Stage Summary (if applicable) ──
        if (serial.has_backend && backendStagesList.length > 0) {
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

            backendStagesList.forEach((stage: any) => {
                const bStatus = backendStepStatus[stage.stage_code] || backendStepStatus[stage.stage_name] || backendStepStatus[stage.stage_label] || 'N/A';
                const rowData = [stage.stage_label || stage.stage_name, bStatus];
                const dataRow = worksheet.addRow(rowData);
                dataRow.height = 18;

                dataRow.eachCell((cell: any, colIdx: number) => {
                    cell.font = { name: 'Segoe UI', size: 10 };
                    cell.border = borderStyle;
                    cell.alignment = { horizontal: colIdx === 1 ? 'left' : 'center', vertical: 'middle' };
                    if (colIdx === 2) {
                        const st = bStatus.toUpperCase();
                        if (st === 'PASS') {
                            cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                        } else if (st === 'FAIL' || st === 'REWORK') {
                            cell.font = { color: { argb: 'FFFF0000' }, bold: true, name: 'Segoe UI', size: 10 };
                        } else if (st === 'PENDING') {
                            cell.font = { color: { argb: 'FFD97706' }, bold: true, name: 'Segoe UI', size: 10 };
                        } else if (st === 'N/A') {
                            cell.font = { color: { argb: 'FF808080' }, name: 'Segoe UI', size: 10 };
                        }
                    }
                });
            });

            worksheet.addRow([]); // Blank spacer
        }

        // ── Section 3: Chronological Audit Scan Logs ──
        const logHeaders = ['#', 'SOURCE', 'PROCESS STEP', 'SIDE', 'STATUS', 'OPERATOR', 'DATE & TIME', 'REMARK'];
        const headerRow = worksheet.addRow(logHeaders);
        headerRow.height = 24;

        headerRow.eachCell((cell: any) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Segoe UI', size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = borderStyle;
        });

        combinedHistory.forEach((row: any, idx: number) => {
            const rowData = [
                idx + 1,
                row.source,
                row.process_step,
                row.side || '-',
                row.status,
                row.scanned_by,
                row.scanned_at ? new Date(row.scanned_at).toLocaleString('en-IN') : '-',
                row.remark || '-'
            ];
            const dataRow = worksheet.addRow(rowData);
            dataRow.height = 20;

            dataRow.eachCell((cell: any, colNumber: number) => {
                cell.font = { name: 'Segoe UI', size: 10 };
                cell.border = borderStyle;
                cell.alignment = { horizontal: colNumber === 1 || colNumber === 2 || colNumber === 4 || colNumber === 5 ? 'center' : 'left', vertical: 'middle' };

                if (colNumber === 2) {
                    cell.font = { bold: true, color: { argb: row.source === 'SMT' ? 'FF2563EB' : 'FF059669' }, name: 'Segoe UI', size: 10 };
                }
                if (colNumber === 5) {
                    const st = row.status.toUpperCase();
                    if (st === 'PASS') {
                        cell.font = { color: { argb: 'FF00B050' }, bold: true, name: 'Segoe UI', size: 10 };
                    } else if (st === 'FAIL' || st === 'REWORK') {
                        cell.font = { color: { argb: 'FFFF0000' }, bold: true, name: 'Segoe UI', size: 10 };
                    }
                }
            });
        });

        worksheet.columns.forEach((column: any) => {
            let maxLen = 0;
            column.eachCell!({ includeEmpty: true }, (cell: any) => {
                if (cell.row && (cell.row as any).number <= 15) return;
                const len = cell.value ? cell.value.toString().length : 0;
                if (len > maxLen) maxLen = len;
            });
            column.width = maxLen < 15 ? 15 : maxLen + 5;
        });

        worksheet.getColumn(1).width = 10;
        worksheet.getColumn(2).width = 16;
        worksheet.getColumn(3).width = 25;
        worksheet.getColumn(4).width = 15;

        const safeSn = inputValue.replace(/[^a-zA-Z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const filename = `SMT_Serial_Traceability_${safeSn}_${nowStr}.xlsx`;

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');

        await workbook.xlsx.write(res);
        res.end();

    } catch (err: any) {
        logger.error('❌ Error in downloadSerialNumberExcel:', err);
        return res.status(500).json({ error: 'Failed to download Serial Number Excel report: ' + err.message });
    }
};


