import { Request, Response } from 'express';
import pool, { backendPool } from '../config/db';
import { createLogger } from '../utils/logger';

const logger = createLogger('PreviousStageController');

interface StageConfig {
    currentStageName: string;
    currentSessionTable: string;
    currentSessionJoinCol: string;
    currentProcessSteps: string[];
    previousStageName: string;
    prevSessionTable: string;
    prevSessionJoinCol: string;
    prevProcessSteps: string[];
}

const STAGE_MAPPING: Record<string, StageConfig | null> = {
    'PRINTING': null,
    'SPI': {
        currentStageName: 'SPI',
        currentSessionTable: 'smt_spi_sessions',
        currentSessionJoinCol: 'spi_session_id',
        currentProcessSteps: ['SPI'],
        previousStageName: 'Printing',
        prevSessionTable: 'smt_printing_sessions',
        prevSessionJoinCol: 'printing_session_id',
        prevProcessSteps: ['Printing', 'SMT Printing']
    },
    'PRE_AOI': {
        currentStageName: 'Pre-AOI',
        currentSessionTable: 'smt_pre_aoi_sessions',
        currentSessionJoinCol: 'pre_aoi_session_id',
        currentProcessSteps: ['Pre AOI', 'Pre_AOI', 'Pre-AOI'],
        previousStageName: 'SPI',
        prevSessionTable: 'smt_spi_sessions',
        prevSessionJoinCol: 'spi_session_id',
        prevProcessSteps: ['SPI']
    },
    'PRE-AOI': {
        currentStageName: 'Pre-AOI',
        currentSessionTable: 'smt_pre_aoi_sessions',
        currentSessionJoinCol: 'pre_aoi_session_id',
        currentProcessSteps: ['Pre AOI', 'Pre_AOI', 'Pre-AOI'],
        previousStageName: 'SPI',
        prevSessionTable: 'smt_spi_sessions',
        prevSessionJoinCol: 'spi_session_id',
        prevProcessSteps: ['SPI']
    },
    'POST_AOI': {
        currentStageName: 'Post-AOI',
        currentSessionTable: 'smt_post_aoi_sessions',
        currentSessionJoinCol: 'post_aoi_session_id',
        currentProcessSteps: ['Post AOI', 'Post_AOI', 'Post-AOI'],
        previousStageName: 'Pre-AOI',
        prevSessionTable: 'smt_pre_aoi_sessions',
        prevSessionJoinCol: 'pre_aoi_session_id',
        prevProcessSteps: ['Pre AOI', 'Pre_AOI', 'Pre-AOI']
    },
    'POST-AOI': {
        currentStageName: 'Post-AOI',
        currentSessionTable: 'smt_post_aoi_sessions',
        currentSessionJoinCol: 'post_aoi_session_id',
        currentProcessSteps: ['Post AOI', 'Post_AOI', 'Post-AOI'],
        previousStageName: 'Pre-AOI',
        prevSessionTable: 'smt_pre_aoi_sessions',
        prevSessionJoinCol: 'pre_aoi_session_id',
        prevProcessSteps: ['Pre AOI', 'Pre_AOI', 'Pre-AOI']
    },
    'REWORK': {
        currentStageName: 'Rework',
        currentSessionTable: 'smt_rework_sessions',
        currentSessionJoinCol: 'rework_session_id',
        currentProcessSteps: ['Rework', 'SMT Rework', 'Post AOI Rework'],
        previousStageName: 'Post-AOI',
        prevSessionTable: 'smt_post_aoi_sessions',
        prevSessionJoinCol: 'post_aoi_session_id',
        prevProcessSteps: ['Post AOI', 'Post_AOI', 'Post-AOI']
    },
    'SMT_FG': {
        currentStageName: 'SMT-FG',
        currentSessionTable: 'smt_fg_sessions',
        currentSessionJoinCol: 'fg_session_id',
        currentProcessSteps: ['SMT FG', 'SMT_FG', 'SMT-FG', 'FG'],
        previousStageName: 'Post-AOI',
        prevSessionTable: 'smt_post_aoi_sessions',
        prevSessionJoinCol: 'post_aoi_session_id',
        prevProcessSteps: ['Post AOI', 'Post_AOI', 'Post-AOI']
    },
    'SMT-FG': {
        currentStageName: 'SMT-FG',
        currentSessionTable: 'smt_fg_sessions',
        currentSessionJoinCol: 'fg_session_id',
        currentProcessSteps: ['SMT FG', 'SMT_FG', 'SMT-FG', 'FG'],
        previousStageName: 'Post-AOI',
        prevSessionTable: 'smt_post_aoi_sessions',
        prevSessionJoinCol: 'post_aoi_session_id',
        prevProcessSteps: ['Post AOI', 'Post_AOI', 'Post-AOI']
    },
    'FG': {
        currentStageName: 'SMT-FG',
        currentSessionTable: 'smt_fg_sessions',
        currentSessionJoinCol: 'fg_session_id',
        currentProcessSteps: ['SMT FG', 'SMT_FG', 'SMT-FG', 'FG'],
        previousStageName: 'Post-AOI',
        prevSessionTable: 'smt_post_aoi_sessions',
        prevSessionJoinCol: 'post_aoi_session_id',
        prevProcessSteps: ['Post AOI', 'Post_AOI', 'Post-AOI']
    }
};

