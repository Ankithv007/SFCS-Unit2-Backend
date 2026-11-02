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
import { getPendingCache, setPendingCache } from '../utils/pendingCache';

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

    const cleanWo = workOrderId.trim();
    const cleanSide = side.trim();
    const cacheKey = `smt:pending:${cleanWo.toUpperCase()}:${cleanSide.toLowerCase()}:${normalizedStage}`;

    // 1. Check in-memory TTL cache for instant (<1ms) response
    const cached = getPendingCache<any>(cacheKey);
    if (cached) {
        return res.status(200).json(cached);
    }

    try {
        const query = `
            WITH prev_sessions AS (
                SELECT id, work_order_id, side
                FROM ${config.prevSessionTable}
                WHERE (UPPER(TRIM(work_order_id)) = UPPER(TRIM($1)) OR work_order_id = $1)
                  AND LOWER(TRIM(side)) = LOWER(TRIM($2))
                  AND (is_deleted = false OR is_deleted IS NULL)
            ),
            current_sessions AS (
                SELECT id, work_order_id, side
                FROM ${config.currentSessionTable}
                WHERE (UPPER(TRIM(work_order_id)) = UPPER(TRIM($1)) OR work_order_id = $1)
                  AND LOWER(TRIM(side)) = LOWER(TRIM($2))
                  AND (is_deleted = false OR is_deleted IS NULL)
            ),
            latest_prev_scans AS (
                SELECT DISTINCT ON (UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))))
                    i.id,
                    i.serial_id,
                    COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text) AS serial_number,
                    UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))) AS clean_serial,
                    COALESCE(i.work_order_id, ps.work_order_id) AS work_order_id,
                    COALESCE(ps.side, '') AS side,
                    i.process_step AS previous_stage,
                    UPPER(TRIM(i.status)) AS status,
                    COALESCE(i.scanned_by, '-') AS scanned_by,
                    i.scanned_at
                FROM smt_inspections i
                JOIN prev_sessions ps ON i.${config.prevSessionJoinCol} = ps.id
                LEFT JOIN smt_serial_numbers sn ON i.serial_id = sn.id
                WHERE i.process_step = ANY($3::text[])
                ORDER BY UPPER(TRIM(COALESCE(sn.serial_number, i.scanned_barcode, i.serial_id::text))), i.scanned_at DESC, i.id DESC
            ),
            latest_current_scans AS (
                SELECT DISTINCT ON (UPPER(TRIM(COALESCE(sn.serial_number, ci.scanned_barcode, ci.serial_id::text))))
                    ci.id,
                    UPPER(TRIM(COALESCE(sn.serial_number, ci.scanned_barcode, ci.serial_id::text))) AS clean_serial,
                    UPPER(TRIM(ci.status)) AS status
                FROM smt_inspections ci
                JOIN current_sessions cs ON ci.${config.currentSessionJoinCol} = cs.id
                LEFT JOIN smt_serial_numbers sn ON ci.serial_id = sn.id
                WHERE ci.process_step = ANY($4::text[])
                ORDER BY UPPER(TRIM(COALESCE(sn.serial_number, ci.scanned_barcode, ci.serial_id::text))), ci.scanned_at DESC, ci.id DESC
            )
            SELECT 
                p.id,
                p.serial_id,
                p.serial_number,
                p.work_order_id,
                p.side,
                p.previous_stage,
                p.status,
                p.scanned_by,
                p.scanned_at,
                NULL as subsequent_smt_stage,
                NULL as subsequent_smt_scanned_at
            FROM latest_prev_scans p
            LEFT JOIN latest_current_scans c ON p.clean_serial = c.clean_serial
            WHERE (
                ${normalizedStage === 'REWORK' ? "p.status IN ('FAIL', 'FAILED')" : "p.status IN ('PASS', 'ACCEPTED', 'PASSED')"}
            )
            AND (c.clean_serial IS NULL OR c.status NOT IN ('PASS', 'ACCEPTED', 'PASSED'))
            ORDER BY p.scanned_at DESC, p.id DESC
        `;

        const result = await pool.query(query, [
            cleanWo,
            cleanSide,
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

        const units = result.rows.map((row: any) => {
            const formattedPrevStage = formatStageName(row.previous_stage) || config.previousStageName;

            return {
                id: row.id,
                serial_number: row.serial_number || '-',
                work_order_id: row.work_order_id || workOrderId,
                side: row.side || side,
                current_stage: config.currentStageName,
                previous_stage: formattedPrevStage,
                status: normalizeStatusDisplay(row.status),
                scanned_by: row.scanned_by || '-',
                scanned_at: row.scanned_at
            };
        });

        const responsePayload = {
            success: true,
            stage,
            previousStage: config.previousStageName,
            count: units.length,
            units,
            data: units
        };

        // Cache for 10 seconds (auto-invalidated on any new scan submission)
        setPendingCache(cacheKey, responsePayload, 10000);

        return res.status(200).json(responsePayload);
    } catch (err: any) {
        logger.error(`Error fetching previous stage passed units for ${stage} (WO: ${workOrderId}, Side: ${side}):`, err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error while fetching previous stage passed data.'
        });
    }
};