/**
 * GET /api/smt/previous-stage-passed
 * Query params:
 *  - workOrderId (required)
 *  - side (required, 'Top' | 'Bottom' | etc.)
 *  - stage (required, current stage name e.g. 'SPI', 'Pre-AOI', 'Post-AOI', 'Rework', 'SMT-FG')
 *  - sessionId (optional)
 *
 * Returns list of unique production units that successfully passed the previous stage
 * and have NOT yet passed the current stage (Pending at Current Stage), along with the count.
 */
export const getPreviousStagePassed = async (req: Request, res: Response) => {
    const workOrderId = (req.query.workOrderId as string || req.query.woId as string || req.params.woId || '').trim();
    const side = (req.query.side as string || '').trim();
    const stage = (req.query.stage as string || req.query.currentStage as string || req.params.stage || '').trim();

    if (!stage) {
        return res.status(400).json({
            success: false,
            message: 'Stage parameter is required.'
        });
    }

    const normalizedStage = stage.toUpperCase().replace(/[\s]/g, '_');

    // Printing has no previous SMT stage
    if (normalizedStage === 'PRINTING') {
        return res.status(200).json({
            success: true,
            stage: 'Printing',
            previousStage: null,
            count: 0,
            units: [],
            data: []
        });
    }

    const config = STAGE_MAPPING[normalizedStage];
    if (!config) {
        return res.status(400).json({
            success: false,
            message: `Unknown stage '${stage}'. Valid stages are: Printing, SPI, Pre-AOI, Post-AOI, Rework, SMT-FG.`
        });
    }

    if (!workOrderId || !side) {
        return res.status(400).json({
            success: false,
            message: 'workOrderId and side are required parameters.'
        });
    }

    try {
        const query = `
            WITH latest_prev_stage_scans AS (
                SELECT DISTINCT ON (UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))))
                    i.id,
                    i.serial_id,
                    COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text) AS serial_number,
                    COALESCE(i.work_order_id, ps.work_order_id) AS work_order_id,
                    COALESCE(ps.side, '') AS side,
                    i.process_step AS previous_stage,
                    UPPER(TRIM(i.status)) AS status,
                    COALESCE(i.scanned_by, '-') AS scanned_by,
                    i.scanned_at
                FROM smt_inspections i
                JOIN ${config.prevSessionTable} ps ON i.${config.prevSessionJoinCol} = ps.id
                LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                WHERE (
                    ps.work_order_id = $1
                    OR UPPER(TRIM(ps.work_order_id)) = UPPER(TRIM($1))
                    OR UPPER(TRIM(COALESCE(i.work_order_id, ''))) = UPPER(TRIM($1))
                )
                  AND LOWER(TRIM(ps.side)) = LOWER(TRIM($2))
                  AND i.process_step = ANY($3::text[])
                  AND (ps.is_deleted = false OR ps.is_deleted IS NULL)
                ORDER BY UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))), i.scanned_at DESC, i.id DESC
            ),
            qualified_units AS (
                SELECT *
                FROM latest_prev_stage_scans
                WHERE status IN ('PASS', 'ACCEPTED', 'PASSED')
            )
            SELECT 
                qu.id,
                qu.serial_id,
                qu.serial_number,
                qu.work_order_id,
                qu.side,
                qu.previous_stage,
                qu.status,
                qu.scanned_by,
                qu.scanned_at,
                subsequent_smt.process_step AS subsequent_smt_stage,
                subsequent_smt.scanned_at AS subsequent_smt_scanned_at
            FROM qualified_units qu
            LEFT JOIN LATERAL (
                SELECT li.process_step, li.status, li.scanned_at
                FROM smt_inspections li
                WHERE (
                    (qu.serial_id IS NOT NULL AND li.serial_id = qu.serial_id)
                    OR (qu.serial_number IS NOT NULL AND UPPER(TRIM(COALESCE(li.scanned_barcode, ''))) = UPPER(TRIM(qu.serial_number)))
                )
                AND li.scanned_at > qu.scanned_at
                ORDER BY li.scanned_at DESC, li.id DESC
                LIMIT 1
            ) subsequent_smt ON TRUE
            WHERE NOT EXISTS (
                SELECT 1
                FROM smt_inspections ci
                JOIN ${config.currentSessionTable} cs ON ci.${config.currentSessionJoinCol} = cs.id
                LEFT JOIN smt_serial_numbers csn ON ci.serial_id = csn.id
                WHERE (
                    (qu.serial_id IS NOT NULL AND ci.serial_id = qu.serial_id)
                    OR (qu.serial_number IS NOT NULL AND UPPER(TRIM(COALESCE(ci.scanned_barcode, csn.serial_number, ''))) = UPPER(TRIM(qu.serial_number)))
                )
                AND (
                    cs.work_order_id = $1
                    OR UPPER(TRIM(cs.work_order_id)) = UPPER(TRIM($1))
                    OR UPPER(TRIM(COALESCE(ci.work_order_id, ''))) = UPPER(TRIM($1))
                )
                AND LOWER(TRIM(cs.side)) = LOWER(TRIM($2))
                AND ci.process_step = ANY($4::text[])
                AND UPPER(TRIM(ci.status)) IN ('PASS', 'ACCEPTED', 'PASSED')
                AND (cs.is_deleted = false OR cs.is_deleted IS NULL)
            )
            ORDER BY qu.scanned_at DESC, qu.id DESC
        `;

        const result = await pool.query(query, [
            workOrderId,
            side,
            config.prevProcessSteps,
            config.currentProcessSteps
        ]);

        const formatStageName = (rawStage: string | null | undefined): string => {
            if (!rawStage) return '';
            const s = rawStage.trim();
            const upper = s.toUpperCase().replace(/[\s\-_]/g, '');
            if (upper === 'PRINTING' || upper === 'SMTPRINTING') return 'Printing';
            if (upper === 'SPI') return 'SPI';
            if (upper === 'PREAOI') return 'Pre-AOI';
            if (upper === 'POSTAOI') return 'Post-AOI';
            if (upper === 'REWORK' || upper === 'SMTREWORK' || upper === 'POSTAOIREWORK') return 'Rework';
            if (upper === 'SMTFG' || upper === 'FG') return 'SMT-FG';
            if (upper === 'PTH' || upper === 'PRESOLDERING') return 'PTH';
            if (upper === 'VI' || upper === 'VISUALINSPECTION') return 'VI';
            if (upper === 'QA' || upper === 'QUALITYASSURANCE') return 'QA';
            if (upper === 'FLASHING') return 'Flashing';
            if (upper === 'PCBAFCT' || upper === 'FCT') return 'PCBA-FCT';
            if (upper === 'ASSEMBLY') return 'Assembly';
            if (upper === 'UNITTESTING') return 'Unit Testing';
            if (upper === 'QI') return 'QI';
            if (upper === 'PACKING') return 'Packing';
            return s;
        };

        const normalizeStatusDisplay = (rawStatus: string) => {
            const s = (rawStatus || '').toUpperCase().trim();
            if (s === 'ACCEPTED' || s === 'PASSED' || s === 'PASS') return 'PASS';
            if (s === 'FAILED' || s === 'FAIL') return 'FAIL';
            if (s === 'REWORK') return 'REWORK';
            return s || 'PASS';
        };

        // ─────────────────────────────────────────────────────────────────────────────
        // Re-use Existing Backend Track Items Logic:
        // Cross-query backendPool (units ledger, mapping, and scans) for candidate barcodes
        // ─────────────────────────────────────────────────────────────────────────────
        const backendUnitMap = new Map<string, { currentStage: string; latestScanAt?: Date }>();

        if (result.rows.length > 0) {
            try {
                const serials = result.rows
                    .map((r: any) => (r.serial_number || '').trim().toUpperCase())
                    .filter(Boolean);

                if (serials.length > 0) {
                    // 1. Resolve candidate barcodes / unit mappings from Backend unit_serial_mapping
                    const candidateMap = new Map<string, Set<string>>();
                    serials.forEach(sn => candidateMap.set(sn, new Set([sn])));

                    const mappingRes = await backendPool.query(
                        `SELECT barcode, unit_serial_number 
                         FROM unit_serial_mapping 
                         WHERE UPPER(TRIM(unit_serial_number)) = ANY($1) 
                            OR UPPER(TRIM(barcode)) = ANY($1)`,
                        [serials]
                    );

                    mappingRes.rows.forEach((r: any) => {
                        const bc = (r.barcode || '').trim().toUpperCase();
                        const usn = (r.unit_serial_number || '').trim().toUpperCase();
                        serials.forEach(sn => {
                            if (sn === bc || sn === usn) {
                                if (bc) candidateMap.get(sn)?.add(bc);
                                if (usn) candidateMap.get(sn)?.add(usn);
                            }
                        });
                    });

                    // Flatten all candidate barcodes to query backend scans and units ledger
                    const allCandidateBarcodes = Array.from(
                        new Set(Array.from(candidateMap.values()).flatMap(s => Array.from(s)))
                    );

                    if (allCandidateBarcodes.length > 0) {
                        // 2. Fetch backend scans in chronological order
                        const bScansRes = await backendPool.query(
                            `SELECT 
                                s.barcode,
                                ps.stage_code,
                                ps.stage_name AS station,
                                ps.stage_order,
                                s.scan_result AS status,
                                s.scanned_by,
                                s.scanned_at
                            FROM scans s
                            JOIN production_stages ps ON s.stage_id = ps.id
                            WHERE UPPER(TRIM(s.barcode)) = ANY($1)
                            ORDER BY s.scanned_at ASC, s.id ASC`,
                            [allCandidateBarcodes]
                        );

                        // 3. Fetch backend units ledger current_stage_id & stage_name
                        const bUnitsRes = await backendPool.query(
                            `SELECT 
                                u.barcode,
                                u.current_status,
                                ps.stage_name AS current_stage,
                                ps.stage_code
                            FROM units u
                            LEFT JOIN production_stages ps ON u.current_stage_id = ps.id
                            WHERE UPPER(TRIM(u.barcode)) = ANY($1)`,
                            [allCandidateBarcodes]
                        );

                        // Associate backend scan history with each serial
                        serials.forEach(sn => {
                            const candidates = candidateMap.get(sn) || new Set([sn]);
                            const matchedScans = bScansRes.rows.filter((sRow: any) =>
                                candidates.has((sRow.barcode || '').trim().toUpperCase())
                            );

                            if (matchedScans.length > 0) {
                                const latestScan = matchedScans[matchedScans.length - 1];
                                const resolvedStage = latestScan.station || latestScan.stage_name || latestScan.stage_code;
                                backendUnitMap.set(sn, {
                                    currentStage: resolvedStage,
                                    latestScanAt: new Date(latestScan.scanned_at)
                                });
                            } else {
                                const matchedUnit = bUnitsRes.rows.find((uRow: any) =>
                                    candidates.has((uRow.barcode || '').trim().toUpperCase())
                                );
                                if (matchedUnit && matchedUnit.current_stage) {
                                    backendUnitMap.set(sn, {
                                        currentStage: matchedUnit.current_stage
                                    });
                                }
                            }
                        });
                    }
                }
            } catch (bErr: any) {
                logger.warn('Backend Track Items stage resolution warning (falling back to SMT stage):', bErr.message);
            }
        }

        const units = result.rows.map((row: any) => {
            const snUpper = (row.serial_number || '').trim().toUpperCase();
            const backendInfo = backendUnitMap.get(snUpper);

            // Determine Current Stage:
            // 1. If unit reached a subsequent Backend stage (after qualifying scan), show that Backend stage
            // 2. Else if unit reached a subsequent SMT stage (e.g. Rework), show that SMT stage
            // 3. Default: the unit is pending at the current target SMT stage (e.g. Pre-AOI, Post-AOI, SPI, Rework, SMT-FG)
            let resolvedCurrentStage = config.currentStageName;

            if (backendInfo?.currentStage) {
                if (backendInfo.latestScanAt && row.scanned_at) {
                    const prevTime = new Date(row.scanned_at).getTime();
                    const bTime = backendInfo.latestScanAt.getTime();
                    if (bTime >= prevTime) {
                        resolvedCurrentStage = formatStageName(backendInfo.currentStage);
                    }
                } else {
                    resolvedCurrentStage = formatStageName(backendInfo.currentStage);
                }
            } else if (row.subsequent_smt_stage) {
                resolvedCurrentStage = formatStageName(row.subsequent_smt_stage);
            }

            const formattedPrevStage = formatStageName(row.previous_stage) || config.previousStageName;

            return {
                id: row.id,
                serial_number: row.serial_number || '-',
                work_order_id: row.work_order_id || workOrderId,
                side: row.side || side,
                current_stage: resolvedCurrentStage,
                previous_stage: formattedPrevStage,
                status: normalizeStatusDisplay(row.status),
                scanned_by: row.scanned_by || '-',
                scanned_at: row.scanned_at
            };
        });

        return res.status(200).json({
            success: true,
            stage,
            previousStage: config.previousStageName,
            count: units.length,
            units,
            data: units
        });
    } catch (err: any) {
        logger.error(`Error fetching previous stage passed units for ${stage} (WO: ${workOrderId}, Side: ${side}):`, err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while fetching previous stage passed data.'
        });
    }
};
